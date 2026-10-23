import type { Locator, Page } from '@playwright/test';
import { backupLabels, backupPatterns } from './backup.labels';

export class DriveBackupLocators {
  readonly main: Locator;
  readonly usersTable: Locator;
  readonly usersTab: Locator;
  readonly backupsTab: Locator;
  readonly backupNowButton: Locator;
  readonly notifications: Locator;
  readonly historyPanel: Locator;
  readonly historyTable: Locator;
  readonly historyRange: Locator;
  readonly historySearchButton: Locator;
  readonly snapshotPanel: Locator;
  readonly snapshotTable: Locator;
  readonly snapshotRange: Locator;
  readonly snapshotLoading: Locator;
  readonly snapshotNavigation: Locator;
  readonly snapshotNextPageButton: Locator;
  readonly snapshotPreviousPageButton: Locator;
  readonly storageValue: Locator;

  constructor(private readonly page: Page) {
    this.main = page.getByRole('main', { name: backupLabels.main });
    this.usersTable = this.main.getByRole('table', { name: backupLabels.usersTable });
    this.usersTab = page.getByRole('tab', { name: backupLabels.usersTab });
    this.backupsTab = page.getByRole('tab', { name: backupLabels.backupsTab });
    this.backupNowButton = this.main.getByRole('button', { name: backupLabels.backupNowButton });
    this.notifications = page.getByRole('region', { name: backupLabels.notificationsRegion });
    this.historyPanel = page.getByRole('tabpanel', { name: backupLabels.backupsTab });
    this.historyTable = this.historyPanel.getByRole('table');
    this.historyRange = this.historyPanel.getByText(backupPatterns.pagination);
    this.historySearchButton = this.historyPanel.getByRole('button', { name: backupLabels.searchButton, exact: true });
    this.snapshotPanel = this.main.getByRole('tabpanel', { name: backupLabels.usersTab });
    this.snapshotTable = this.snapshotPanel.getByRole('table');
    this.snapshotRange = this.snapshotPanel.getByText(backupPatterns.pagination);
    this.snapshotLoading = this.snapshotTable.getByText(backupLabels.loading, { exact: true });
    this.snapshotNavigation = this.snapshotPanel.getByRole('navigation');
    this.snapshotNextPageButton = this.snapshotPanel.getByRole('button', { name: backupLabels.nextPageButton });
    this.snapshotPreviousPageButton = this.snapshotPanel.getByRole('button', { name: backupLabels.previousPageButton });
    this.storageValue = this.main
      .getByText(backupLabels.storage, { exact: true })
      .locator('xpath=following-sibling::p[1]');
  }

  userRows(): Locator {
    return this.usersTable.getByRole('row');
  }

  tableRows(table: Locator): Locator {
    return table.getByRole('row');
  }

  rowCells(row: Locator): Locator {
    return row.getByRole('cell');
  }

  rowAt(table: Locator, index: number): Locator {
    return this.tableRows(table).nth(index);
  }

  cellAt(row: Locator, index: number): Locator {
    return this.rowCells(row).nth(index);
  }

  historyRows(): Locator {
    return this.historyTable.getByRole('row');
  }

  userSelector(panel: Locator, name: string): Locator {
    return panel.getByRole('button', { name, exact: true });
  }

  selectUserButton(panel: Locator): Locator {
    return panel.getByRole('button', { name: backupLabels.selectUserButton });
  }

  userOption(name: string): Locator {
    return this.page.getByRole('option', { name, exact: true });
  }

  pageLoading(panel: Locator): Locator {
    return panel.getByText(backupLabels.loading, { exact: true });
  }

  pageRange(panel: Locator): Locator {
    return panel.getByText(backupPatterns.pagination);
  }

  pageButton(panel: Locator, direction: 'next' | 'previous'): Locator {
    const name = direction === 'next' ? backupLabels.nextPageButton : backupLabels.previousPageButton;
    return panel.getByRole('button', { name });
  }

  snapshotFolderCell(name: string): Locator {
    return this.snapshotTable.getByRole('cell', { name, exact: true });
  }

  snapshotBreadcrumb(name: string): Locator {
    return this.snapshotNavigation.last().getByText(name, { exact: true });
  }

  snapshotBreadcrumbButton(name: string): Locator {
    return this.snapshotNavigation.last().getByRole('button', { name, exact: true });
  }

}
