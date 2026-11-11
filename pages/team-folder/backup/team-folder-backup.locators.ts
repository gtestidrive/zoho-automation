import type { Locator, Page } from '@playwright/test';
import { teamFolderBackupLabels, teamFolderBackupPatterns } from './team-folder-backup.labels';

export class TeamFolderBackupLocators {
  readonly main: Locator;
  readonly teamFoldersTab: Locator;
  readonly backupsTab: Locator;
  readonly teamFoldersPanel: Locator;
  readonly backupsPanel: Locator;
  readonly notifications: Locator;

  constructor(page: Page) {
    this.main = page.getByRole('main', { name: teamFolderBackupLabels.main });
    this.teamFoldersTab = this.main.getByRole('tab', { name: teamFolderBackupLabels.teamFoldersTab, exact: true });
    this.backupsTab = this.main.getByRole('tab', { name: teamFolderBackupLabels.backupsTab, exact: true });
    this.teamFoldersPanel = this.main.getByRole('tabpanel', { name: teamFolderBackupLabels.teamFoldersPanel, exact: true });
    this.backupsPanel = this.main.getByRole('tabpanel', { name: teamFolderBackupLabels.backupsPanel, exact: true });
    this.notifications = page.getByRole('region', { name: teamFolderBackupLabels.notifications });
  }

  allTeams(): Locator {
    return this.teamFoldersPanel.getByRole('button', { name: /All Team Folders/ });
  }

  teamSearch(): Locator {
    return this.teamFoldersPanel.getByRole('searchbox', { name: teamFolderBackupLabels.searchTeamFolders });
  }

  teamLoading(): Locator {
    return this.teamFoldersPanel.getByText(teamFolderBackupLabels.loading, { exact: true });
  }

  teamsTable(): Locator {
    return this.teamFoldersPanel.getByRole('table').first();
  }

  columnHeaders(table: Locator): Locator {
    return table.getByRole('columnheader');
  }

  teamsRange(): Locator {
    return this.teamFoldersPanel.getByText(teamFolderBackupPatterns.pagination).last();
  }

  tableRows(table: Locator): Locator {
    return table.getByRole('row');
  }

  rowCellsAt(rows: Locator, index: number): Locator {
    return rows.nth(index).getByRole('cell');
  }

  nextTeamPage(): Locator {
    return this.teamFoldersPanel.getByRole('button', { name: teamFolderBackupLabels.nextPage, exact: true });
  }

  firstTeamRow(): Locator {
    return this.teamFoldersPanel.getByRole('table').first().getByRole('row').nth(1);
  }

  rowCells(row: Locator): Locator {
    return row.getByRole('cell');
  }

  teamNameCell(cells: Locator): Locator {
    return cells.nth(0);
  }

  teamOwnerCell(cells: Locator): Locator {
    return cells.nth(1);
  }

  teamLastBackupCell(cells: Locator): Locator {
    return cells.nth(3);
  }

  teamStorageCell(cells: Locator): Locator {
    return cells.nth(4);
  }

  teamName(row: Locator, name: string): Locator {
    return row.getByText(name, { exact: true });
  }

  snapshotSearch(): Locator {
    return this.teamFoldersPanel.getByRole('searchbox', { name: teamFolderBackupLabels.searchFoldersAndFiles });
  }

  teamStatusCard(): Locator {
    return this.main.locator('.rcv-stat-item__body').filter({ hasText: /^Status/ }).first();
  }

  backupNow(): Locator {
    return this.teamFoldersPanel.getByRole('button', { name: /Backup now/i });
  }

  historyTeam(teamName: string): Locator {
    return this.backupsPanel.getByRole('button', { name: teamName, exact: true });
  }

  historyTeamSelector(): Locator {
    return this.backupsPanel.getByRole('button', { name: 'Select User', exact: true });
  }

  teamOption(page: Page, teamName: string): Locator {
    return page.getByRole('option', { name: teamName, exact: true });
  }

  historySearch(): Locator {
    return this.backupsPanel.getByRole('button', { name: 'Search', exact: true });
  }

  historyLoading(): Locator {
    return this.backupsPanel.getByText('Loading...', { exact: true });
  }

  historyTable(): Locator {
    return this.backupsPanel.getByRole('table').first();
  }

  historyRange(): Locator {
    return this.backupsPanel.getByText(/\d+\s*[–-]\s*\d+\s+of\s+\d+/);
  }

  snapshotTable(): Locator {
    return this.teamFoldersPanel.getByRole('table').last();
  }

  snapshotRange(): Locator {
    return this.teamFoldersPanel.getByText(/\d+\s*[–-]\s*\d+\s+of\s+\d+/).last();
  }

  snapshotLoading(): Locator {
    return this.teamFoldersPanel.getByText('Loading...', { exact: true });
  }

  snapshotNext(): Locator {
    return this.teamFoldersPanel.getByRole('button', { name: 'Next page', exact: true });
  }

  folderNameCell(folderRow: Locator): Locator {
    return folderRow.getByRole('cell').nth(1);
  }

  snapshotBreadcrumb(name: string): Locator {
    return this.teamFoldersPanel.getByRole('navigation').last().getByText(name, { exact: true });
  }

  snapshotParentBreadcrumb(parent: string): Locator {
    return this.teamFoldersPanel.getByRole('navigation').last().getByRole('button', { name: parent, exact: true });
  }

  snapshotPrevious(): Locator {
    return this.teamFoldersPanel.getByRole('button', { name: 'Previous page', exact: true });
  }

  rowAt(rows: Locator, index: number): Locator {
    return rows.nth(index);
  }
}
