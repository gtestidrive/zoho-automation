import { expect, type Locator, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ExportDownloadPage } from '../../export/export-download.page';
import { exportLog } from '../../export/export-log';
import type { WorkDriveEntry } from '../api/zoho-workdrive.api';
import { backupLabels } from '../backup/backup.labels';
import type { DriveSnapshotEntry } from '../backup/backup.page';
import {
  DriveExportAssertions,
  normalizeArchivePath,
  type DriveExportContentIssue,
} from './drive-export.assertions';
import { exportPatterns } from './drive-export.labels';
import { DriveExportLocators } from './drive-export.locators';

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

export type DriveExportResult = {
  selectedEntries: DriveSnapshotEntry[];
  status: 'Active';
  archivePath: string;
  archiveEntries: string[];
};

type ExportCandidate = DriveSnapshotEntry & { row: Locator; checkbox: Locator; pageIndex: number };
type ExportHistoryRow = { text: string; cells: string[]; locator: Locator };

export type WorkDriveExportContext = {
  product: string;
  typeColumn: number;
  openRoot: (name: string) => Promise<void>;
  readCurrentFolder: (parentPath: string[]) => Promise<DriveSnapshotEntry[]>;
  listSource: (selectedEntries: DriveSnapshotEntry[]) => Promise<WorkDriveEntry[]>;
  downloadSource: (fileId: string) => Promise<Uint8Array>;
};

export class WorkDriveExportPage {
  private readonly locators: DriveExportLocators;
  private readonly assertions: DriveExportAssertions;
  constructor(
    private readonly page: Page,
    locators: DriveExportLocators,
    private readonly context: WorkDriveExportContext,
  ) {
    this.locators = locators;
    this.assertions = new DriveExportAssertions(this.locators, this.context.product);
  }

