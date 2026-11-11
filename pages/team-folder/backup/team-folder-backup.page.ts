import { expect, type Locator, type Page } from '@playwright/test';
import {
  type WorkDriveEntry,
  type WorkDriveTeamFolder,
  type WorkDriveTeamFolderFixture,
  ZohoWorkDriveApi,
} from '../../drive/api/zoho-workdrive.api';
import {
  TeamFolderBackupAssertions,
  teamFolderKey,
} from './team-folder-backup.assertions';
import { TeamFolderBackupLocators } from './team-folder-backup.locators';
import { teamFolderBackupLabels, teamFolderBackupPatterns } from './team-folder-backup.labels';

export type C2CTeamFolder = {
  name: string;
  owner: string;
  status: string;
  lastBackup: string;
  storage: string;
};

export type TeamFolderBackupState = {
  timestamp: string;
  status: string;
  totalCount: number;
};

export type TeamFolderRun = {
  sourceFolder: WorkDriveTeamFolder;
  c2cFolder: C2CTeamFolder;
  fixture?: WorkDriveTeamFolderFixture;
};

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

export class TeamFolderBackupPage {
  private readonly assertions = new TeamFolderBackupAssertions();
  private readonly locators: TeamFolderBackupLocators;

  private readonly main: Locator;
  private readonly teamFoldersTab: Locator;
  private readonly backupsTab: Locator;
  private readonly teamFoldersPanel: Locator;
  private readonly backupsPanel: Locator;
  private readonly notifications: Locator;

  constructor(private readonly page: Page) {
    this.locators = new TeamFolderBackupLocators(page);
    this.main = this.locators.main;
    this.teamFoldersTab = this.locators.teamFoldersTab;
    this.backupsTab = this.locators.backupsTab;
    this.teamFoldersPanel = this.locators.teamFoldersPanel;
    this.backupsPanel = this.locators.backupsPanel;
    this.notifications = this.locators.notifications;
  }

  async listTeamFolders(): Promise<C2CTeamFolder[]> {
    await this.teamFoldersTab.click();
    const allTeams = this.teamFoldersPanel.getByRole('button', { name: /All Team Folders/ });
    if (await allTeams.isVisible()) {
      await allTeams.click();
    }
    const search = this.teamFoldersPanel.getByRole('searchbox', { name: teamFolderBackupLabels.searchTeamFolders });
    await search.fill('');
    await expect(this.teamFoldersPanel.getByText(teamFolderBackupLabels.loading, { exact: true })).toBeHidden({ timeout: 30_000 });

    const table = this.teamFoldersPanel.getByRole('table').first();
    const headers = (await table.getByRole('columnheader').allInnerTexts()).map((value) => value.trim().toLowerCase());
    const nameColumn = this.columnIndex(headers, 'folder name');
    const ownerColumn = this.columnIndex(headers, 'owner');
    const lastBackupColumn = this.columnIndex(headers, 'last backup');
    const storageColumn = this.columnIndex(headers, 'storage used');
    const range = this.teamFoldersPanel.getByText(teamFolderBackupPatterns.pagination).last();
    const teams: C2CTeamFolder[] = [];

    for (;;) {
      await expect(range).toBeVisible();
      await expect(this.teamFoldersPanel.getByText(teamFolderBackupLabels.loading, { exact: true })).toBeHidden({ timeout: 30_000 });
      const rows = table.getByRole('row');
      for (let index = 1; index < await rows.count(); index++) {
        const cells = await rows.nth(index).getByRole('cell').allInnerTexts();
        const name = cells[nameColumn]?.trim() ?? '';
        if (name) {
          teams.push({
            name,
            owner: cells[ownerColumn]?.trim() ?? '',
            lastBackup: cells[lastBackupColumn]?.trim() ?? '',
            storage: cells[storageColumn]?.trim() ?? '',
            status: '',
          });
        }
      }
      const next = this.teamFoldersPanel.getByRole('button', { name: teamFolderBackupLabels.nextPage, exact: true });
      if (await next.isDisabled()) {
        break;
      }
      const currentRange = await range.innerText();
      await next.click();
      await expect(range).not.toHaveText(currentRange);
    }
    log(`[C2C Team Folders] Found ${teams.length} folders.`);
    return teams;
  }

