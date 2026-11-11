import { expect, type Locator, type Page } from '@playwright/test';
import {
  normalizeMailSize,
  ZohoMailApi,
  type ZohoMailFolder, type ZohoMailMessage,
} from '../api/zoho-mail.api';
import { MailBackupAssertions } from './mail-backup.assertions';
import { mailBackupPatterns } from './mail-backup.labels';
import { MailBackupLocators } from './mail-backup.locators';

export type MailBackupUser = {
  name: string;
  email: string;
};

export type MailBackupState = {
  timestamp: string;
  status: string;
  totalCount: number;
};

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function normalizeAddresses(value: string): string {
  const addresses = value.match(/[^\s<,;]+@[^\s>,;]+/g);
  return (addresses ?? [value]).map((address) => address.trim().toLowerCase()).sort().join(',');
}

export class MailBackupPage {
  private readonly assertions = new MailBackupAssertions();
  private readonly locators: MailBackupLocators;

  private readonly usersTab: Locator;
  private readonly backupsTab: Locator;
  private readonly backupNowButton: Locator;
  private readonly notifications: Locator;

  constructor(private readonly page: Page) {
    this.locators = new MailBackupLocators(page);
    this.usersTab = this.locators.usersTab;
    this.backupsTab = this.locators.backupsTab;
    this.backupNowButton = this.locators.backupNowButton;
    this.notifications = this.locators.notifications;
  }

  async selectUser(email: string): Promise<MailBackupUser> {
    const normalizedEmail = email.trim();
    await this.usersTab.click();
    const allUsers = this.locators.allUsers();
    if (await allUsers.isVisible()) {
      await allUsers.click();
    }

    const search = this.locators.userSearch();
    await search.fill(normalizedEmail);
    // Wait for C2C's asynchronous filter before reading the matching row.
    await expect(this.locators.userLoading()).toBeHidden({ timeout: 30_000 });
    const rows = this.locators.userRows();
    const row = this.locators.firstUserRow(rows);
    const cells = this.locators.rowCells(row);
    await expect(this.locators.userEmailCell(cells)).toHaveText(normalizedEmail, { timeout: 30_000 });
    const user = { name: (await this.locators.userNameCell(cells).innerText()).trim(), email: normalizedEmail };
    if (!user.name) {
      throw new Error(`Mail user ${normalizedEmail} has no display name.`);
    }
    await this.locators.userName(row, user.name).click();
    await expect(this.backupNowButton).toBeVisible({ timeout: 30_000 });
    return user;
  }

  async startBackupAndWait(email: string): Promise<MailBackupState> {
    const user = await this.selectUser(email);
    const previous = await this.readLatestBackup(user);
    await this.selectUser(email);
    log(`[Zoho C2C Mail] Starting backup for ${user.email}.`);
    await this.backupNowButton.click();
    await expect(this.notifications).toContainText(mailBackupPatterns.backupInProgress, { timeout: 15_000 });

    let latest: MailBackupState | undefined;
    let lastStatus = '';
    await expect.poll(async () => {
      latest = await this.readLatestBackup(user);
      if (latest.status !== lastStatus) {
        log(`[Zoho C2C Mail] Backup history status: ${latest.status || 'no entry yet'}.`);
        lastStatus = latest.status;
      }
      // Require a changed history row so an older completed backup cannot satisfy this run.
      const isNewBackup = latest !== undefined && (
        latest.timestamp !== previous.timestamp || latest.totalCount > previous.totalCount
      );
      if (isNewBackup && /fail|error/i.test(latest.status)) {
        throw new Error(`Mail backup failed for ${user.email}: ${latest.status}.`);
      }
      return isNewBackup && latest.status === 'Completed';
    }, { timeout: 10 * 60_000, intervals: [5_000] }).toBe(true);

    if (!latest) {
      throw new Error(`No completed Mail backup was found for ${user.email}.`);
    }
    log(`[Zoho C2C Mail] Backup completed for ${user.email} at ${latest.timestamp}.`);
    return latest;
  }

  async readSnapshot(email: string): Promise<ZohoMailFolder[]> {
    log('[Zoho C2C Mail] Reading the latest snapshot folder and message metadata.');
    await this.selectUser(email);
    const folders: ZohoMailFolder[] = [];
    await this.visitFolder([], folders);
    const messageCount = folders.reduce((count, folder) => count + folder.messages.length, 0);
    log(`[Zoho C2C Mail] Snapshot inventory contains ${folders.length} folders and ${messageCount} messages.`);
    return folders;
  }

  async backupAndCompareWithNative(
    email: string,
    mailApi: ZohoMailApi,
    sentSubject: string,
  ): Promise<void> {
    let folders: ZohoMailFolder[] = [];
    await expect.poll(async () => {
      folders = await mailApi.listFoldersAndMessages(email);
      return folders.some((folder) => folder.messages.some((message) => message.subject === sentSubject));
    }, {
      timeout: 2 * 60_000,
      intervals: [5_000],
      message: `Waiting for the sent test message "${sentSubject}" to appear in native Zoho Mail.`,
    }).toBe(true);
    this.assertions.expectMessagePresent(folders, sentSubject);

    await this.startBackupAndWait(email);
    const sourceFolders = await mailApi.listFoldersAndMessages(email);
    const snapshotFolders = await this.readSnapshot(email);
    this.assertions.expectSnapshotMatchesSource(sourceFolders, snapshotFolders);
  }