  async exportRandomSnapshotEntriesAndWait(
    userEmail: string,
    downloadDirectory: string,
  ): Promise<DriveExportResult> {
    const runStartedAt = Date.now();
    exportLog(this.context.product, 'Start', `Source="${userEmail}", download directory="${downloadDirectory}". Using existing snapshot; no backup created.`);
    await this.context.openRoot(userEmail);
    const user = { email: userEmail };

    await this.openExportsTab();
    const previousText = new Set((await this.readExportHistoryRows()).map(({ text }) => text));
    await this.context.openRoot(user.email);

    const candidates = await this.getExportCandidates();
    const selectedEntries = chooseRandomDriveExportEntries(candidates);
    this.assertions.expectFolderSelected(selectedEntries);
    console.table(selectedEntries.map(({ name, path, type, pageIndex }) => ({
      SelectedName: name, SelectedPath: path, Type: type, SnapshotPage: pageIndex + 1,
    })));
    const snapshotEntries: DriveSnapshotEntry[] = [];
    for (const entry of selectedEntries) {
      snapshotEntries.push({ name: entry.name, path: entry.path, type: entry.type });
      if (entry.type === 'Folder') {
        await this.openSnapshotPage(entry.pageIndex);
        log(`[${this.context.product}] Scanning only selected folder "${entry.path}" and its descendants.`);
        await this.locators.snapshot.cellAt(entry.row, 1).click();
        await expect(this.locators.currentFolderBreadcrumb(entry.name)).toBeVisible();
        snapshotEntries.push(...await this.context.readCurrentFolder(entry.path.split('\\')));
        await this.context.openRoot(user.email);
      }
    }
    for (const entry of selectedEntries) {
      await this.openSnapshotPage(entry.pageIndex);
      await expect(entry.checkbox).toBeEnabled();
      await entry.checkbox.check();
    }
    for (const entry of selectedEntries) {
      await this.openSnapshotPage(entry.pageIndex);
      await expect(entry.checkbox, `Selection must persist for "${entry.path}" across snapshot pages.`).toBeChecked();
    }
    log(`[${this.context.product}] Randomly selected ${selectedEntries.length} of ${candidates.filter(({ type }) => type === 'Folder').length} folders across all root snapshot pages.`);
    const selectedPaths = selectedEntries.map(({ path }) => path).join(', ');
    exportLog(this.context.product, 'Inventory', `Captured ${snapshotEntries.length} selected C2C items including descendants.`);

    await expect(this.locators.snapshotExportButton).toBeEnabled();
    log(`[${this.context.product}] Preparing export for ${selectedPaths}.`);
    await this.locators.snapshotExportButton.click();
    await this.assertions.expectExportDialogReady();
    const exportStartedAt = Date.now();
    await this.locators.confirmExportButton.click();
    await this.assertions.expectExportDialogClosed();
    log(`[${this.context.product}] Submitted export for ${selectedPaths}.`);

    await this.openExportsTab();
    let latestStatus: string | undefined;
    let newExportText = '';
    let lastHistoryText = '';
    await expect.poll(async () => {
      await this.refreshExportsTab();
      const newRow = (await this.readExportHistoryRows()).find(({ text }) => !previousText.has(text));
      if (!newRow) {
        return '';
      }

      const status = newRow.cells.find((cell) => exportPatterns.status.test(cell))?.trim();
      if (lastHistoryText !== newRow.text) {
        exportLog(this.context.product, 'Export status',
          `Source="${user.email}", elapsed=${((Date.now() - exportStartedAt) / 1000).toFixed(1)}s, history=${newRow.text}.`);
        lastHistoryText = newRow.text;
      }
      if (status && exportPatterns.failed.test(status)) {
        throw new Error(`${this.context.product} export failed for ${user.email} after selecting ${selectedPaths}. Row: ${newRow.text}`);
      }
      latestStatus = status;
      newExportText = newRow.text;
      return status ?? '';
    }, {
      timeout: 10 * 60_000,
      intervals: [2_000, 5_000],
      message: `Waiting for the ${this.context.product} export for ${user.email} to become Active.`,
    }).toMatch(exportPatterns.active);

    const elapsedSeconds = ((Date.now() - exportStartedAt) / 1000).toFixed(1);
    log(`[${this.context.product}] Export for ${user.email} reached ${latestStatus} in ${elapsedSeconds}s.`);

    await this.refreshExportsTab();
    const completedRows = (await this.readExportHistoryRows()).filter(({ text }) => text === newExportText);
    if (completedRows.length !== 1) {
      throw new Error(
        `Expected one completed Drive export history row for ${user.email}, found ${completedRows.length}.`,
      );
    }
    const downloadAction = this.locators.downloadAction(completedRows[0].locator);
    await expect(downloadAction).toBeEnabled({ timeout: 30_000 });
    const { archivePath, archiveEntries } = await this.downloadAndSave(downloadAction, downloadDirectory);
    const archiveFiles = readDriveExportArchiveFiles(await readFile(archivePath));
    this.assertions.expectSelectionInArchive(selectedEntries, snapshotEntries, archiveEntries, archiveFiles);

    const { issues, verifiedFiles } = await verifyDriveExportContents(
      selectedEntries,
      await this.context.listSource(selectedEntries),
      archiveFiles,
      this.context.downloadSource,
      `${this.context.product}: ${user.email}`,
    );
    console.table([{
      Product: this.context.product,
      Source: user.email,
      SelectedEntries: selectedEntries.length,
      ArchiveEntries: archiveEntries.length,
      VerifiedFiles: verifiedFiles,
      Issues: issues.length,
    }]);
    this.assertions.expectNoContentIssues(issues);
    exportLog(this.context.product, 'PASS',
      `Source="${user.email}", selected folders=${selectedEntries.length}, C2C items=${snapshotEntries.length}, `
      + `ZIP files=${archiveFiles.size}, Zoho checksum matches=${verifiedFiles}, issues=0, `
      + `duration=${((Date.now() - runStartedAt) / 1000).toFixed(1)}s, ZIP="${archivePath}".`);
    return { selectedEntries, status: 'Active', archivePath, archiveEntries };
  }

  private async downloadAndSave(
    downloadAction: Locator,
    downloadDirectory: string,
  ): Promise<{ archivePath: string; archiveEntries: string[] }> {
    const archivePath = await new ExportDownloadPage(this.page, this.context.product)
      .downloadZip(downloadAction, downloadDirectory);
    const archiveEntries = readDriveExportArchiveEntries(await readFile(archivePath));
    log(`[${this.context.product}] Downloaded and inspected export ZIP at ${archivePath} (${archiveEntries.length} entries).`);
    return { archivePath, archiveEntries };
  }

  private async openExportsTab(): Promise<void> {
    await expect(this.locators.exportsTab).toBeVisible({ timeout: 30_000 });
    await this.locators.exportsTab.click();
    await expect(this.locators.exportsTab).toHaveAttribute('aria-selected', 'true');
    await expect(this.locators.exportsTable).toBeVisible({ timeout: 30_000 });
  }

  private async refreshExportsTab(): Promise<void> {
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    await this.openExportsTab();
  }

