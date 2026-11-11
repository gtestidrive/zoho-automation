import { expect, type Locator, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFile } from 'node:fs/promises';
import { ExportDownloadPage } from '../../export/export-download.page';
import { exportLog } from '../../export/export-log';
import { ZohoContactsApi } from '../api/zoho-contacts.api';
import { ContactsBackupAssertions } from '../backup/contacts-backup.assertions';
import { ContactsBackupPage, type C2cSnapshotContact } from '../backup/contacts-backup.page';
import { ContactsExportAssertions } from './contacts-export.assertions';
import { contactsExportLabels } from './contacts-export.labels';
import { ContactsExportLocators } from './contacts-export.locators';

type ExportHistory = { row: Locator; key: string; status: string; state: string };

export class ContactsExportPage {
  private readonly locators: ContactsExportLocators;
  private readonly backupPage: ContactsBackupPage;
  private readonly assertions = new ContactsExportAssertions();

  constructor(private readonly page: Page, private readonly api: ZohoContactsApi) {
    this.locators = new ContactsExportLocators(page);
    this.backupPage = new ContactsBackupPage(page);
  }

  async exportRandomContactsAndVerify(email: string, directory: string) {
    const started = Date.now();
    exportLog('Contacts export', 'Start', `User=${email}, format=VCF, directory="${directory}". No contacts or backup will be created.`);
    new ContactsBackupAssertions().expectAccountEmail(email, await this.api.readAccountIds(email));
    exportLog('Contacts export', 'Account', 'Authenticated Zoho account matches the selected C2C user.');
    await this.openExports();
    const previous = await this.history();
    const user = await this.backupPage.selectUser(email);
    const total = await this.backupPage.readLatestSnapshotContactCount(user);
    if (total === 0) {
      throw new Error(`C2C Contacts snapshot for ${email} is empty; no contacts can be exported.`);
    }
    const selected = await this.selectRandomContacts(total);
    exportLog('Contacts export', 'Selection', `Snapshot total=${total}, selected=${selected.length}.`);
    console.log(`[Contacts export] Selected ${selected.length} real contacts for ${email}.`);
    console.table(selected);
    await this.locators.exportButton.click();
    await expect(this.locators.dialog).toBeVisible();
    await expect(this.locators.selectedItems).toBeChecked();
    await expect(this.locators.selectedItems).toHaveAccessibleName(new RegExp(`Selected Items \\(${selected.length}\\)`, 'i'));
    await this.locators.format.selectOption({ label: contactsExportLabels.format });
    await this.locators.confirm.click();
    await expect(this.locators.dialog).toBeHidden({ timeout: 30_000 });

    console.log('[Contacts export] Submitted VCF export; waiting for completion and ACTIVE download state.');
    let completed: ExportHistory | undefined;
    let lastStatus = '';
    await expect.poll(async () => {
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.openExports();
      const current = await this.history();
      const seen = new Map<string, number>();
      const newRows = current.filter((entry) => {
        const count = (seen.get(entry.key) ?? 0) + 1;
        seen.set(entry.key, count);
        return count > previous.filter(({ key }) => key === entry.key).length;
      });
      if (newRows.length > 1) {
        throw new Error('Multiple new Contacts exports found; cannot identify this export uniquely.');
      }
      const entry = newRows[0];
      if (!entry) {
        return false;
      }
      const currentStatus = `${entry.key} | ${entry.status} | ${entry.state}`;
      if (currentStatus !== lastStatus) {
        exportLog('Contacts export', 'Export status',
          `History=${currentStatus}, elapsed=${((Date.now() - started) / 1000).toFixed(1)}s.`);
        lastStatus = currentStatus;
      }
      if (/fail|error/i.test(`${entry.status} ${entry.state}`)) {
        throw new Error(`Contacts export failed for ${email}: ${entry.status}, ${entry.state}.`);
      }
      if (/^completed$/i.test(entry.status) && /^active$/i.test(entry.state)) {
        completed = entry;
        return true;
      }
      return false;
    }, {
      timeout: 10 * 60_000,
      intervals: [2_000, 5_000],
      message: `Waiting for the new Contacts export for ${email} to complete.`,
    }).toBe(true);
    if (!completed) {
      throw new Error('No completed Contacts export row was found.');
    }
    const action = this.locators.download(completed.row);
    await expect(action).toBeEnabled();
    const archivePath = await new ExportDownloadPage(this.page, 'Contacts export').downloadZip(action, directory);
    const exported = readContactsExport(await readFile(archivePath));
    this.assertions.expectMatches(selected, exported, await this.api.listContacts());
    exportLog('Contacts export', 'PASS',
      `User=${email}, selected=${selected.length}, downloaded=${exported.length}, both checks passed; `
      + `ZIP="${archivePath}", elapsed=${((Date.now() - started) / 1000).toFixed(1)}s.`);
    return { selectedContacts: selected, exportedContacts: exported.length, archivePath };
  }