  async openTeamFolder(name: string): Promise<C2CTeamFolder> {
    await this.teamFoldersTab.click();
    const allTeams = this.teamFoldersPanel.getByRole('button', { name: /All Team Folders/ });
    if (await allTeams.isVisible()) {
      await allTeams.click();
    }
    const search = this.teamFoldersPanel.getByRole('searchbox', { name: teamFolderBackupLabels.searchTeamFolders });
    await search.fill(name);
    await expect(this.teamFoldersPanel.getByText(teamFolderBackupLabels.loading, { exact: true })).toBeHidden({ timeout: 30_000 });

    const row = this.teamFoldersPanel.getByRole('table').first().getByRole('row').nth(1);
    const cells = row.getByRole('cell');
    await expect(cells.nth(0)).toHaveText(name, { timeout: 30_000 });
    const [owner, lastBackup, storage] = await Promise.all([
      cells.nth(1).innerText(), cells.nth(3).innerText(), cells.nth(4).innerText(),
    ]);
    await row.getByText(name, { exact: true }).click();
    await expect(this.teamFoldersPanel.getByRole('button', { name: /All Team Folders/ })).toBeVisible({ timeout: 30_000 });
    await expect(this.teamFoldersPanel.getByRole('searchbox', { name: teamFolderBackupLabels.searchFoldersAndFiles })).toBeVisible({ timeout: 30_000 });
    await expect(this.teamFoldersPanel.getByText(teamFolderBackupLabels.loading, { exact: true })).toBeHidden({ timeout: 30_000 });
    const statusCard = this.main.locator('.rcv-stat-item__body').filter({ hasText: /^Status/ }).first();
    const status = (await statusCard.innerText()).replace(/^Status\s*/, '').trim();
    return { name, owner: owner.trim(), lastBackup: lastBackup.trim(), storage: storage.trim(), status };
  }

  async startBackupAndWait(team: C2CTeamFolder): Promise<TeamFolderBackupState> {
    const previous = await this.readLatestBackup(team.name);
    await this.openTeamFolder(team.name);
    const backupNow = this.teamFoldersPanel.getByRole('button', { name: /Backup now/i });
    await expect(backupNow).toBeVisible();
    log(`[C2C Team Folders] Starting backup for active team folder "${team.name}".`);
    await backupNow.click();
    await expect(this.notifications).toContainText(teamFolderBackupPatterns.backupInProgress, { timeout: 15_000 });

    let latest = previous;
    let lastStatus = '';
    await expect.poll(async () => {
      latest = await this.readLatestBackup(team.name);
      if (latest.status !== lastStatus) {
        log(`[C2C Team Folders] ${team.name} backup status: ${latest.status || 'no entry yet'}.`);
        lastStatus = latest.status;
      }
      const isNewBackup = latest.timestamp !== previous.timestamp || latest.totalCount > previous.totalCount;
      if (isNewBackup && /fail|error/i.test(latest.status)) {
        throw new Error(`Team Folder backup failed for ${team.name}: ${latest.status}.`);
      }
      return isNewBackup && latest.status === 'Completed';
    }, { timeout: 15 * 60_000, intervals: [5_000] }).toBe(true);

    log(`[C2C Team Folders] Backup completed for "${team.name}" at ${latest.timestamp}.`);
    return latest;
  }

  async readSnapshot(teamName: string): Promise<WorkDriveEntry[]> {
    await this.openTeamFolder(teamName);
    const entries: WorkDriveEntry[] = [];
    await this.visitFolder([], entries);
    log(`[C2C Team Folders] Snapshot for "${teamName}" contains ${entries.length} files and folders.`);
    return entries;
  }