  private async readExportHistoryRows(): Promise<ExportHistoryRow[]> {
    await expect(this.locators.exportsTab).toHaveAttribute('aria-selected', 'true');
    await expect(this.locators.exportsTable).toBeVisible({ timeout: 30_000 });
    await expect(this.locators.exportsLoading).toBeHidden({ timeout: 60_000 });
    const rows = this.locators.exportRows();
    const result: ExportHistoryRow[] = [];
    for (let index = 1; index < await rows.count(); index++) {
      const row = this.locators.rowAt(rows, index);
      const cells = (await this.locators.snapshot.rowCells(row).allInnerTexts()).map((cell) => cell.trim());
      result.push({ text: cells.join(' | '), cells, locator: row });
    }
    return result;
  }

  private async openSnapshotPage(pageIndex: number): Promise<void> {
    const { snapshot } = this.locators;
    await expect(snapshot.snapshotLoading).toBeHidden({ timeout: 30_000 });
    await expect(snapshot.snapshotRange).toBeVisible({ timeout: 30_000 });
    while (!await snapshot.snapshotPreviousPageButton.isDisabled()) {
      const range = await snapshot.snapshotRange.innerText();
      await snapshot.snapshotPreviousPageButton.click();
      await expect(snapshot.snapshotRange).not.toHaveText(range);
      await expect(snapshot.snapshotLoading).toBeHidden({ timeout: 30_000 });
    }
    for (let index = 0; index < pageIndex; index++) {
      await expect(snapshot.snapshotNextPageButton).toBeEnabled();
      const range = await snapshot.snapshotRange.innerText();
      await snapshot.snapshotNextPageButton.click();
      await expect(snapshot.snapshotRange).not.toHaveText(range);
      await expect(snapshot.snapshotLoading).toBeHidden({ timeout: 30_000 });
    }
  }

  private async getExportCandidates(): Promise<ExportCandidate[]> {
    const candidates: ExportCandidate[] = [];
    await this.openSnapshotPage(0);
    for (let pageIndex = 0; ; pageIndex++) {
      candidates.push(...await this.getVisibleExportCandidates(pageIndex));
      const { snapshot } = this.locators;
      if (await snapshot.snapshotNextPageButton.isDisabled()) {
        break;
      }
      const range = await snapshot.snapshotRange.innerText();
      await snapshot.snapshotNextPageButton.click();
      await expect(snapshot.snapshotRange).not.toHaveText(range);
    }
    return candidates;
  }

  private async getVisibleExportCandidates(pageIndex: number): Promise<ExportCandidate[]> {
    const { snapshot } = this.locators;
    await expect(snapshot.snapshotLoading).toBeHidden({ timeout: 30_000 });
    await expect(snapshot.snapshotRange).toBeVisible({ timeout: 30_000 });
    const rows = snapshot.tableRows(snapshot.snapshotTable);
    const candidates: ExportCandidate[] = [];

    for (let index = 1; index < await rows.count(); index++) {
      const row = this.locators.rowAt(rows, index);
      const cells = await snapshot.rowCells(row).allTextContents();
      const name = cells[1]?.trim() ?? '';
      const type = cells[this.context.typeColumn]?.trim();
      if (!name || (type !== backupLabels.folderType && type !== backupLabels.fileType)) {
        continue;
      }

      const checkbox = this.locators.entryCheckbox(row);
      if (await checkbox.count() !== 1 || !(await checkbox.isEnabled())) {
        continue;
      }
      candidates.push({ name, type, path: name, row, checkbox, pageIndex });
    }
    return candidates;
  }
}


export function readDriveExportArchiveFiles(archive: Uint8Array): Map<string, Uint8Array> {
  let archiveFiles: Record<string, Uint8Array>;
  try {
    archiveFiles = unzipSync(archive);
  } catch (error) {
    throw new Error('Drive export is not a readable ZIP archive.', { cause: error });
  }
  return new Map(Object.entries(archiveFiles)
    .filter(([name]) => name && !name.endsWith('/'))
    .map(([name, data]) => [normalizeArchivePath(name), data]));
}