  private async selectRandomContacts(total: number): Promise<C2cSnapshotContact[]> {
    const { locators } = this;
    await expect(locators.loading).toBeHidden({ timeout: 30_000 });
    await expect(locators.range).toBeVisible();
    while (!await locators.previous.isDisabled()) {
      const range = await locators.range.innerText();
      await locators.previous.click();
      await expect(locators.range).not.toHaveText(range);
      await expect(locators.loading).toBeHidden({ timeout: 30_000 });
    }
    const range = await locators.range.innerText();
    const match = /(\d+)\s*[–-]\s*(\d+)\s+of\s+(\d+)/.exec(range);
    if (!match || Number(match[3]) !== total) {
      throw new Error(`Cannot determine Contacts snapshot pagination from "${range}".`);
    }
    const pageSize = Number(match[2]) - Number(match[1]) + 1;
    if (pageSize <= 0) {
      throw new Error(`Invalid Contacts snapshot page size in "${range}".`);
    }
    const pageIndex = Math.floor(Math.random() * Math.ceil(total / pageSize));
    for (let index = 0; index < pageIndex; index++) {
      const before = await locators.range.innerText();
      await expect(locators.next).toBeEnabled();
      await locators.next.click();
      await expect(locators.range).not.toHaveText(before);
      await expect(locators.loading).toBeHidden({ timeout: 30_000 });
    }
    const headers = (await this.locators.snapshotHeaders().allInnerTexts()).map((value) => value.trim());
    const columns = ['Name', 'Email', 'Phone'].map((name) => {
      const index = headers.indexOf(name);
      if (index < 0 || headers.lastIndexOf(name) !== index) {
        throw new Error(`Expected one "${name}" Contacts column.`);
      }
      return index;
    });
    const rows = this.locators.snapshotRows();
    const candidates: Array<{ contact: C2cSnapshotContact; checkbox: Locator }> = [];
    for (let index = 1; index < await rows.count(); index++) {
      const row = this.locators.rowAt(rows, index);
      const cells = await this.locators.rowCells(row).allInnerTexts();
      const checkbox = this.locators.contactCheckbox(row);
      if (cells.length !== headers.length || await checkbox.count() !== 1) {
        throw new Error('Unexpected Contacts snapshot row shape.');
      }
      if (await checkbox.isEnabled()) {
        candidates.push({
          contact: { name: cells[columns[0]].trim(), email: cells[columns[1]].trim(), phone: cells[columns[2]].trim() },
          checkbox,
        });
      }
    }
    if (candidates.length === 0) {
      throw new Error('The random Contacts snapshot page contains no selectable contacts.');
    }
    const count = 1 + Math.floor(Math.random() * Math.min(3, candidates.length));
    const selected: C2cSnapshotContact[] = [];
    for (let index = 0; index < count; index++) {
      const candidate = candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0];
      await candidate.checkbox.check();
      await expect(candidate.checkbox).toBeChecked();
      selected.push(candidate.contact);
    }
    console.log(`[Contacts export] Read only random snapshot page ${pageIndex + 1}; no full contact-table scan.`);
    return selected;
  }

  private async openExports(): Promise<void> {
    await this.locators.exportsTab.click();
    await expect(this.locators.exportsTab).toHaveAttribute('aria-selected', 'true');
    await expect(this.locators.exportsTable).toBeVisible();
    await expect(this.locators.loadingExports()).toBeHidden({ timeout: 60_000 });
  }

  private async history(): Promise<ExportHistory[]> {
    const headers = (await this.locators.historyHeaders().allInnerTexts())
      .map((value) => value.trim().replace(/\s+/g, ' '));
    const column = (name: string): number => {
      const index = headers.indexOf(name);
      if (index < 0 || headers.lastIndexOf(name) !== index) {
        throw new Error(`Expected one "${name}" Contacts export history column.`);
      }
      return index;
    };
    const identity = ['Source', 'Type', 'Destination', 'Started', 'Performed by'].map(column);
    const status = column('Status');
    const state = column('Export state');
    const rows = this.locators.historyRows();
    const result: ExportHistory[] = [];
    for (let index = 1; index < await rows.count(); index++) {
      const row = this.locators.rowAt(rows, index);
      const cells = (await this.locators.rowCells(row).allInnerTexts()).map((value) => value.trim());
      if (cells.length !== headers.length) {
        if (cells.length === 1 && /no .*exports|no records|no data/i.test(cells[0])) {
          continue;
        }
        throw new Error('Unexpected Contacts export history row shape.');
      }
      result.push({ row, key: JSON.stringify(identity.map((index) => cells[index])), status: cells[status], state: cells[state] });
    }
    return result;
  }
}


