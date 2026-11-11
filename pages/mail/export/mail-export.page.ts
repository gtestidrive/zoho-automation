import { expect, type Locator, type Page } from '@playwright/test';
import { Unzip, UnzipInflate, UnzipPassThrough, unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { ExportDownloadPage } from '../../export/export-download.page';
import { exportLog } from '../../export/export-log';
import { ZohoMailApi, normalizeMailSize, type ZohoMailMessage } from '../api/zoho-mail.api';
import { MailBackupPage } from '../backup/mail-backup.page';
import { MailExportAssertions } from './mail-export.assertions';
import { messageKey, normalizeAddresses, type ExportedMailMessage } from './mail-export.comparison';
import { mailExportLabels as labels } from './mail-export.labels';
import { MailExportLocators } from './mail-export.locators';

type ExportRow = { row: Locator; key: string; status: string; state: string };

export class MailExportPage {
  private readonly locators: MailExportLocators;
  private readonly backup: MailBackupPage;
  private readonly assertions = new MailExportAssertions();

  constructor(private readonly page: Page, private readonly api: ZohoMailApi) {
    this.locators = new MailExportLocators(page);
    this.backup = new MailBackupPage(page);
  }

  async exportRandomMessagesAndVerify(email: string, directory: string) {
    const started = Date.now();
    exportLog('Mail export', 'Start', `User=${email}, folder=${labels.inbox}, format=ZIP, directory="${directory}". No messages or backups created.`);
    const source = await this.api.listFolderMessages(email, labels.inbox);
    exportLog('Mail export', 'Zoho inventory', `Account=${source.account.email}, folder=${labels.inbox}, messages=${source.messages.length}.`);
    await this.openExports();
    const previous = await this.history();
    await this.backup.selectUser(email);
    await this.openInbox();
    const selected = await this.selectMessages();
    console.log(`[Mail export] Selected ${selected.length} real Inbox messages.`);
    console.table(selected);
    await this.locators.exportButton.click();
    await expect(this.locators.dialog).toBeVisible();
    await expect(this.locators.selectedItems).toBeChecked();
    await expect(this.locators.selectedItems).toHaveAccessibleName(new RegExp(`Selected Items \\(${selected.length}\\)`, 'i'));
    await this.locators.format.selectOption({ label: labels.format });
    await this.locators.confirm.click();
    await expect(this.locators.dialog).toBeHidden({ timeout: 30_000 });
    console.log('[Mail export] Submitted ZIP export; waiting for COMPLETED / ACTIVE.');
    let completed: ExportRow | undefined;
    let lastStatus = '';
    await expect.poll(async () => {
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.openExports();
      const seen = new Map<string, number>();
      const newRows = (await this.history()).filter((entry) => {
        const count = (seen.get(entry.key) ?? 0) + 1;
        seen.set(entry.key, count);
        return count > previous.filter(({ key }) => key === entry.key).length;
      });
      if (newRows.length > 1) {
        throw new Error('Multiple new Mail exports found; cannot identify this export uniquely.');
      }
      const entry = newRows[0];
      if (!entry) {
        return false;
      }
      const currentStatus = `${entry.key} | ${entry.status} | ${entry.state}`;
      if (currentStatus !== lastStatus) {
        exportLog('Mail export', 'Export status',
          `History=${currentStatus}, elapsed=${((Date.now() - started) / 1000).toFixed(1)}s.`);
        lastStatus = currentStatus;
      }
      if (/fail|error/i.test(`${entry.status} ${entry.state}`)) {
        throw new Error(`Mail export failed: ${entry.status}, ${entry.state}.`);
      }
      if (/^completed$/i.test(entry.status) && /^active$/i.test(entry.state)) {
        completed = entry;
        return true;
      }
      return false;
    }, { timeout: 10 * 60_000, intervals: [2_000, 5_000], message: 'Waiting for the new Mail export.' }).toBe(true);
    if (!completed) {
      throw new Error('No completed Mail export row found.');
    }
    const action = this.locators.download(completed.row);
    await expect(action).toBeEnabled();
    const archivePath = await new ExportDownloadPage(this.page, 'Mail export').downloadZip(action, directory);
    const exported = readMailExportContents(await readFile(archivePath));
    this.assertions.expectC2CMatches(selected, exported);
    const checksums = await compareMailOriginals(
      exported, source.messages,
      (id) => this.api.getOriginalMessage(source.account.id, id),
    );
    this.assertions.expectZohoChecksumsMatch(checksums);
    exportLog('Mail export', 'PASS',
      `User=${email}, folder=${labels.inbox}, selected=${selected.length}, downloaded=${exported.length}, `
      + `C2C headers and Zoho MIME SHA-256 verified; ZIP="${archivePath}", elapsed=${((Date.now() - started) / 1000).toFixed(1)}s.`);
    return { selectedMessages: selected.length, exportedMessages: exported.length, archivePath };
  }

  private async waitSnapshot(): Promise<void> {
    await expect(this.locators.loading).toBeHidden({ timeout: 30_000 });
    await expect(this.locators.range).toBeVisible();
  }

  private async nextPage(): Promise<void> {
    const before = await this.locators.range.innerText();
    await this.locators.next.click();
    await expect(this.locators.range).not.toHaveText(before);
    await this.waitSnapshot();
  }

  private async openInbox(): Promise<void> {
    await expect(this.locators.firstSnapshotName())
      .toBeVisible({ timeout: 30_000 });
    await this.waitSnapshot();
    for (; ;) {
      const row = this.locators.folderRow(labels.inbox);
      if (await row.count() > 0) {
        await expect(row).toHaveCount(1);
        const cells = await this.locators.rowCells(row).allInnerTexts();
        if (cells[4]?.trim() !== 'NA' || cells[2]?.trim() || cells[3]?.trim() || cells[5]?.trim()) {
          throw new Error('The C2C Inbox row is not a Mail folder.');
        }
        await this.locators.folderNameCell(row).click();
        await expect(this.locators.inboxBreadcrumb()).toBeVisible();
        await expect(this.locators.range).not.toHaveText(/^0\s*[–-]\s*0\s+of\s+0$/, { timeout: 30_000 });
        await this.waitSnapshot();
        return;
      }
      if (await this.locators.next.isDisabled()) {
        throw new Error('C2C snapshot has no Inbox folder.');
      }
      await this.nextPage();
    }
  }

  private async selectMessages(): Promise<ZohoMailMessage[]> {
    const match = /(\d+)\s*[–-]\s*(\d+)\s+of\s+(\d+)/.exec(await this.locators.range.innerText());
    if (!match || Number(match[1]) !== 1 || Number(match[3]) < 1) {
      throw new Error('Inbox is empty or did not open on its first snapshot page.');
    }
    const pageSize = Number(match[2]) - Number(match[1]) + 1;
    if (pageSize < 1) {
      throw new Error('Invalid Mail snapshot page size.');
    }
    const pageIndex = Math.floor(Math.random() * Math.ceil(Number(match[3]) / pageSize));
    for (let index = 0; index < pageIndex; index++) {
      await this.nextPage();
    }
    const rows = this.locators.snapshotRows();
    const candidates: Array<{ message: ZohoMailMessage; checkbox: Locator }> = [];
    for (let index = 1; index < await rows.count(); index++) {
      const row = this.locators.rowAt(rows, index);
      const cells = (await this.locators.rowCells(row).allInnerTexts()).map((value) => value.trim());
      if (cells.length !== 6) {
        throw new Error('Unexpected Mail snapshot row shape.');
      }
      if (cells[4] === 'NA' && !cells[2] && !cells[3] && !cells[5]) {
        continue;
      }
      const checkbox = this.locators.messageCheckbox(row);
      if (await checkbox.count() !== 1) {
        throw new Error('Mail snapshot message has no unique selection checkbox.');
      }
      if (await checkbox.isEnabled()) {
        candidates.push({ message: { from: cells[1], to: cells[2], subject: cells[3], size: normalizeMailSize(cells[5]) }, checkbox });
      }
    }
    if (!candidates.length) {
      throw new Error('Random Inbox snapshot page contains no selectable messages.');
    }
    const count = 1 + Math.floor(Math.random() * Math.min(3, candidates.length));
    const selected: ZohoMailMessage[] = [];
    for (let index = 0; index < count; index++) {
      const candidate = candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0];
      await candidate.checkbox.check();
      await expect(candidate.checkbox).toBeChecked();
      selected.push(candidate.message);
    }
    console.log(`[Mail export] Read random Inbox page ${pageIndex + 1}; no full C2C message scan.`);
    return selected;
  }

  private async openExports(): Promise<void> {
    await this.locators.exportsTab.click();
    await expect(this.locators.exportsTab).toHaveAttribute('aria-selected', 'true');
    await expect(this.locators.exportsTable).toBeVisible();
    await expect(this.locators.historyLoading()).toBeHidden({ timeout: 60_000 });
  }

  private async history(): Promise<ExportRow[]> {
    const headers = (await this.locators.historyHeaders().allInnerTexts())
      .map((value) => value.trim().replace(/\s+/g, ' '));
    const column = (name: string): number => {
      const index = headers.indexOf(name);
      if (index < 0 || headers.lastIndexOf(name) !== index) {
        throw new Error(`Expected one "${name}" Mail export history column.`);
      }
      return index;
    };
    const identity = ['Source', 'Type', 'Destination', 'Started', 'Performed by'].map(column);
    const status = column('Status');
    const state = column('Export state');
    const rows = this.locators.historyRows();
    const result: ExportRow[] = [];
    for (let index = 1; index < await rows.count(); index++) {
      const row = this.locators.rowAt(rows, index);
      const cells = (await this.locators.rowCells(row).allInnerTexts()).map((value) => value.trim());
      if (cells.length !== headers.length) {
        if (cells.length === 1 && /no .*exports|no records|no data/i.test(cells[0])) {
          continue;
        }
        throw new Error('Unexpected Mail export history row shape.');
      }
      result.push({ row, key: JSON.stringify(identity.map((index) => cells[index])), status: cells[status], state: cells[state] });
    }
    return result;
  }
}