export function readDriveExportArchiveEntries(archive: Uint8Array): string[] {
  let archiveFiles: Record<string, Uint8Array>;
  try {
    archiveFiles = unzipSync(archive);
  } catch (error) {
    throw new Error('Drive export is not a readable ZIP archive.', { cause: error });
  }
  const entries = Object.keys(archiveFiles)
    .filter(Boolean)
    .map((entry) => entry.replace(/\//g, '\\').replace(/\\+$/, ''));
  if (entries.length === 0) {
    throw new Error('Drive export ZIP contains no files.');
  }
  return entries;
}

// Compares selected items and their Zoho descendants against the ZIP; tolerates an unknown top-level prefix in the ZIP.
export async function verifyDriveExportContents(
  selectedEntries: DriveSnapshotEntry[],
  sourceEntries: WorkDriveEntry[],
  archiveFiles: Map<string, Uint8Array>,
  downloadSource: (fileId: string) => Promise<Uint8Array>,
  product = 'Drive export',
): Promise<{ issues: DriveExportContentIssue[]; verifiedFiles: number }> {
  console.log(`[${new Date().toISOString()}] [${product} verification 2/2] Comparing downloaded file sizes and SHA-256 checksums with live Zoho originals.`);
  const issues: DriveExportContentIssue[] = [];
  let verifiedFiles = 0;
  const findArchiveKey = (path: string): string | undefined => {
    const wanted = path.toLowerCase();
    return [...archiveFiles.keys()].find((key) => key === wanted || key.endsWith(`\\${wanted}`));
  };

  for (const selected of selectedEntries) {
    const selectedPath = selected.path.toLowerCase();
    const expected = sourceEntries.filter((entry) => entry.type === 'File'
      && (selected.type === 'File'
        ? entry.path.toLowerCase() === selectedPath
        : entry.path.toLowerCase().startsWith(`${selectedPath}\\`)));
    const sourceItem = sourceEntries.find((entry) => entry.path.toLowerCase() === selectedPath);
    if (!sourceItem) {
      issues.push({ path: selected.path, problem: 'Selected item was not found in Zoho WorkDrive' });
      continue;
    }
    if (sourceItem.type !== selected.type) {
      issues.push({ path: selected.path, problem: `Type differs: C2C ${selected.type}, Zoho ${sourceItem.type}` });
    }

    const matchedKeys = new Set<string>();
    for (const file of expected) {
      const key = findArchiveKey(file.path);
      if (!key) {
        issues.push({ path: file.path, problem: 'Missing from export ZIP' });
        console.error(`[${product} verification 2/2] Missing downloaded file: "${file.path}". Checksum NOT verified.`);
        continue;
      }
      matchedKeys.add(key);
      const exported = archiveFiles.get(key);
      if (!exported) {
        throw new Error(`Drive export entry disappeared during verification: ${key}.`);
      }
      let original: Uint8Array;
      try {
        original = await downloadSource(file.id);
      } catch (error) {
        throw new Error(`Could not download Zoho original "${file.path}" for checksum verification.`, { cause: error });
      }
      const exportedChecksum = createHash('sha256').update(exported).digest('hex');
      const sourceChecksum = createHash('sha256').update(original).digest('hex');
      console.table([{
        Path: file.path,
        ExportBytes: exported.length,
        ZohoBytes: original.length,
        ExportSHA256: exportedChecksum,
        ZohoSHA256: sourceChecksum,
        Matches: exported.length === original.length && exportedChecksum === sourceChecksum,
      }]);
      if (exported.length !== original.length || exportedChecksum !== sourceChecksum) {
        issues.push({
          path: file.path,
          problem: `Content differs (ZIP ${exported.length} bytes, SHA-256 ${exportedChecksum}; `
            + `Zoho ${original.length} bytes, SHA-256 ${sourceChecksum})`,
        });
      } else {
        verifiedFiles++;
      }
    }

    if (selected.type === 'Folder') {
      const expectedPaths = new Set(expected.map((file) => file.path.toLowerCase()));
      for (const key of archiveFiles.keys()) {
        const inner = key.indexOf(`\\${selectedPath}\\`);
        const marker = key.startsWith(`${selectedPath}\\`) ? 0 : inner >= 0 ? inner + 1 : -1;
        if (marker < 0) {
          continue;
        }
        if (!expectedPaths.has(key.slice(marker)) && !matchedKeys.has(key)) {
          issues.push({ path: key, problem: 'Present in export ZIP but not in Zoho folder' });
        }
      }
    } else if (!findArchiveKey(selected.path) && expected.length === 0) {
      issues.push({ path: selected.path, problem: 'Missing from export ZIP' });
    }
  }
  console.log(`[${new Date().toISOString()}] [${product} verification 2/2] SHA-256 matched files=${verifiedFiles}, inventory/content issues=${issues.length}.`);
  return { issues, verifiedFiles };
}

export function chooseRandomDriveExportEntries<T extends Pick<DriveSnapshotEntry, 'type'>>(
  entries: T[],
  random: () => number = Math.random,
): T[] {
  const folders = entries.filter(({ type }) => type === 'Folder');
  if (folders.length === 0) {
    return [];
  }
  const count = 1 + Math.floor(random() * Math.min(3, folders.length));
  const selected: T[] = [];
  while (selected.length < count) {
    selected.push(folders.splice(Math.floor(random() * folders.length), 1)[0]);
  }
  return selected;
}
