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
import { teamFolderBackupPatterns } from './team-folder-backup.labels';
import { TeamFolderBackupLocators } from './team-folder-backup.locators';

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

  private readonly teamFoldersTab: Locator;
  private readonly backupsTab: Locator;
  private readonly notifications: Locator;

  constructor(private readonly page: Page) {
    this.locators = new TeamFolderBackupLocators(page);
    this.teamFoldersTab = this.locators.teamFoldersTab;
    this.backupsTab = this.locators.backupsTab;
    this.notifications = this.locators.notifications;
  }

  async listTeamFolders(): Promise<C2CTeamFolder[]> {
    await this.teamFoldersTab.click();
    const allTeams = this.locators.allTeams();
    if (await allTeams.isVisible()) {
      await allTeams.click();
    }
    const search = this.locators.teamSearch();
    await search.fill('');
    await expect(this.locators.teamLoading()).toBeHidden({ timeout: 30_000 });

    const table = this.locators.teamsTable();
    const headers = (await this.locators.columnHeaders(table).allInnerTexts()).map((value) => value.trim().toLowerCase());
    const nameColumn = this.columnIndex(headers, 'folder name');
    const ownerColumn = this.columnIndex(headers, 'owner');
    const lastBackupColumn = this.columnIndex(headers, 'last backup');
    const storageColumn = this.columnIndex(headers, 'storage used');
    const range = this.locators.teamsRange();
    const teams: C2CTeamFolder[] = [];

    for (; ;) {
      await expect(range).toBeVisible();
      await expect(this.locators.teamLoading()).toBeHidden({ timeout: 30_000 });
      const rows = this.locators.tableRows(table);
      for (let index = 1; index < await rows.count(); index++) {
        const cells = await this.locators.rowCellsAt(rows, index).allInnerTexts();
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
      const next = this.locators.nextTeamPage();
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
    const allTeams = this.locators.allTeams();
    if (await allTeams.isVisible()) {
      await allTeams.click();
    }
    const search = this.locators.teamSearch();
    await search.fill(name);
    await expect(this.locators.teamLoading()).toBeHidden({ timeout: 30_000 });

    const row = this.locators.firstTeamRow();
    const cells = this.locators.rowCells(row);
    await expect(this.locators.teamNameCell(cells)).toHaveText(name, { timeout: 30_000 });
    const [owner, lastBackup, storage] = await Promise.all([
      this.locators.teamOwnerCell(cells).innerText(), this.locators.teamLastBackupCell(cells).innerText(), this.locators.teamStorageCell(cells).innerText(),
    ]);
    await this.locators.teamName(row, name).click();
    await expect(this.locators.allTeams()).toBeVisible({ timeout: 30_000 });
    await expect(this.locators.snapshotSearch()).toBeVisible({ timeout: 30_000 });
    await expect(this.locators.teamLoading()).toBeHidden({ timeout: 30_000 });
    const statusCard = this.locators.teamStatusCard();
    const status = (await statusCard.innerText()).replace(/^Status\s*/, '').trim();
    return { name, owner: owner.trim(), lastBackup: lastBackup.trim(), storage: storage.trim(), status };
  }

  async startBackupAndWait(team: C2CTeamFolder): Promise<TeamFolderBackupState> {
    const previous = await this.readLatestBackup(team.name);
    await this.openTeamFolder(team.name);
    const backupNow = this.locators.backupNow();
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

  async readCurrentFolder(parentPath: string[]): Promise<WorkDriveEntry[]> {
    const entries: WorkDriveEntry[] = [];
    await this.visitFolder(parentPath, entries);
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
    const selectedTeam = this.locators.historyTeam(teamName);
    if (!(await selectedTeam.isVisible())) {
      await this.locators.historyTeamSelector().click();
      await this.locators.teamOption(this.page, teamName).click();
    }
    await this.locators.historySearch().click();
    await expect(this.locators.historyLoading()).toBeHidden({ timeout: 30_000 });
    const table = this.locators.historyTable();
    const rows = this.locators.tableRows(table);
    const range = this.locators.historyRange();
    const total = Number((await range.innerText()).match(/of\s+(\d+)/)?.[1]);
    if (!Number.isSafeInteger(total)) {
      throw new Error('Could not read the Team Folder backup history row count.');
    }
    for (let index = 1; index < await rows.count(); index++) {
      const cells = await this.locators.rowCellsAt(rows, index).allInnerTexts();
      if (cells[1]?.trim() === teamName) {
        return { timestamp: cells[0]?.trim() ?? '', status: cells[2]?.trim() ?? '', totalCount: total };
      }
    }
    return { timestamp: '', status: '', totalCount: total };
  }

  private async visitFolder(parentPath: string[], entries: WorkDriveEntry[]): Promise<void> {
    const table = this.locators.snapshotTable();
    const range = this.locators.snapshotRange();
    const childFolders = new Map<string, string[]>();
    for (; ;) {
      await expect(table).toBeVisible();
      await expect(range).toBeVisible();
      await expect(this.locators.snapshotLoading()).toBeHidden({ timeout: 30_000 });
      const rows = this.locators.tableRows(table);
      for (let index = 1; index < await rows.count(); index++) {
        const cells = await this.locators.rowCellsAt(rows, index).allTextContents();
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

      const next = this.locators.snapshotNext();
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
      await this.locators.folderNameCell(folderRow).click();
      await expect(this.locators.snapshotBreadcrumb(name)).toBeVisible();
      await expect(this.locators.snapshotLoading()).toBeHidden({ timeout: 30_000 });
      await this.visitFolder(path, entries);
      const parent = parentPath.at(-1) ?? 'Root';
      await this.locators.snapshotParentBreadcrumb(parent).click();
      await expect(this.locators.snapshotLoading()).toBeHidden({ timeout: 30_000 });
    }
  }

  private async returnToFirstPage(range: Locator): Promise<void> {
    const previous = this.locators.snapshotPrevious();
    while (!(await previous.isDisabled())) {
      const current = await range.innerText();
      await previous.click();
      await expect(range).not.toHaveText(current);
      await expect(this.locators.snapshotLoading()).toBeHidden({ timeout: 30_000 });
    }
  }

  private async findFolderRow(table: Locator, name: string, range: Locator): Promise<Locator | undefined> {
    for (; ;) {
      await expect(range).toBeVisible();
      await expect(this.locators.snapshotLoading()).toBeHidden({ timeout: 30_000 });
      const rows = this.locators.tableRows(table);
      for (let index = 1; index < await rows.count(); index++) {
        const row = this.locators.rowAt(rows, index);
        const cells = await this.locators.rowCells(row).allTextContents();
        if (cells[1]?.trim() === name && cells[3]?.trim() === 'Folder') {
          return row;
        }
      }
      const next = this.locators.snapshotNext();
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