  private async readLatestBackup(user: MailBackupUser): Promise<MailBackupState> {
    await this.backupsTab.click();
    const selector = this.locators.historyUserSelector();
    const selectedUser = this.locators.historyUser(user.name);
    if (!(await selectedUser.isVisible())) {
      await selector.click();
      await this.locators.userOption(this.page, user.name).click();
    }
    await this.locators.historySearch().click();
    await expect(this.locators.historyLoading()).toBeHidden({ timeout: 30_000 });

    const table = this.locators.historyTable();
    const rows = this.locators.tableRows(table);
    const range = this.locators.historyRange();
    const countMatch = (await range.innerText()).match(/of\s+(\d+)/);
    if (!countMatch) {
      throw new Error('Could not read the Mail backup history result count.');
    }
    for (let index = 1; index < await rows.count(); index++) {
      const cells = await this.locators.rowCellsAt(rows, index).allInnerTexts();
      if (cells[1]?.trim().toLowerCase() === user.email.toLowerCase()) {
        return {
          timestamp: cells[0]?.trim() ?? '',
          status: cells[2]?.trim() ?? '',
          totalCount: Number(countMatch[1]),
        };
      }

    }

    return { timestamp: '', status: '', totalCount: Number(countMatch[1]) };
  }

  private async visitFolder(parentPath: string[], folders: ZohoMailFolder[]): Promise<void> {
    const table = this.locators.snapshotTable();
    const range = this.locators.snapshotRange();
    const childFolders = new Map<string, string[]>();
    const childFolderNames = new Set<string>();
    const messages: ZohoMailMessage[] = [];

    for (; ;) {
      await expect(table).toBeVisible();
      await expect(range).toBeVisible();
      await expect(this.locators.snapshotLoading()).toBeHidden({ timeout: 30_000 });
      const rows = this.locators.tableRows(table);
      const rowCount = await rows.count();
      let folderCount = 0;
      for (let index = 1; index < rowCount; index++) {
        const cells = await this.locators.rowCellsAt(rows, index).allInnerTexts();
        const name = cells[1]?.trim() ?? '';
        if (!name) {
          continue;
        }
        const to = cells[2]?.trim() ?? '';
        const subject = cells[3]?.trim() ?? '';
        const date = cells[4]?.trim() ?? '';
        const size = cells[5]?.trim() ?? '';
        // C2C marks folder rows with NA in Date and leaves message-only columns empty.
        if (date === 'NA' && !to && !subject && !size) {
          const path = [...parentPath, name];
          const key = name.toLowerCase();
          if (childFolderNames.has(key)) {
            throw new Error(`C2C Mail snapshot has duplicate folder names under "${parentPath.join('\\') || 'Mail'}".`);
          }
          childFolderNames.add(key);
          childFolders.set(name, path);
          folders.push({ id: path.join('\\'), name, path: path.join('\\'), messages: [] });
          folderCount += 1;
        } else {
          const message: ZohoMailMessage = {
            from: normalizeAddresses(name),
            to: normalizeAddresses(to),
            subject: subject.trim().replace(/\s+/g, ' '),
            size: normalizeMailSize(size),
          };
          messages.push(message);
        }
      }

      log(`[Zoho C2C Mail] Scanned ${(await range.innerText()).trim()} under ${parentPath.join('\\') || 'Mail'}: ${rowCount - 1} rows, ${folderCount} folders.`);

      const next = this.locators.snapshotNext();
      if (await next.isDisabled()) {
        break;
      }
      const currentRange = await range.innerText();
      await next.click();
      await expect(range).not.toHaveText(currentRange);
    }

    const currentPath = parentPath.join('\\');
    const current = folders.find((folder) => folder.path === currentPath);
    if (current) {
      current.messages = messages;
    }

    // Rewind and reopen each child folder after scanning all pages in its parent.
    for (const [folderName, path] of childFolders) {
      await this.returnToFirstPage(range);
      const folderRow = await this.findFolderRow(table, folderName, range);
      if (!folderRow) {
        throw new Error(`Could not reopen C2C Mail folder "${path.join('\\')}".`);
      }
      await this.locators.folderNameCell(folderRow).click();
      const breadcrumbs = this.locators.snapshotBreadcrumbs();
      await expect(this.locators.snapshotBreadcrumb(breadcrumbs, folderName)).toBeVisible();
      await expect(this.locators.snapshotLoading()).toBeHidden({ timeout: 30_000 });
      await this.visitFolder(path, folders);
      const parentName = parentPath.at(-1) ?? 'Mail';
      await this.locators.snapshotParentBreadcrumb(parentName).click();
    }
  }

  private async returnToFirstPage(range: Locator): Promise<void> {
    const previous = this.locators.snapshotPrevious();
    while (!(await previous.isDisabled())) {
      const currentRange = await range.innerText();
      await previous.click();
      await expect(range).not.toHaveText(currentRange);
      await expect(this.locators.snapshotLoading()).toBeHidden({ timeout: 30_000 });
    }
  }

  private async findFolderRow(table: Locator, folderName: string, range: Locator): Promise<Locator | undefined> {
    for (; ;) {
      await expect(range).toBeVisible();
      await expect(this.locators.snapshotLoading()).toBeHidden({ timeout: 30_000 });
      const rows = this.locators.tableRows(table);
      for (let index = 1; index < await rows.count(); index++) {
        const row = this.locators.rowAt(rows, index);
        const cells = await this.locators.rowCells(row).allInnerTexts();
        // Keep exact display casing for lookup; duplicate detection is case-insensitive above.
        if (cells[1]?.trim() === folderName && cells[4]?.trim() === 'NA') {
          return row;
        }
      }
      const next = this.locators.snapshotNext();
      if (await next.isDisabled()) {
        return undefined;
      }
      const currentRange = await range.innerText();
      await next.click();
      await expect(range).not.toHaveText(currentRange);
      await expect(this.locators.snapshotLoading()).toBeHidden({ timeout: 30_000 });
    }
  }
}