  async listMatchingTeams(api: ZohoWorkDriveApi): Promise<TeamFolderRun[]> {
    const c2cFolders = await this.listTeamFolders();
    const sourceFolders = await api.listTeamFolders();
    if (sourceFolders.length === 0) {
      throw new Error('Zoho WorkDrive has no Team Folders to back up or compare.');
    }
    const c2cByName = this.assertions.expectTeamFolderListsMatch(sourceFolders, c2cFolders);
    return sourceFolders.map((sourceFolder) => {
      const c2cFolder = c2cByName.get(teamFolderKey(sourceFolder.name));
      if (!c2cFolder) {
        throw new Error(`C2C Team Folder "${sourceFolder.name}" disappeared from its inventory.`);
      }
      return { sourceFolder, c2cFolder };
    });
  }

  async createFolderForTeam(api: ZohoWorkDriveApi, team: TeamFolderRun): Promise<TeamFolderRun> {
    const c2cFolder = await this.openTeamFolder(team.c2cFolder.name);
    if (c2cFolder.status.trim().toLowerCase() !== 'active') {
      log(`[C2C Team Folders] Skipping fixture creation for inactive Team Folder "${c2cFolder.name}".`);
      return { ...team, c2cFolder };
    }
    const fixture = await api.createTeamFolder(team.sourceFolder.id);
    return { ...team, c2cFolder, fixture };
  }

  async backupAndCompareTeam(api: ZohoWorkDriveApi, team: TeamFolderRun): Promise<void> {
    if (team.c2cFolder.status.trim().toLowerCase() === 'active') {
      await this.startBackupAndWait(team.c2cFolder);
    } else {
      log(`[C2C Team Folders] Skipping backup for inactive Team Folder "${team.c2cFolder.name}".`);
    }

    const snapshotEntries = await this.readSnapshot(team.c2cFolder.name);
    const sourceEntries = await api.listTeamFolderFiles(team.sourceFolder.id);
    this.assertions.expectTeamFolderInventoryMatches(
      team.c2cFolder.name,
      sourceEntries,
      snapshotEntries,
      team.fixture,
    );
  }

  private async readLatestBackup(teamName: string): Promise<TeamFolderBackupState> {
    await this.backupsTab.click();
    const selectedTeam = this.backupsPanel.getByRole('button', { name: teamName, exact: true });
    if (!(await selectedTeam.isVisible())) {
      await this.backupsPanel.getByRole('button', { name: 'Select User', exact: true }).click();
      await this.page.getByRole('option', { name: teamName, exact: true }).click();
    }
    await this.backupsPanel.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(this.backupsPanel.getByText('Loading...', { exact: true })).toBeHidden({ timeout: 30_000 });
    const table = this.backupsPanel.getByRole('table').first();
    const rows = table.getByRole('row');
    const range = this.backupsPanel.getByText(/\d+\s*[–-]\s*\d+\s+of\s+\d+/);
    const total = Number((await range.innerText()).match(/of\s+(\d+)/)?.[1]);
    if (!Number.isSafeInteger(total)) {
      throw new Error('Could not read the Team Folder backup history row count.');
    }
    for (let index = 1; index < await rows.count(); index++) {
      const cells = await rows.nth(index).getByRole('cell').allInnerTexts();
      if (cells[1]?.trim() === teamName) {
        return { timestamp: cells[0]?.trim() ?? '', status: cells[2]?.trim() ?? '', totalCount: total };
      }
    }
    return { timestamp: '', status: '', totalCount: total };
  }

