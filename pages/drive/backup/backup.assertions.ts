import { expect, type Locator } from '@playwright/test';
import { backupPatterns } from './backup.labels';
import { DriveBackupLocators } from './backup.locators';
import type { WorkDriveEntry } from '../api/zoho-workdrive.api';

export type DriveInventoryEntry = Pick<WorkDriveEntry, 'path' | 'type'>;

function driveEntryKey(entry: DriveInventoryEntry): string {
  const path = entry.path.replace(/\//g, '\\').replace(/ {2,}/g, ' ').toLowerCase();
  return `${entry.type.toLowerCase()}:${path}`;
}

export function compareWorkDriveEntries<TSource extends DriveInventoryEntry, TSnapshot extends DriveInventoryEntry>(
  source: TSource[],
  snapshot: TSnapshot[],
): { missingFromC2C: TSource[]; extraInC2C: TSnapshot[] } {
  const snapshotKeys = new Set(snapshot.map(driveEntryKey));
  const sourceKeys = new Set(source.map(driveEntryKey));
  return {
    missingFromC2C: source.filter((entry) => !snapshotKeys.has(driveEntryKey(entry))),
    extraInC2C: snapshot.filter((entry) => !sourceKeys.has(driveEntryKey(entry))),
  };
}

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

export type BackupHistoryState = {
  timestamp: string;
  status: string;
  totalCount: number;
};

export type DriveUser = {
  name: string;
  email: string;
};

export class DriveBackupAssertions {
  constructor(private readonly locators: DriveBackupLocators) {}

  expectSnapshotMatchesSource(source: WorkDriveEntry[], snapshot: DriveInventoryEntry[]): void {
    const differences = compareWorkDriveEntries(source, snapshot);
    console.table([{
      Product: 'Drive',
      SourceEntries: source.length,
      SnapshotEntries: snapshot.length,
      MissingFromSnapshot: differences.missingFromC2C.length,
      ExtraInSnapshot: differences.extraInC2C.length,
    }]);
    for (const entry of differences.missingFromC2C) {
      log(`[Zoho Backup Suite] Drive: missing from C2C: ${entry.type} ${entry.path}`);
    }
    for (const entry of differences.extraInC2C) {
      log(`[Zoho Backup Suite] Drive: extra in C2C: ${entry.type} ${entry.path}`);
    }
    expect(differences.missingFromC2C, 'Drive items are missing from the C2C snapshot.').toEqual([]);
    expect(differences.extraInC2C, 'The C2C Drive snapshot contains unexpected items.').toEqual([]);
  }

  async readBackupHistoryState(user: DriveUser): Promise<BackupHistoryState> {
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
      const cells = await this.locators.rowCells(rows.nth(index)).allInnerTexts();
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

  async expectBackupStartedNotification(): Promise<void> {
    await expect(this.locators.notifications).toContainText(backupPatterns.backupInProgress, { timeout: 15_000 });
    log('[Zoho backup] Confirmed the backup-in-progress notification.');
  }

  async expectSnapshotEntryPresent(entryName: string): Promise<void> {
    const range = this.locators.snapshotRange;

    for (;;) {
      await expect(this.locators.snapshotLoading).toBeHidden({ timeout: 30_000 });
      await expect(range).toBeVisible();

      const rows = this.locators.tableRows(this.locators.snapshotTable);
      const rowCount = await rows.count();
      for (let index = 1; index < rowCount; index++) {
        const cells = await this.locators.rowCells(rows.nth(index)).allInnerTexts();
        if (cells[1]?.trim() === entryName) {
          log(`[Zoho backup] Verified snapshot contains "${entryName}".`);
          return;
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

    throw new Error(`Drive backup snapshot does not contain the expected entry "${entryName}".`);
  }

  async expectLatestBackupCompleted(user: DriveUser, previousState: BackupHistoryState): Promise<void> {
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
        const cells = await this.locators.rowCells(rows.nth(index)).allInnerTexts();
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

    expect(latestBackup.timestamp).toMatch(backupPatterns.backupTimestamp);
    expect(latestBackup.status).toBe('Completed');
    expect(
      latestBackup.timestamp !== previousState.timestamp ||
      latestBackup.totalCount > previousState.totalCount,
    ).toBe(true);
    log(`[Zoho backup] Verified ${user.email}'s latest backup is Completed.`);
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
