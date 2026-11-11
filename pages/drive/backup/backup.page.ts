import { expect, type Locator, type Page } from '@playwright/test';
import { backupLabels, backupPatterns } from './backup.labels';
import { DriveBackupAssertions, type BackupHistoryState, type DriveUser } from './backup.assertions';
import { DriveBackupLocators } from './backup.locators';
import { ZohoWorkDriveApi } from '../api/zoho-workdrive.api';
import { testSettings } from '../../../test-settings';

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

export type DriveSnapshotEntry = {
  name: string;
  type: 'Folder' | 'File';
  path: string;
};

export type DriveExportResult = {
  selectedEntries: DriveSnapshotEntry[];
  status: 'Active';
};

type ExportCandidate = DriveSnapshotEntry & { checkbox: Locator };
type ExportHistoryRow = { text: string; cells: string[] };

export class DriveBackupPage {
  private readonly locators: DriveBackupLocators;
  private readonly assertions: DriveBackupAssertions;
  private readonly workDriveApi: ZohoWorkDriveApi;

  constructor(private readonly page: Page) {
    this.locators = new DriveBackupLocators(page);
    this.assertions = new DriveBackupAssertions(this.locators);
    this.workDriveApi = new ZohoWorkDriveApi(testSettings.zohoWorkDrive);
  }

  async createNativeFolder(): Promise<string> {
    const runStamp = new Date().toISOString().replace(/[-:T.Z]/g, '');
    const folderName = `test-${runStamp}`;
    await this.workDriveApi.createFolder(folderName);
    log(`[Zoho WorkDrive] Created folder "${folderName}".`);
    return folderName;
  }

  async getBackupHistoryState(user: DriveUser): Promise<BackupHistoryState> {
    return this.assertions.readBackupHistoryState(user);
  }

  async openUsersTab(): Promise<void> {
    await this.locators.usersTab.click();
  }

  async selectUser(email: string): Promise<DriveUser> {
    await expect(this.locators.userRows().nth(1)).toContainText(backupPatterns.email, {
      timeout: 30_000,
    });

    const rows = this.locators.userRows();
    const rowCount = await rows.count();

    for (let index = 1; index < rowCount; index++) {
      const row = rows.nth(index);
      const cells = await this.locators.rowCells(row).allInnerTexts();
      if (cells[1]?.trim() === email) {
        await row.click();
        await expect(this.locators.backupNowButton).toBeVisible();
        return { name: cells[0]?.trim() ?? '', email };
      }
    }

    throw new Error(`Could not find Drive user ${email} in the users table.`);
  }

