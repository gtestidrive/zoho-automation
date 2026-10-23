import { expect, type Page } from '@playwright/test';
import { backupLabels, backupPatterns } from './backup.labels';
import { DriveBackupAssertions, type BackupHistoryState, type DriveUser } from './backup.assertions';
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

  constructor(private readonly page: Page) {
    this.locators = new DriveBackupLocators(page);
    this.assertions = new DriveBackupAssertions(this.locators);
  }

  async selectFirstUser(): Promise<DriveUser> {
    const firstUserRow = this.locators.userRows().nth(1);
    await expect(firstUserRow).toContainText(backupPatterns.email, { timeout: 30_000 });

    const cells = await this.locators.rowCells(firstUserRow).allInnerTexts();
    const name = cells[0]?.trim() ?? '';
    const email = cells[1]?.trim() ?? '';

    if (!name || !email) {
      throw new Error('The first Drive user row must contain a name and email address.');
    }

    await firstUserRow.click();
    await expect(this.locators.backupNowButton).toBeVisible();
    return { name, email };
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
    const tabPanel = this.locators.snapshotPanel;
    const table = this.locators.snapshotTable;
    const range = this.locators.snapshotRange;

    const visitFolder = async (parentPath: string[]): Promise<void> => {
      const foldersToVisit: Array<{ name: string; path: string[]; pageIndex: number; rowIndex: number }> = [];
      let pageIndex = 0;
      let pageSize = 0;

      for (;;) {
        await expect(this.locators.snapshotLoading).toBeHidden({ timeout: 30_000 });
        await expect(range).toBeVisible();

        const currentRange = await range.innerText();
        const rangeMatch = currentRange.match(/(\d+)\s*[–-]\s*(\d+)\s+of\s+(\d+)/);
        if (!rangeMatch) {
          throw new Error(`Could not read C2C snapshot pagination range: "${currentRange}".`);
        }
        const firstItemIndex = Number(rangeMatch[1]);
        const lastItemIndex = Number(rangeMatch[2]);
        if (pageIndex === 0) {
          pageSize = lastItemIndex - firstItemIndex + 1;
        }

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
            foldersToVisit.push({ name, path, pageIndex, rowIndex: index });
          }
        }

        log(`[Zoho backup] Scanned snapshot page ${pageIndex + 1} (${currentRange}) under ${parentPath.join('\\') || 'My Folder'}.`);
        const nextPage = this.locators.snapshotNextPageButton;
        if (await nextPage.isDisabled()) {
          break;
        }

        await nextPage.click();
        await expect(range).not.toHaveText(currentRange);
        pageIndex++;
      }

      for (const folder of foldersToVisit) {
        while (pageIndex !== folder.pageIndex) {
          const currentRange = await range.innerText();
          const direction = pageIndex < folder.pageIndex ? 'next' : 'previous';
          const pageButton = this.locators.pageButton(tabPanel, direction);
          if (await pageButton.isDisabled()) {
            throw new Error(`Could not navigate to snapshot page ${folder.pageIndex + 1} to inspect "${folder.path.join('\\')}".`);
          }
          await pageButton.click();
          await expect(range).not.toHaveText(currentRange);
          pageIndex += direction === 'next' ? 1 : -1;
        }

        log(`[Zoho backup] Opening snapshot folder "${folder.path.join('\\')}".`);
        const folderRow = this.locators.rowAt(table, folder.rowIndex);
        await this.locators.cellAt(folderRow, 1).click();
        await expect(this.locators.snapshotBreadcrumb(folder.name).last()).toBeVisible();
        await visitFolder(folder.path);

        const parentCrumb = parentPath.at(-1) ?? backupLabels.myFolderBreadcrumb;
        await this.locators.snapshotBreadcrumbButton(parentCrumb).last().click();
        await expect(this.locators.snapshotLoading).toBeHidden({ timeout: 60_000 });

        const parentRange = await range.innerText();
        const parentRangeMatch = parentRange.match(/(\d+)\s*[–-]\s*(\d+)\s+of\s+(\d+)/);
        if (!parentRangeMatch || pageSize === 0) {
          throw new Error(`Could not determine the current C2C snapshot page after returning from "${folder.path.join('\\')}".`);
        }
        pageIndex = Math.floor((Number(parentRangeMatch[1]) - 1) / pageSize);
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

  async getDisplayedStorageBytes(): Promise<number> {
    await expect(this.locators.storageValue).toBeVisible();
    return this.parseSizeBytes(await this.locators.storageValue.innerText());
  }

  async sumLatestSnapshotFileSizes(): Promise<number> {
    return this.sumCurrentFolderFileSizes([]);
  }

  private async sumCurrentFolderFileSizes(folderPath: string[]): Promise<number> {
    const tabPanel = this.locators.snapshotPanel;
    const table = this.locators.snapshotTable;
    const range = this.locators.snapshotRange;
    const fileSizes: number[] = [];
    const folders: string[] = [];

    for (;;) {
      await expect(this.locators.snapshotLoading).toBeHidden({ timeout: 30_000 });
      await expect(range).toBeVisible();
      const rows = this.locators.tableRows(table);
      const rowCount = await rows.count();

      for (let index = 1; index < rowCount; index++) {
        const cells = await this.locators.rowCells(rows.nth(index)).allInnerTexts();
        const name = cells[1]?.trim() ?? '';
        const type = cells[2]?.trim() ?? '';
        const size = cells[3]?.trim() ?? '';

        if (!name || name === backupLabels.emptyFolderMessage) {
          continue;
        }

        if (type === backupLabels.folderType) {
          folders.push(name);
        } else if (size) {
          fileSizes.push(this.parseSizeBytes(size));
        } else {
          throw new Error(`Could not read the size of snapshot file "${name}".`);
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

    // Traverse nested folders recursively to compare the displayed storage total with snapshot contents.
    let totalBytes = fileSizes.reduce((total, size) => total + size, 0);
    for (const folder of folders) {
      const folderCell = this.locators.snapshotFolderCell(folder);
      await folderCell.click();
      await expect(this.locators.snapshotBreadcrumb(folder)).toBeVisible();
      totalBytes += await this.sumCurrentFolderFileSizes([...folderPath, folder]);

      const parentCrumb = folderPath.at(-1) ?? backupLabels.myFolderBreadcrumb;
      await this.locators.snapshotBreadcrumbButton(parentCrumb).click();
      await expect(this.locators.snapshotLoading).toBeHidden({ timeout: 30_000 });
    }

    return totalBytes;
  }

  private parseSizeBytes(sizeText: string): number {
    const match = sizeText.trim().match(/^([\d,.]+)\s*(B|KB|MB|GB|TB)$/i);
    if (!match) {
      throw new Error(`Unrecognized file size value: "${sizeText}".`);
    }

    const value = Number(match[1].replace(/,/g, ''));
    const unitIndex = ['B', 'KB', 'MB', 'GB', 'TB'].indexOf(match[2].toUpperCase());
    return value * 1024 ** unitIndex;
  }

}