export type ExportedEml = {
  path: string; headers: ExportedMailMessage; bytes: Uint8Array;
  identity: { messageId: string; date: string };
};
export type MailExportChecksumResult = { Path: string; ExportSHA256: string; ZohoSHA256: string; Matches: boolean };

export function readMailExportContents(archive: Uint8Array): ExportedEml[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive);
  } catch (error) {
    throw new Error('Mail export is not a readable ZIP archive.', { cause: error });
  }
  const messages: ExportedEml[] = [];
  for (const [path, bytes] of Object.entries(files)) {
    if (path.endsWith('/')) {
      continue;
    }
    if (!/\.eml$/i.test(path)) {
      throw new Error(`Unexpected exported Mail file "${path}"; expected EML.`);
    }
    if (!bytes.length) {
      throw new Error(`Exported Mail message "${path}" is empty.`);
    }
    messages.push({ path, bytes, headers: parseEmlHeaders(bytes), identity: mimeIdentity(bytes) });
  }
  if (!messages.length) {
    throw new Error('Mail export ZIP contains no EML messages.');
  }
  return messages;
}

function checksum(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function mimeIdentity(bytes: Uint8Array): { messageId: string; date: string } {
  const headers = new TextDecoder().decode(bytes).split(/\r?\n\r?\n/, 1)[0]
    .replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/);
  const read = (name: string): string => headers.find((line) =>
    line.toLowerCase().startsWith(`${name}:`))?.slice(name.length + 1).trim() ?? '(absent)';
  return { messageId: read('message-id'), date: read('date') };
}


function decodeEncodedWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_match, charset: string, encoding: string, text: string) => {
    try {
      const bytes = encoding.toLowerCase() === 'b'
        ? Buffer.from(text, 'base64')
        : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_hex, code: string) =>
          String.fromCharCode(Number.parseInt(code, 16))), 'binary');
      return new TextDecoder(charset).decode(bytes);
    } catch (error) {
      throw new Error(`Could not decode exported Mail header using ${charset}: ${String(error)}`);
    }
  });
}

function readHeader(rawMessage: string, headerName: string): string {
  const headerBlock = rawMessage.split(/\r?\n\r?\n/, 1)[0] ?? '';
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, ' ');
  const values = unfolded
    .split(/\r?\n/)
    .filter((line) => line.toLowerCase().startsWith(`${headerName.toLowerCase()}:`))
    .map((line) => line.slice(headerName.length + 1).trim());
  return decodeEncodedWords(values.join(', ')).replace(/\s+/g, ' ').trim();
}

export function parseEmlHeaders(rawHeaders: Uint8Array): ExportedMailMessage {
  const text = new TextDecoder('utf-8').decode(rawHeaders);
  return {
    from: normalizeAddresses(readHeader(text, 'From')),
    to: normalizeAddresses(readHeader(text, 'To')),
    subject: readHeader(text, 'Subject').normalize('NFC'),
  };
}

