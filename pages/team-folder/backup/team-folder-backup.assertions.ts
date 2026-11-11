import { expect } from '@playwright/test';
import {
  compareWorkDriveEntries,
  type DriveInventoryEntry,
} from '../../drive/backup/backup.assertions';
import type {
  WorkDriveEntry,
  WorkDriveTeamFolder,
  WorkDriveTeamFolderFixture,
} from '../../drive/api/zoho-workdrive.api';
import type { C2CTeamFolder } from './team-folder-backup.page';

export function teamFolderKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function uniqueTeamFoldersByName<T extends { name: string }>(
  folders: T[],
  source: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const folder of folders) {
    const key = teamFolderKey(folder.name);
    if (result.has(key)) {
      throw new Error(`${source} has multiple Team Folders named "${folder.name}"; cannot safely match the inventory.`);
    }
    result.set(key, folder);
  }
  return result;
}

export function compareTeamFolderInventory(
  sourceEntries: WorkDriveEntry[],
  snapshotEntries: WorkDriveEntry[],
): { missingFromC2C: DriveInventoryEntry[]; extraInC2C: DriveInventoryEntry[] } {
  return compareWorkDriveEntries(sourceEntries, snapshotEntries);
}

export class TeamFolderBackupAssertions {
  expectTeamFolderListsMatch(
    sourceFolders: WorkDriveTeamFolder[],
    c2cFolders: C2CTeamFolder[],
  ): Map<string, C2CTeamFolder> {
    const sourceByName = uniqueTeamFoldersByName(sourceFolders, 'Zoho WorkDrive');
    const c2cByName = uniqueTeamFoldersByName(c2cFolders, 'C2C');
    const missingFolders = sourceFolders.filter((folder) => !c2cByName.has(teamFolderKey(folder.name)));
    const extraFolders = c2cFolders.filter((folder) => !sourceByName.has(teamFolderKey(folder.name)));

    expect(
      missingFolders.map((folder) => folder.name),
      'Every Zoho WorkDrive Team Folder must be present in C2C before backup processing starts.',
    ).toEqual([]);
    expect(
      extraFolders.map((folder) => folder.name),
      'Every C2C Team Folder must have a matching Zoho WorkDrive Team Folder.',
    ).toEqual([]);

    return c2cByName;
  }

  expectTeamFolderInventoryMatches(
    teamName: string,
    sourceEntries: WorkDriveEntry[],
    snapshotEntries: WorkDriveEntry[],
    fixture?: WorkDriveTeamFolderFixture,
  ): void {
    if (fixture) {
      const requiredFiles = [
        `${fixture.folderName}\\${fixture.textFileName}`,
        `${fixture.folderName}\\${fixture.imageFileName}`,
      ];
      expect(
        sourceEntries.some((entry) => entry.type === 'Folder' && entry.path === fixture.folderName),
        `Zoho WorkDrive Team Folder "${teamName}" must contain the created folder.`,
      ).toBe(true);
      expect(
        snapshotEntries.some((entry) => entry.type === 'Folder' && entry.path === fixture.folderName),
        `C2C snapshot for "${teamName}" must contain the created folder.`,
      ).toBe(true);
      for (const filePath of requiredFiles) {
        expect(
          sourceEntries.some((entry) => entry.type === 'File' && entry.path === filePath),
          `Zoho WorkDrive Team Folder "${teamName}" must contain "${filePath}".`,
        ).toBe(true);
        expect(
          snapshotEntries.some((entry) => entry.type === 'File' && entry.path === filePath),
          `C2C snapshot for "${teamName}" must contain "${filePath}".`,
        ).toBe(true);
      }
    }

    const differences = compareTeamFolderInventory(sourceEntries, snapshotEntries);
    if (differences.missingFromC2C.length || differences.extraInC2C.length) {
      logTeamFolderDifferences(teamName, differences);
    }
    console.table([{
      TeamFolder: teamName,
      ZohoEntries: sourceEntries.length,
      C2CEntries: snapshotEntries.length,
      MissingFromC2C: differences.missingFromC2C.length,
      ExtraInC2C: differences.extraInC2C.length,
    }]);
    expect(differences.missingFromC2C, `${teamName} items are missing from the C2C snapshot.`).toEqual([]);
    expect(differences.extraInC2C, `The C2C snapshot for ${teamName} contains unexpected items.`).toEqual([]);
  }
}

export function logTeamFolderDifferences(
  name: string,
  differences: {
    missingFromC2C: DriveInventoryEntry[];
    extraInC2C: DriveInventoryEntry[];
  },
): void {
  for (const entry of differences.missingFromC2C) {
    console.log(`[Zoho Backup Suite] ${name}: missing from C2C: ${entry.type} ${entry.path}`);
  }
  for (const entry of differences.extraInC2C) {
    console.log(`[Zoho Backup Suite] ${name}: extra in C2C: ${entry.type} ${entry.path}`);
  }
}
