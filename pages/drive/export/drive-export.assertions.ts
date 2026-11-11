import { expect } from '@playwright/test';
import type { DriveSnapshotEntry } from '../backup/backup.page';
import type { DriveExportLocators } from './drive-export.locators';

export type DriveExportContentIssue = { path: string; problem: string };

export class NoSelectableExportFoldersError extends Error { }

export class DriveExportAssertions {
  constructor(
    private readonly locators: DriveExportLocators,
    private readonly product = 'Drive export',
  ) { }

  async expectExportDialogReady(): Promise<void> {
    await expect(this.locators.exportDialog).toBeVisible({ timeout: 15_000 });
    await expect(this.locators.selectedItemsRadio).toBeChecked();
  }

  async expectExportDialogClosed(): Promise<void> {
    await expect(this.locators.exportDialog).toBeHidden({ timeout: 30_000 });
  }

  expectFolderSelected(selectedEntries: Array<Pick<DriveSnapshotEntry, 'type'>>): void {
    if (!selectedEntries.some(({ type }) => type === 'Folder')) {
      throw new NoSelectableExportFoldersError('The snapshot has no selectable folder to export; at least one real folder must be selected.');
    }
  }

  expectSelectionInArchive(
    selectedEntries: DriveSnapshotEntry[],
    snapshotEntries: DriveSnapshotEntry[],
    archiveEntries: string[],
    archiveFiles: Map<string, Uint8Array>,
  ): void {
    console.log(`[${new Date().toISOString()}] [${this.product} verification 1/2] Comparing downloaded names, paths and types with C2C snapshot items.`);
    const expected = snapshotEntries.filter((entry) => selectedEntries.some((selected) =>
      entry.path === selected.path
      || selected.type === 'Folder' && entry.path.startsWith(`${selected.path}\\`)));
    for (const selected of selectedEntries) {
      if (!expected.some(({ path, type }) => path === selected.path && type === selected.type)) {
        throw new Error(`Selected C2C item "${selected.path}" (${selected.type}) was not found in the captured snapshot inventory.`);
      }
    }
    const downloaded: Array<{ path: string; type: DriveSnapshotEntry['type'] }> = [];
    for (const path of archiveEntries) {
      const type = archiveFiles.has(normalizeArchivePath(path)) ? 'File' : 'Folder';
      downloaded.push({ path, type });
      const parts = path.split('\\');
      for (let length = 1; length < parts.length; length++) {
        downloaded.push({ path: parts.slice(0, length).join('\\'), type: 'Folder' });
      }
    }
    const rows = expected.map((entry) => {
      const matches = downloaded.filter(({ path, type }) => type === entry.type
        && (path === entry.path || path.endsWith(`\\${entry.path}`)));
      return {
        C2CName: entry.name,
        C2CPath: entry.path,
        C2CType: entry.type,
        DownloadPath: matches[0]?.path ?? '(missing or name/path/type differs)',
        NamePathTypeMatch: matches.length > 0,
      };
    });
    console.table(rows);
    const missing = rows.filter(({ NamePathTypeMatch }) => !NamePathTypeMatch);
    console.log(`[${new Date().toISOString()}] [${this.product} verification 1/2] C2C items=${rows.length}, matched=${rows.length - missing.length}, missing/mismatched=${missing.length}.`);
    if (missing.length > 0) {
      throw new Error(
        `Drive export ZIP does not match C2C snapshot names, paths or types: ${missing.map(({ C2CPath }) => C2CPath).join(', ')}.`,
      );
    }
  }

  expectNoContentIssues(issues: DriveExportContentIssue[]): void {
    if (issues.length > 0) {
      console.table(issues);
      throw new Error(`Drive export ZIP differs from Zoho WorkDrive (${issues.length} issue(s)).`);
    }
  }
}

export function normalizeArchivePath(path: string): string {
  return path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

export function missingDriveExportEntries(
  selectedEntries: DriveSnapshotEntry[],
  archiveEntries: string[],
): DriveSnapshotEntry[] {
  return selectedEntries.filter((entry) => !driveExportContainsEntry(archiveEntries, entry));
}

function driveExportContainsEntry(archiveEntries: string[], selected: DriveSnapshotEntry): boolean {
  const normalizedName = selected.name.trim().toLowerCase();
  return archiveEntries.some((entry) => {
    const normalizedPath = entry.replace(/\//g, '\\').toLowerCase();
    if (selected.type === 'File') {
      return normalizedPath === normalizedName || normalizedPath.endsWith(`\\${normalizedName}`);
    }
    return normalizedPath === normalizedName
      || normalizedPath.startsWith(`${normalizedName}\\`)
      || normalizedPath.includes(`\\${normalizedName}\\`)
      || normalizedPath.endsWith(`\\${normalizedName}`);
  });
}