export async function readExportedMailMessages(zipPath: string): Promise<ExportedMailMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: ExportedMailMessage[] = [];
    let activeEntries = 0;
    let inputEnded = false;
    let settled = false;
    const maxHeaderBytes = 256 * 1024;

    const fail = (error: Error): void => {
      if (!settled) {
        settled = true;
        input.destroy();
        reject(error);
      }
    };

    const finishIfReady = (): void => {
      if (inputEnded && activeEntries === 0 && !settled) {
        settled = true;
        if (messages.length === 0) {
          reject(new Error('Mail export ZIP contains no .eml messages to compare.'));
        } else {
          resolve(messages);
        }
      }
    };

    const archive = new Unzip((file) => {
      const isMessage = /\.eml$/i.test(file.name);
      let headerBytes = new Uint8Array(0);
      let headerComplete = false;
      if (isMessage) {
        activeEntries += 1;
      }

      file.ondata = (error, data, final) => {
        if (error) {
          fail(error);
          return;
        }
        if (isMessage && data.length > 0 && !headerComplete) {
          const combined = new Uint8Array(headerBytes.length + data.length);
          combined.set(headerBytes);
          combined.set(data, headerBytes.length);
          let headerEnd = -1;
          for (let index = 0; index < combined.length; index++) {
            if (
              index + 3 < combined.length
              && combined[index] === 13 && combined[index + 1] === 10
              && combined[index + 2] === 13 && combined[index + 3] === 10
            ) {
              headerEnd = index;
              break;
            }
            if (index + 1 < combined.length && combined[index] === 10 && combined[index + 1] === 10) {
              headerEnd = index;
              break;
            }
          }
          if (headerEnd >= 0) {
            headerBytes = combined.slice(0, headerEnd);
            headerComplete = true;
          } else {
            if (combined.length > maxHeaderBytes) {
              fail(new Error(`Exported Mail message "${file.name}" has a header larger than ${maxHeaderBytes} bytes.`));
              return;
            }
            headerBytes = combined;
          }
        }
        if (final && isMessage) {
          if (!headerComplete) {
            fail(new Error(`Exported Mail message "${file.name}" has no complete header section.`));
            return;
          }
          try {
            messages.push(parseEmlHeaders(headerBytes));
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
            return;
          }
          activeEntries -= 1;
          finishIfReady();
        }
      };

      try {
        file.start();
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    archive.register(UnzipInflate);
    archive.register(UnzipPassThrough);

    const input = createReadStream(zipPath);
    input.on('data', (chunk: string | Buffer) => {
      if (settled) {
        return;
      }
      try {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        archive.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    input.on('error', (error) => fail(error));
    input.on('end', () => {
      if (settled) {
        return;
      }
      try {
        archive.push(new Uint8Array(0), true);
        inputEnded = true;
        finishIfReady();
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

export async function compareMailOriginals(
  exported: ExportedEml[],
  source: ZohoMailMessage[],
  readOriginal: (id: string) => Promise<Uint8Array>,
): Promise<MailExportChecksumResult[]> {
  console.log('[Mail export verification 2/2] Raw EML SHA-256 versus live Zoho original MIME (headers, body and attachments).');
  const remaining = [...source];
  const originalChecksums = new Map<string, string>();
  const identities = new Map<string, { messageId: string; date: string; bytes: number }>();
  const results: Array<{ Path: string; ExportSHA256: string; ZohoSHA256: string; Matches: boolean }> = [];
  for (const message of exported) {
    const candidates = remaining.filter((candidate) => messageKey(candidate) === messageKey(message.headers));
    const exportChecksum = checksum(message.bytes);
    exportLog('Mail export', 'Zoho comparison',
      `File="${message.path}", bytes=${message.bytes.length}, header candidates=${candidates.length}, SHA-256=${exportChecksum}.`);
    let matched: ZohoMailMessage | undefined;
    const observed: string[] = [];
    for (const candidate of candidates) {
      if (!candidate.id) {
        throw new Error('Zoho Mail returned a message without an ID required for original MIME verification.');
      }
      let sourceChecksum = originalChecksums.get(candidate.id);
      if (!sourceChecksum) {
        exportLog('Mail export', 'Zoho original', `Reading message ID=${candidate.id}.`);
        let original: Uint8Array;
        try {
          original = await readOriginal(candidate.id);
        } catch (error) {
          console.error(`[Mail export] Original MIME read failed for "${message.path}", Zoho ID=${candidate.id}.`, error);
          throw error;
        }
        sourceChecksum = checksum(original);
        identities.set(candidate.id, { ...mimeIdentity(original), bytes: original.length });
        originalChecksums.set(candidate.id, sourceChecksum);
      }
      observed.push(sourceChecksum);
      console.table([{
        File: message.path, ZohoID: candidate.id,
        ExportMessageID: mimeIdentity(message.bytes).messageId,
        ExportDate: mimeIdentity(message.bytes).date,
        ZohoMessageID: identities.get(candidate.id)?.messageId,
        ZohoDate: identities.get(candidate.id)?.date,
        ExportBytes: message.bytes.length, ZohoBytes: identities.get(candidate.id)?.bytes,
        ExportSHA256: exportChecksum, ZohoSHA256: sourceChecksum, Matches: sourceChecksum === exportChecksum,
      }]);
      if (sourceChecksum === exportChecksum) {
        matched = candidate;
        break;
      }
    }
    if (matched) {
      remaining.splice(remaining.indexOf(matched), 1);
    }
    if (!matched) {
      console.error(`[Mail export] FAIL: "${message.path}" has no remaining live Zoho original with identical SHA-256. `
        + `Checked ${candidates.length} same-header candidate(s) in the source folder. `
        + 'The message may be absent/moved/deleted since backup, or its MIME bytes differ; this is not a verified match.');
    }
    results.push({
      Path: message.path,
      ExportSHA256: exportChecksum,
      ZohoSHA256: matched ? exportChecksum : observed.join(', ') || '(no remaining matching Zoho message)',
      Matches: matched !== undefined,
    });
  }
  return results;
}