  async getSnapshotEntries(): Promise<DriveSnapshotEntry[]> {
    const entries: DriveSnapshotEntry[] = [];
    const table = this.locators.snapshotTable;
    const range = this.locators.snapshotRange;

    const visitFolder = async (parentPath: string[]): Promise<void> => {
      const foldersToVisit: Array<{ name: string; path: string[] }> = [];
      const folderNames = new Set<string>();

      for (;;) {
        await expect(this.locators.snapshotLoading).toBeHidden({ timeout: 30_000 });
        await expect(range).toBeVisible();

        const currentRange = await range.innerText();
        const rows = this.locators.tableRows(table);
        const rowCount = await rows.count();
        for (let index = 1; index < rowCount; index++) {
          const row = rows.nth(index);
          const cells = await this.locators.rowCells(row).allInnerTexts();
          const name = cells[1]?.trim() ?? '';
          const type = cells[2]?.trim() === backupLabels.folderType
            ? backupLabels.folderType
            : backupLabels.fileType;
          if (!name || name === backupLabels.emptyFolderMessage) {
            continue;
          }

          const path = [...parentPath, name];
          entries.push({ name, type, path: path.join('\\') });
          if (type === backupLabels.folderType) {
            if (folderNames.has(name)) {
              throw new Error(`C2C snapshot contains multiple folders named "${name}" under "${parentPath.join('\\') || 'My Folder'}"; cannot distinguish their paths.`);
            }
            folderNames.add(name);
            foldersToVisit.push({ name, path });
          }
        }

        log(`[Zoho backup] Scanned snapshot page ${currentRange} under ${parentPath.join('\\') || 'My Folder'}.`);
        const nextPage = this.locators.snapshotNextPageButton;
        if (await nextPage.isDisabled()) {
          break;
        }

        await nextPage.click();
        await expect(range).not.toHaveText(currentRange);
      }

      for (const folder of foldersToVisit) {
        while (!(await this.locators.snapshotPreviousPageButton.isDisabled())) {
          const currentRange = await range.innerText();
          await this.locators.snapshotPreviousPageButton.click();
          await expect(range).not.toHaveText(currentRange);
        }

        let folderRow: Locator | undefined;
        for (;;) {
          await expect(this.locators.snapshotLoading).toBeHidden({ timeout: 30_000 });
          await expect(range).toBeVisible();

          const rows = this.locators.tableRows(table);
          const rowCount = await rows.count();
          for (let index = 1; index < rowCount; index++) {
            const row = rows.nth(index);
            const cells = await this.locators.rowCells(row).allInnerTexts();
            if (cells[1]?.trim() === folder.name && cells[2]?.trim() === backupLabels.folderType) {
              folderRow = row;
              break;
            }
          }

          if (folderRow || await this.locators.snapshotNextPageButton.isDisabled()) {
            break;
          }

          const currentRange = await range.innerText();
          await this.locators.snapshotNextPageButton.click();
          await expect(range).not.toHaveText(currentRange);
        }

        if (!folderRow) {
          throw new Error(`Could not find snapshot folder "${folder.path.join('\\')}" while reopening its parent.`);
        }

        log(`[Zoho backup] Opening snapshot folder "${folder.path.join('\\')}".`);
        await this.locators.cellAt(folderRow, 1).click();
        await expect(this.locators.snapshotBreadcrumb(folder.name).last()).toBeVisible();
        await visitFolder(folder.path);

        const parentCrumb = parentPath.at(-1) ?? backupLabels.myFolderBreadcrumb;
        await this.locators.snapshotBreadcrumbButton(parentCrumb).last().click();
        await expect(this.locators.snapshotLoading).toBeHidden({ timeout: 60_000 });
      }
    };

    await visitFolder([]);
    return entries;
  }

  async startBackup(): Promise<void> {
    log('[Zoho backup] Clicking Backup now.');
    await this.locators.backupNowButton.click();
  }

  async backupUserAndVerifySnapshot(userEmail: string, expectedEntry: string): Promise<void> {
    await this.openUsersTab();
    const user = await this.selectUser(userEmail);
    const previousBackupState = await this.getBackupHistoryState(user);
    await this.openUsersTab();
    await this.selectUser(user.email);

    log(`[Zoho C2C] Starting backup for native account ${user.email}.`);
    await this.startBackup();
    await this.assertions.expectBackupStartedNotification();
    await this.assertions.expectLatestBackupCompleted(user, previousBackupState);

    await this.openUsersTab();
    await this.selectUser(user.email);
    await this.assertions.expectSnapshotEntryPresent(expectedEntry);
  }

  async expectSnapshotMatchesNativeDrive(userEmail: string): Promise<void> {
    const sourceEntries = await this.workDriveApi.listFilesAndFolders();
    await this.openUsersTab();
    const user = await this.selectUser(userEmail);
    const snapshotEntries = await this.getSnapshotEntries();
    this.assertions.expectSnapshotMatchesSource(sourceEntries, snapshotEntries);
    log(`[Zoho Backup Suite] Drive comparison completed for ${user.email}.`);
  }