export type ExportedContact = { name: string; emails: string[]; phones: string[] };

function unescapeVcard(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, escaped: string) => /n/i.test(escaped) ? '\n' : escaped);
}

export function readContactsExport(archive: Uint8Array): ExportedContact[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive);
  } catch (error) {
    throw new Error('Contacts export is not a readable ZIP archive.', { cause: error });
  }
  const contacts: ExportedContact[] = [];
  for (const [path, bytes] of Object.entries(files)) {
    if (path.endsWith('/')) {
      continue;
    }
    if (!/\.vcf$/i.test(path)) {
      throw new Error(`Unexpected Contacts export file "${path}"; expected VCF.`);
    }
    const lines = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      .replace(/^\uFEFF/, '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    let current: ExportedContact | undefined;
    let sawName = false;
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      if (/^BEGIN:VCARD$/i.test(line)) {
        if (current) {
          throw new Error(`Nested vCard record in "${path}".`);
        }
        current = { name: '', emails: [], phones: [] };
        sawName = false;
        continue;
      }
      if (/^END:VCARD$/i.test(line)) {
        if (!current || !sawName) {
          throw new Error(`Incomplete vCard record in "${path}".`);
        }
        contacts.push(current);
        current = undefined;
        continue;
      }
      const separator = line.indexOf(':');
      if (!current || separator < 0) {
        throw new Error(`Invalid vCard structure in "${path}".`);
      }
      const property = line.slice(0, separator);
      if (/ENCODING=/i.test(property)) {
        throw new Error(`Unsupported vCard encoding in "${path}": ${property}.`);
      }
      const field = property.split(';')[0].split('.').at(-1)?.toUpperCase();
      const value = unescapeVcard(line.slice(separator + 1));
      if (field === 'FN') {
        if (sawName) {
          throw new Error(`Multiple FN properties in a vCard in "${path}".`);
        }
        current.name = value;
        sawName = true;
      } else if (field === 'EMAIL') {
        current.emails.push(value);
      } else if (field === 'TEL') {
        current.phones.push(value.replace(/^tel:/i, ''));
      }
    }
    if (current) {
      throw new Error(`Unclosed vCard record in "${path}".`);
    }
  }
  if (contacts.length === 0) {
    throw new Error('Contacts export ZIP contains no vCard contacts.');
  }
  return contacts;
}
