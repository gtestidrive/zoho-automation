import { expect } from '@playwright/test';
import type { WorkDriveEntry } from '../api/zoho-workdrive.api';
import { backupPatterns } from './backup.labels';
import { DriveBackupLocators } from './backup.locators';

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
  constructor(private readonly locators: DriveBackupLocators) { }

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

  async expectBackupStartedNotification(): Promise<void> {
    await expect(this.locators.notifications).toContainText(backupPatterns.backupInProgress, { timeout: 15_000 });
    log('[Zoho backup] Confirmed the backup-in-progress notification.');
  }

  expectSnapshotEntryPresent(entryName: string, present: boolean): void {
    expect(present, `Drive backup snapshot does not contain the expected entry "${entryName}".`).toBe(true);
  }

  expectLatestBackupCompleted(user: DriveUser, previous: BackupHistoryState, latest: BackupHistoryState): void {
    expect(latest.timestamp).toMatch(backupPatterns.backupTimestamp);
    expect(latest.status).toBe('Completed');
    expect(latest.timestamp !== previous.timestamp || latest.totalCount > previous.totalCount).toBe(true);
    log(`[Zoho backup] Verified ${user.email}'s latest backup is Completed.`);
  }
}