  private async visitFolder(parentPath: string[], entries: WorkDriveEntry[]): Promise<void> {
    const table = this.teamFoldersPanel.getByRole('table').last();
    const range = this.teamFoldersPanel.getByText(/\d+\s*[–-]\s*\d+\s+of\s+\d+/).last();
    const childFolders = new Map<string, string[]>();
    for (;;) {
      await expect(table).toBeVisible();
      await expect(range).toBeVisible();
      await expect(this.teamFoldersPanel.getByText('Loading...', { exact: true })).toBeHidden({ timeout: 30_000 });
      const rows = table.getByRole('row');
      for (let index = 1; index < await rows.count(); index++) {
        const cells = await rows.nth(index).getByRole('cell').allInnerTexts();
        if (cells.length === 0) {
          log(`[C2C Team Folders] Ignoring a non-data placeholder row under "${parentPath.join('\\') || 'Root'}".`);
          continue;
        }
        if (cells.some((cell) => /no folders found/i.test(cell.trim()))) {
          continue;
        }
        const name = cells[1]?.trim() ?? '';
        const type = cells[3]?.trim() === 'Folder' ? 'Folder' : 'File';
        if (!name) {
          throw new Error(`Could not classify a Team Folder snapshot row (${cells.join(' | ')}).`);
        }
        const path = [...parentPath, name];
        entries.push({ id: path.join('\\'), name, type, path: path.join('\\') });
        if (type === 'Folder') {
          childFolders.set(name, path);
        }
      }

      const next = this.teamFoldersPanel.getByRole('button', { name: 'Next page', exact: true });
      if (await next.isDisabled()) {
        break;
      }
      const currentRange = await range.innerText();
      await next.click();
      await expect(range).not.toHaveText(currentRange);
    }

    for (const [name, path] of childFolders) {
      await this.returnToFirstPage(range);
      const folderRow = await this.findFolderRow(table, name, range);
      if (!folderRow) {
        throw new Error(`Could not reopen C2C Team Folder path "${path.join('\\')}".`);
      }
      await folderRow.getByRole('cell').nth(1).click();
      await expect(this.teamFoldersPanel.getByRole('navigation').last().getByText(name, { exact: true })).toBeVisible();
      await expect(this.teamFoldersPanel.getByText('Loading...', { exact: true })).toBeHidden({ timeout: 30_000 });
      await this.visitFolder(path, entries);
      const parent = parentPath.at(-1) ?? 'Root';
      await this.teamFoldersPanel.getByRole('navigation').last().getByRole('button', { name: parent, exact: true }).click();
      await expect(this.teamFoldersPanel.getByText('Loading...', { exact: true })).toBeHidden({ timeout: 30_000 });
    }
  }

  private async returnToFirstPage(range: Locator): Promise<void> {
    const previous = this.teamFoldersPanel.getByRole('button', { name: 'Previous page', exact: true });
    while (!(await previous.isDisabled())) {
      const current = await range.innerText();
      await previous.click();
      await expect(range).not.toHaveText(current);
      await expect(this.teamFoldersPanel.getByText('Loading...', { exact: true })).toBeHidden({ timeout: 30_000 });
    }
  }

  private async findFolderRow(table: Locator, name: string, range: Locator): Promise<Locator | undefined> {
    for (;;) {
      await expect(range).toBeVisible();
      await expect(this.teamFoldersPanel.getByText('Loading...', { exact: true })).toBeHidden({ timeout: 30_000 });
      const rows = table.getByRole('row');
      for (let index = 1; index < await rows.count(); index++) {
        const row = rows.nth(index);
        const cells = await row.getByRole('cell').allInnerTexts();
        if (cells[1]?.trim() === name && cells[3]?.trim() === 'Folder') {
          return row;
        }
      }
      const next = this.teamFoldersPanel.getByRole('button', { name: 'Next page', exact: true });
      if (await next.isDisabled()) {
        return undefined;
      }
      const current = await range.innerText();
      await next.click();
      await expect(range).not.toHaveText(current);
    }
  }

  private columnIndex(headers: string[], name: string): number {
    const index = headers.findIndex((header) => header.toLowerCase() === name.toLowerCase());
    if (index < 0 || headers.lastIndexOf(headers[index]) !== index) {
      throw new Error(`Expected exactly one "${name}" column in the C2C Team Folder table.`);
    }
    return index;
  }
}