import { basename, join } from 'node:path';
import { expect, type Download, type Locator, type Page } from '@playwright/test';
import {
  normalizeMailSize, type ZohoMailFolder, type ZohoMailMessage, ZohoMailApi,
} from '../api/zoho-mail.api';
import { MailBackupAssertions } from './mail-backup.assertions';
import { MailBackupLocators } from './mail-backup.locators';
import { mailBackupLabels, mailBackupPatterns } from './mail-backup.labels';

export type MailBackupUser = {
  name: string;
  email: string;
};

export type MailBackupState = {
  timestamp: string;
  status: string;
  totalCount: number;
};

export type MailInboxExportDownload = {
  folderName: string;
  archivePath: string;
  filename: string;
};

type MailExportHistoryRow = { text: string; cells: string[]; locator: Locator };

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
  private readonly usersPanel: Locator;
  private readonly backupsPanel: Locator;
  private readonly usersTable: Locator;
  private readonly backupNowButton: Locator;
  private readonly notifications: Locator;
  private readonly exportButton: Locator;
  private readonly exportDialog: Locator;
  private readonly selectedItemsRadio: Locator;
  private readonly confirmExportButton: Locator;
  private readonly exportsTab: Locator;
  private readonly exportsTable: Locator;
  private readonly exportsLoading: Locator;

  constructor(private readonly page: Page) {
    this.locators = new MailBackupLocators(page);
    this.usersTab = this.locators.usersTab;
    this.backupsTab = this.locators.backupsTab;
    this.usersPanel = this.locators.usersPanel;
    this.backupsPanel = this.locators.backupsPanel;
    this.usersTable = this.locators.usersTable;
    this.backupNowButton = this.locators.backupNowButton;
    this.notifications = this.locators.notifications;
    this.exportButton = this.locators.exportButton;
    this.exportDialog = this.locators.exportDialog;
    this.selectedItemsRadio = this.locators.selectedItemsRadio;
    this.confirmExportButton = this.locators.confirmExportButton;
    this.exportsTab = this.locators.exportsTab;
    this.exportsTable = this.locators.exportsTable;
    this.exportsLoading = this.locators.exportsLoading;
  }

  async selectUser(email: string): Promise<MailBackupUser> {
    const normalizedEmail = email.trim();
    await this.usersTab.click();
    const allUsers = this.usersPanel.getByRole('button', { name: mailBackupPatterns.allUsers });
    if (await allUsers.isVisible()) {
      await allUsers.click();
    }

    const search = this.usersPanel.getByRole('searchbox', { name: mailBackupLabels.searchUsers });
    await search.fill(normalizedEmail);
    // Wait for C2C's asynchronous filter before reading the matching row.
    await expect(this.usersPanel.getByText(mailBackupLabels.loading, { exact: true })).toBeHidden({ timeout: 30_000 });
    const rows = this.usersTable.getByRole('row');
    const row = rows.nth(1);
    const cells = row.getByRole('cell');
    await expect(cells.nth(1)).toHaveText(normalizedEmail, { timeout: 30_000 });
    const user = { name: (await cells.nth(0).innerText()).trim(), email: normalizedEmail };
    if (!user.name) {
      throw new Error(`Mail user ${normalizedEmail} has no display name.`);
    }
    await row.getByText(user.name, { exact: true }).click();
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
    await this.assertions.expectMessageToAppear(
      () => mailApi.listFoldersAndMessages(email),
      sentSubject,
    );

    await this.startBackupAndWait(email);
    const sourceFolders = await mailApi.listFoldersAndMessages(email);
    const snapshotFolders = await this.readSnapshot(email);
    this.assertions.expectSnapshotMatchesSource(sourceFolders, snapshotFolders);
  }

  async exportFolderAndDownload(email: string, folderName: string, downloadDirectory: string): Promise<MailInboxExportDownload> {
    const user = await this.selectUser(email);
    await this.openExportsTab();
    const previousRows = await this.readExportHistoryRows();

    await this.selectUser(user.email);
    const selectedFolder = await this.selectFolderForExport(folderName);

    await expect(this.exportButton).toBeEnabled();
    log(`[Zoho C2C Mail] Preparing export for folder "${selectedFolder}".`);
    await this.exportButton.click();
    await expect(this.exportDialog).toBeVisible({ timeout: 15_000 });
    await expect(this.selectedItemsRadio).toBeChecked();
    const exportStartedAt = Date.now();
    await this.confirmExportButton.click();
    await expect(this.exportDialog).toBeHidden({ timeout: 30_000 });
    log(`[Zoho C2C Mail] Submitted export for folder "${selectedFolder}".`);

    await this.openExportsTab();
    let latestStatus = '';
    let newExportText = '';
    await expect.poll(async () => {
      await this.refreshExportsTab();
      const currentRows = await this.readExportHistoryRows();
      const previousText = new Set(previousRows.map(({ text }) => text));
      const newRow = currentRows.find(({ text }) => !previousText.has(text));
      if (!newRow) {
        return '';
      }

      const status = newRow.cells.find((cell) => /\b(?:active|failed)\b/i.test(cell))?.trim() ?? '';
      if (/^failed\b/i.test(status)) {
        throw new Error(
          `Mail export failed for ${user.email}, folder "${selectedFolder}". Row: ${newRow.text}`,
        );
      }
      latestStatus = status;
      newExportText = newRow.text;
      return status;
    }, {
      timeout: 10 * 60_000,
      intervals: [2_000, 5_000],
      message: `Waiting for the Mail export for ${user.email} to become Active.`,
    }).toMatch(/^active$/i);

    const elapsedSeconds = ((Date.now() - exportStartedAt) / 1000).toFixed(1);
    log(`[Zoho C2C Mail] Export for ${user.email}, folder "${selectedFolder}", reached ${latestStatus} in ${elapsedSeconds}s.`);

    await this.refreshExportsTab();
    const completedRow = (await this.readExportHistoryRows()).find(({ text }) => text === newExportText);
    if (!completedRow) {
      throw new Error(`Could not find the completed Mail export row for folder "${selectedFolder}".`);
    }

    const downloadButton = completedRow.locator.getByRole('button', { name: /download/i });
    const downloadLink = completedRow.locator.getByRole('link', { name: /download/i });
    const downloadAction = await downloadButton.count() > 0 ? downloadButton : downloadLink;
    await expect(downloadAction).toBeEnabled({ timeout: 30_000 });
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: 60_000 }),
      downloadAction.click(),
    ]);
    return this.saveMailExportDownload(download, selectedFolder, downloadDirectory);
  }

  private async openExportsTab(): Promise<void> {
    await expect(this.exportsTab).toBeVisible({ timeout: 30_000 });
    await this.exportsTab.click();
    await expect(this.exportsTab).toHaveAttribute('aria-selected', 'true');
    await expect(this.exportsTable).toBeVisible({ timeout: 30_000 });
  }

  private async refreshExportsTab(): Promise<void> {
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    await this.openExportsTab();
  }

  private async readExportHistoryRows(): Promise<MailExportHistoryRow[]> {
    await expect(this.exportsTab).toHaveAttribute('aria-selected', 'true');
    await expect(this.exportsTable).toBeVisible({ timeout: 30_000 });
    await expect(this.exportsLoading).toBeHidden({ timeout: 60_000 });
    const rows = this.exportsTable.getByRole('row');
    const result: MailExportHistoryRow[] = [];
    for (let index = 1; index < await rows.count(); index++) {
      const locator = rows.nth(index);
      const cells = (await locator.getByRole('cell').allInnerTexts()).map((cell) => cell.trim());
      result.push({ text: cells.join(' | '), cells, locator });
    }
    return result;
  }

  private async selectFolderForExport(folderName: string): Promise<string> {
    const table = this.usersPanel.getByRole('table').last();
    const range = this.usersPanel.getByText(/\d+\s*[–-]\s*\d+\s+of\s+\d+/).last();
    const previous = this.usersPanel.getByRole('button', { name: 'Previous page', exact: true }).last();
    const next = this.usersPanel.getByRole('button', { name: 'Next page', exact: true }).last();
    const waitForPage = async (): Promise<void> => {
      await expect(this.usersPanel.getByText('Loading...', { exact: true })).toBeHidden({ timeout: 30_000 });
      await expect(table).toBeVisible({ timeout: 30_000 });
    };
    const goToFirstPage = async (): Promise<void> => {
      while (await previous.count() > 0 && !(await previous.isDisabled())) {
        const currentRange = await range.innerText();
        await previous.click();
        await expect(range).not.toHaveText(currentRange);
        await waitForPage();
      }
    };

    await waitForPage();
    await goToFirstPage();
    let targetPage: string | undefined;
    let targetCount = 0;

    for (;;) {
      await waitForPage();
      const rows = table.getByRole('row');
      for (let index = 1; index < await rows.count(); index++) {
        const row = rows.nth(index);
        const cells = await row.getByRole('cell').allInnerTexts();
        const name = cells[1]?.trim() ?? '';
        const isFolder = cells[4]?.trim() === 'NA'
          && !cells[2]?.trim()
          && !cells[3]?.trim()
          && !cells[5]?.trim();
        const checkbox = row.getByRole('checkbox');
        if (await checkbox.count() > 0 && await checkbox.isChecked()) {
          await checkbox.uncheck();
        }
        if (isFolder && name.toLowerCase() === folderName.trim().toLowerCase()) {
          targetPage = (await range.innerText()).trim();
          targetCount += 1;
        }
      }

      if (await next.count() === 0 || await next.isDisabled()) {
        break;
      }
      const currentRange = await range.innerText();
      await next.click();
      await expect(range).not.toHaveText(currentRange);
      await waitForPage();
    }

    if (targetCount !== 1 || !targetPage) {
      throw new Error(`Expected exactly one Mail snapshot folder named "${folderName}", found ${targetCount}.`);
    }

    await goToFirstPage();
    while ((await range.innerText()).trim() !== targetPage) {
      if (await next.count() === 0 || await next.isDisabled()) {
        throw new Error(`Could not return to Mail snapshot folder "${folderName}".`);
      }
      const currentRange = await range.innerText();
      await next.click();
      await expect(range).not.toHaveText(currentRange);
      await waitForPage();
    }

    const rows = table.getByRole('row');
    let targetCheckbox: Locator | undefined;
    for (let index = 1; index < await rows.count(); index++) {
      const row = rows.nth(index);
      const cells = await row.getByRole('cell').allInnerTexts();
      const name = cells[1]?.trim() ?? '';
      const isFolder = cells[4]?.trim() === 'NA'
        && !cells[2]?.trim()
        && !cells[3]?.trim()
        && !cells[5]?.trim();
      if (isFolder && name.toLowerCase() === folderName.trim().toLowerCase()) {
        targetCheckbox = row.getByRole('checkbox');
        break;
      }
    }
    if (!targetCheckbox) {
      throw new Error(`Could not find Mail snapshot folder "${folderName}" on its expected page.`);
    }
    await expect(targetCheckbox).toBeEnabled();
    await targetCheckbox.check();

    let selectedCount = 0;
    let selectedName = '';
    await goToFirstPage();
    for (;;) {
      await waitForPage();
      const pageRows = table.getByRole('row');
      for (let index = 1; index < await pageRows.count(); index++) {
        const row = pageRows.nth(index);
        const checkbox = row.getByRole('checkbox');
        if (await checkbox.count() > 0 && await checkbox.isChecked()) {
          selectedCount += 1;
          selectedName = (await row.getByRole('cell').nth(1).innerText()).trim();
        }
      }
      if (await next.count() === 0 || await next.isDisabled()) {
        break;
      }
      const currentRange = await range.innerText();
      await next.click();
      await expect(range).not.toHaveText(currentRange);
      await waitForPage();
    }
    if (selectedCount !== 1 || selectedName.toLowerCase() !== folderName.trim().toLowerCase()) {
      throw new Error(
        `Expected only Mail folder "${folderName}" to be selected for export; found ${selectedCount} selected items.`,
      );
    }

    await goToFirstPage();
    while ((await range.innerText()).trim() !== targetPage) {
      if (await next.count() === 0 || await next.isDisabled()) {
        throw new Error(`Could not return to selected Mail snapshot folder "${folderName}".`);
      }
      const currentRange = await range.innerText();
      await next.click();
      await expect(range).not.toHaveText(currentRange);
      await waitForPage();
    }
    return folderName.trim();
  }

  private async saveMailExportDownload(
    download: Download,
    folderName: string,
    downloadDirectory: string,
  ): Promise<MailInboxExportDownload> {
    const suggestedFilename = download.suggestedFilename();
    const filename = basename(suggestedFilename);
    if (!filename || filename !== suggestedFilename || !/\.zip$/i.test(filename)) {
      throw new Error(`Expected a ZIP archive for Mail folder "${folderName}", received "${suggestedFilename}".`);
    }
    const archivePath = join(downloadDirectory, filename);
    await download.saveAs(archivePath);
    log(`[Zoho C2C Mail] Downloaded folder "${folderName}" export to ${archivePath}.`);
    return { folderName, archivePath, filename };
  }

  private async readLatestBackup(user: MailBackupUser): Promise<MailBackupState> {
    await this.backupsTab.click();
    const selector = this.backupsPanel.getByRole('button', { name: 'Select User', exact: true });
    const selectedUser = this.backupsPanel.getByRole('button', { name: user.name, exact: true });
    if (!(await selectedUser.isVisible())) {
      await selector.click();
      await this.page.getByRole('option', { name: user.name, exact: true }).click();
    }
    await this.backupsPanel.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(this.backupsPanel.getByText('Loading...', { exact: true })).toBeHidden({ timeout: 30_000 });

    const table = this.backupsPanel.getByRole('table').first();
    const rows = table.getByRole('row');
    const range = this.backupsPanel.getByText(/\d+\s*[–-]\s*\d+\s+of\s+\d+/);
    const countMatch = (await range.innerText()).match(/of\s+(\d+)/);
    if (!countMatch) {
      throw new Error('Could not read the Mail backup history result count.');
    }
    for (let index = 1; index < await rows.count(); index++) {
      const cells = await rows.nth(index).getByRole('cell').allInnerTexts();
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
    const table = this.usersPanel.getByRole('table').last();
    const range = this.usersPanel.getByText(/\d+\s*[–-]\s*\d+\s+of\s+\d+/).last();
    const childFolders = new Map<string, string[]>();
    const childFolderNames = new Set<string>();
    const messages: ZohoMailMessage[] = [];

    for (;;) {
      await expect(table).toBeVisible();
      await expect(range).toBeVisible();
      await expect(this.usersPanel.getByText('Loading...', { exact: true })).toBeHidden({ timeout: 30_000 });
      const rows = table.getByRole('row');
      const rowCount = await rows.count();
      let folderCount = 0;
      for (let index = 1; index < rowCount; index++) {
        const cells = await rows.nth(index).getByRole('cell').allInnerTexts();
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

      const next = this.usersPanel.getByRole('button', { name: 'Next page', exact: true });
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
      await folderRow.getByRole('cell').nth(1).click();
      const breadcrumbs = this.usersPanel.getByRole('navigation').last();
      await expect(breadcrumbs.getByText(folderName, { exact: true }).last()).toBeVisible();
      await expect(this.usersPanel.getByText('Loading...', { exact: true })).toBeHidden({ timeout: 30_000 });
      await this.visitFolder(path, folders);
      const parentName = parentPath.at(-1) ?? 'Mail';
      await this.usersPanel.getByRole('navigation').last().getByRole('button', { name: parentName, exact: true }).click();
    }
  }

  private async returnToFirstPage(range: Locator): Promise<void> {
    const previous = this.usersPanel.getByRole('button', { name: 'Previous page', exact: true });
    while (!(await previous.isDisabled())) {
      const currentRange = await range.innerText();
      await previous.click();
      await expect(range).not.toHaveText(currentRange);
      await expect(this.usersPanel.getByText('Loading...', { exact: true })).toBeHidden({ timeout: 30_000 });
    }
  }

  private async findFolderRow(table: Locator, folderName: string, range: Locator): Promise<Locator | undefined> {
    for (;;) {
      await expect(range).toBeVisible();
      await expect(this.usersPanel.getByText('Loading...', { exact: true })).toBeHidden({ timeout: 30_000 });
      const rows = table.getByRole('row');
      for (let index = 1; index < await rows.count(); index++) {
        const row = rows.nth(index);
        const cells = await row.getByRole('cell').allInnerTexts();
        // Keep exact display casing for lookup; duplicate detection is case-insensitive above.
        if (cells[1]?.trim() === folderName && cells[4]?.trim() === 'NA') {
          return row;
        }
      }
      const next = this.usersPanel.getByRole('button', { name: 'Next page', exact: true });
      if (await next.isDisabled()) {
        return undefined;
      }
      const currentRange = await range.innerText();
      await next.click();
      await expect(range).not.toHaveText(currentRange);
      await expect(this.usersPanel.getByText('Loading...', { exact: true })).toBeHidden({ timeout: 30_000 });
    }
  }
}
