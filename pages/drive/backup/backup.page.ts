import { expect, type Locator, type Page } from '@playwright/test';
import { testSettings } from '../../../test-settings';
import { ZohoWorkDriveApi } from '../api/zoho-workdrive.api';
import { DriveBackupAssertions, type BackupHistoryState, type DriveUser } from './backup.assertions';
import { backupLabels, backupPatterns } from './backup.labels';
import { DriveBackupLocators } from './backup.locators';

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

export type DriveSnapshotEntry = {
  name: string;
  type: 'Folder' | 'File';
  path: string;
};

export class DriveBackupPage {
  private readonly locators: DriveBackupLocators;
  private readonly assertions: DriveBackupAssertions;
  private readonly workDriveApi: ZohoWorkDriveApi;

  constructor(page: Page) {
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

  async openUsersTab(): Promise<void> {
    await this.locators.usersTab.click();
  }

  async selectUser(email: string): Promise<DriveUser> {
    await expect(this.locators.firstUserRow()).toContainText(backupPatterns.email, {
      timeout: 30_000,
    });

    const rows = this.locators.userRows();
    const rowCount = await rows.count();

    for (let index = 1; index < rowCount; index++) {
      const row = this.locators.rowAt(rows, index);
      const cells = await this.locators.rowCells(row).allInnerTexts();
      if (cells[1]?.trim() === email) {
        await row.click();
        await expect(this.locators.backupNowButton).toBeVisible();
        return { name: cells[0]?.trim() ?? '', email };
      }
    }

    throw new Error(`Could not find Drive user ${email} in the users table.`);
  }

  async getSnapshotEntries(parentPath: string[] = []): Promise<DriveSnapshotEntry[]> {
    const entries: DriveSnapshotEntry[] = [];
    const table = this.locators.snapshotTable;
    const range = this.locators.snapshotRange;

    const visitFolder = async (parentPath: string[]): Promise<void> => {
      const foldersToVisit: Array<{ name: string; path: string[] }> = [];
      const folderNames = new Set<string>();

      for (; ;) {
        await expect(this.locators.snapshotLoading).toBeHidden({ timeout: 30_000 });
        await expect(range).toBeVisible();

        const currentRange = await range.innerText();
        const rows = this.locators.tableRows(table);
        const rowCount = await rows.count();
        for (let index = 1; index < rowCount; index++) {
          const row = this.locators.rowAt(rows, index);
          const cells = await this.locators.rowCells(row).allTextContents();
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
        for (; ;) {
          await expect(this.locators.snapshotLoading).toBeHidden({ timeout: 30_000 });
          await expect(range).toBeVisible();

          const rows = this.locators.tableRows(table);
          const rowCount = await rows.count();
          for (let index = 1; index < rowCount; index++) {
            const row = this.locators.rowAt(rows, index);
            const cells = await this.locators.rowCells(row).allTextContents();
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
        await expect(this.locators.currentFolderBreadcrumb(folder.name)).toBeVisible();
        await visitFolder(folder.path);

        const parentCrumb = parentPath.at(-1) ?? backupLabels.myFolderBreadcrumb;
        await this.locators.parentFolderBreadcrumb(parentCrumb).click();
        await expect(this.locators.snapshotLoading).toBeHidden({ timeout: 60_000 });
      }
    };

    await visitFolder(parentPath);
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
    await this.waitForLatestBackupCompleted(user, previousBackupState);

    await this.openUsersTab();
    await this.selectUser(user.email);
    this.assertions.expectSnapshotEntryPresent(expectedEntry, await this.findSnapshotEntry(expectedEntry));
  }

  async compareSnapshotWithNativeDrive(userEmail: string): Promise<void> {
    const sourceEntries = await this.workDriveApi.listFilesAndFolders();
    await this.openUsersTab();
    const user = await this.selectUser(userEmail);
    const snapshotEntries = await this.getSnapshotEntries();
    this.assertions.expectSnapshotMatchesSource(sourceEntries, snapshotEntries);
    log(`[Zoho Backup Suite] Drive comparison completed for ${user.email}.`);
  }


  async getBackupHistoryState(user: DriveUser): Promise<BackupHistoryState> {
    await this.locators.backupsTab.click();

    const tabPanel = this.locators.historyPanel;
    await this.filterBackupHistoryByUser(tabPanel, user.name);
    const range = this.locators.pageRange(tabPanel);
    await expect(range).toBeVisible();
    const countMatch = (await range.innerText()).match(/of\s+(\d+)/);
    if (!countMatch) {
      throw new Error('Could not read the Drive backup history row count.');
    }

    const rows = this.locators.historyRows();
    const rowCount = await rows.count();

    for (let index = 1; index < rowCount; index++) {
      const cells = await this.locators.rowCells(this.locators.rowAt(rows, index)).allInnerTexts();
      if (cells[1]?.trim() === user.email && cells[0]?.trim()) {
        return {
          timestamp: cells[0].trim(),
          status: cells[2]?.trim() ?? '',
          totalCount: Number(countMatch[1]),
        };
      }
    }

    return {
      timestamp: '',
      status: '',
      totalCount: Number(countMatch[1]),
    };
  }

  private async findSnapshotEntry(entryName: string): Promise<boolean> {
    const range = this.locators.snapshotRange;

    for (; ;) {
      await expect(this.locators.snapshotLoading).toBeHidden({ timeout: 30_000 });
      await expect(range).toBeVisible();

      const rows = this.locators.tableRows(this.locators.snapshotTable);
      const rowCount = await rows.count();
      for (let index = 1; index < rowCount; index++) {
        const cells = await this.locators.rowCells(this.locators.rowAt(rows, index)).allInnerTexts();
        if (cells[1]?.trim() === entryName) {
          log(`[Zoho backup] Verified snapshot contains "${entryName}".`);
          return true;
        }
      }

      const currentRange = await range.innerText();
      const nextPage = this.locators.snapshotNextPageButton;
      if (await nextPage.isDisabled()) {
        break;
      }

      await nextPage.click();
      await expect(range).not.toHaveText(currentRange);
    }

    return false;
  }

  async waitForLatestBackupCompleted(user: DriveUser, previousState: BackupHistoryState): Promise<void> {
    log(`[Zoho backup] Checking Backups history for ${user.email}.`);
    await this.locators.backupsTab.click();

    const tabPanel = this.locators.historyPanel;
    await this.filterBackupHistoryByUser(tabPanel, user.name);

    const readLatestUserBackup = async (): Promise<BackupHistoryState | undefined> => {
      const range = this.locators.historyRange;
      const countMatch = (await range.innerText()).match(/of\s+(\d+)/);
      if (!countMatch) {
        return undefined;
      }

      const rows = this.locators.historyRows();
      const rowCount = await rows.count();

      for (let index = 1; index < rowCount; index++) {
        const cells = await this.locators.rowCells(this.locators.rowAt(rows, index)).allInnerTexts();
        if (cells[1]?.trim() === user.email) {
          return {
            timestamp: cells[0]?.trim() ?? '',
            status: cells[2]?.trim() ?? '',
            totalCount: Number(countMatch[1]),
          };
        }
      }
    };

    let previousStatus = '';
    await expect.poll(async () => {
      await this.locators.historySearchButton.click();
      await expect(this.locators.pageLoading(tabPanel)).toBeHidden({ timeout: 30_000 });

      const latestBackup = await readLatestUserBackup();
      const status = latestBackup?.status ?? 'No history entry';
      if (status !== previousStatus) {
        log(`[Zoho backup] ${user.email} backup history status: ${status}.`);
        previousStatus = status;
      }

      const isNewBackup = latestBackup !== undefined && (
        latestBackup.timestamp !== previousState.timestamp ||
        latestBackup.totalCount > previousState.totalCount
      );
      if (isNewBackup) {
        expect(latestBackup.status, `Backup failed for ${user.email}.`).not.toMatch(/fail/i);
      }

      return isNewBackup && latestBackup.status === 'Completed';
    }, {
      timeout: 8 * 60_000,
      intervals: [5_000],
    }).toBe(true);

    const latestBackup = await readLatestUserBackup();
    if (!latestBackup) {
      throw new Error(`No backup history entry was found for ${user.email} after the backup completed.`);
    }

    this.assertions.expectLatestBackupCompleted(user, previousState, latestBackup);
  }

  private async filterBackupHistoryByUser(tabPanel: Locator, userName: string): Promise<void> {
    const selectedUser = this.locators.userSelector(tabPanel, userName);
    if (!(await selectedUser.isVisible())) {
      await this.locators.selectUserButton(tabPanel).click();
      await this.locators.userOption(userName).click();
    }

    await this.locators.historySearchButton.click();
    await expect(this.locators.pageLoading(tabPanel)).toBeHidden({ timeout: 30_000 });
    await expect(this.locators.pageRange(tabPanel)).toBeVisible();
  }
}