  async exportRandomSnapshotEntriesAndWait(userEmail: string): Promise<DriveExportResult> {
    await this.openUsersTab();
    const user = await this.selectUser(userEmail);

    await this.openExportsTab();
    const previousRows = await this.readExportHistoryRows();
    await this.openUsersTab();
    await this.selectUser(user.email);

    const candidates = await this.getVisibleExportCandidates();
    const selectedEntries = chooseRandomDriveExportEntries(candidates);
    for (const entry of selectedEntries) {
      await entry.checkbox.check();
    }

    await expect(this.locators.snapshotExportButton).toBeEnabled();
    log(`[Zoho C2C Drive] Preparing export for ${selectedEntries.map(({ path }) => path).join(', ')}.`);
    await this.locators.snapshotExportButton.click();
    await expect(this.locators.exportDialog).toBeVisible({ timeout: 15_000 });
    await expect(this.locators.selectedItemsRadio).toBeChecked();
    const exportStartedAt = Date.now();
    await this.locators.confirmExportButton.click();
    await expect(this.locators.exportDialog).toBeHidden({ timeout: 30_000 });
    log(`[Zoho C2C Drive] Submitted export for ${selectedEntries.map(({ path }) => path).join(', ')}.`);

    await this.openExportsTab();
    let latestStatus: string | undefined;
    await expect.poll(async () => {
      await this.refreshExportsTab();
      const currentRows = await this.readExportHistoryRows();
      const previousText = new Set(previousRows.map(({ text }) => text));
      const newRow = currentRows.find(({ text }) => !previousText.has(text));
      if (!newRow) {
        return '';
      }

      const status = newRow.cells.find((cell) => /\b(?:active|failed)\b/i.test(cell))?.trim();
      if (status && /^failed\b/i.test(status)) {
        throw new Error(
          `Drive export failed for ${user.email} after selecting ${selectedEntries.map(({ path }) => path).join(', ')}. Row: ${newRow.text}`,
        );
      }
      latestStatus = status;
      return status ?? '';
    }, {
      timeout: 10 * 60_000,
      intervals: [2_000, 5_000],
      message: `Waiting for the Drive export for ${user.email} to become Active.`,
    }).toMatch(/^active$/i);

    const elapsedSeconds = ((Date.now() - exportStartedAt) / 1000).toFixed(1);
    log(`[Zoho C2C Drive] Export for ${user.email} reached ${latestStatus} in ${elapsedSeconds}s.`);
    return { selectedEntries, status: 'Active' };
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
      const row = rows.nth(index);
      const cells = (await this.locators.rowCells(row).allInnerTexts()).map((cell) => cell.trim());
      result.push({ text: cells.join(' | '), cells });
    }
    return result;
  }

  private async getVisibleExportCandidates(): Promise<ExportCandidate[]> {
    await expect(this.locators.snapshotLoading).toBeHidden({ timeout: 30_000 });
    await expect(this.locators.snapshotRange).toBeVisible({ timeout: 30_000 });
    const rows = this.locators.tableRows(this.locators.snapshotTable);
    const candidates: ExportCandidate[] = [];

    for (let index = 1; index < await rows.count(); index++) {
      const row = rows.nth(index);
      const cells = await this.locators.rowCells(row).allInnerTexts();
      const name = cells[1]?.trim() ?? '';
      const type = cells[2]?.trim();
      if (!name || (type !== backupLabels.folderType && type !== backupLabels.fileType)) {
        continue;
      }

      const checkbox = row.getByRole('checkbox');
      if (await checkbox.count() !== 1 || !(await checkbox.isEnabled())) {
        continue;
      }
      candidates.push({
        name,
        type,
        path: name,
        checkbox,
      });
    }
    if (candidates.length === 0) {
      throw new Error('The selected Drive snapshot page has no selectable files or folders to export.');
    }
    return candidates;
  }

}

export function chooseRandomDriveExportEntries<T extends Pick<DriveSnapshotEntry, 'type'>>(
  entries: T[],
  random: () => number = Math.random,
): T[] {
  const remaining = [...entries];
  const selected: T[] = [];
  const pickOne = (type: DriveSnapshotEntry['type']): void => {
    const matching = remaining.filter((entry) => entry.type === type);
    if (matching.length === 0) {
      return;
    }
    const index = Math.floor(random() * matching.length);
    const [entry] = matching.splice(index, 1);
    selected.push(entry);
    remaining.splice(remaining.indexOf(entry), 1);
  };

  pickOne('File');
  pickOne('Folder');
  while (selected.length < 3 && remaining.length > 0) {
    const index = Math.floor(random() * remaining.length);
    selected.push(remaining.splice(index, 1)[0]);
  }
  return selected;
}
