import type { Locator, Page } from '@playwright/test';
import { calendarBackupLabels } from './calendar-backup.labels';

export class CalendarBackupLocators {
  readonly main: Locator;
  readonly usersTab: Locator;
  readonly backupsTab: Locator;
  readonly usersPanel: Locator;
  readonly backupsPanel: Locator;
  readonly usersTable: Locator;
  readonly backupNowButton: Locator;
  readonly notifications: Locator;

  constructor(page: Page) {
    this.main = page.getByRole('main');
    this.usersTab = this.main.getByRole('tab', { name: calendarBackupLabels.usersTab, exact: true });
    this.backupsTab = this.main.getByRole('tab', { name: calendarBackupLabels.backupsTab, exact: true });
    this.usersPanel = this.main.getByRole('tabpanel', { name: calendarBackupLabels.usersPanel, exact: true });
    this.backupsPanel = this.main.getByRole('tabpanel', { name: calendarBackupLabels.backupsPanel, exact: true });
    this.usersTable = this.usersPanel.getByRole('table').first();
    this.backupNowButton = this.usersPanel.getByRole('button', { name: calendarBackupLabels.backupNow });
    this.notifications = page.getByRole('region', { name: calendarBackupLabels.notifications });
  }

  allUsers(): Locator {
    return this.usersPanel.getByRole('button', { name: calendarBackupLabels.allUsers });
  }

  userSearch(): Locator {
    return this.usersPanel.getByRole('searchbox', { name: calendarBackupLabels.searchUsers });
  }

  snapshotLoading(): Locator {
    return this.usersPanel.getByText(calendarBackupLabels.loading, { exact: true });
  }

  firstUserRow(): Locator {
    return this.usersTable.getByRole('row').nth(1);
  }

  rowCells(row: Locator): Locator {
    return row.getByRole('cell');
  }

  userEmailCell(cells: Locator): Locator {
    return cells.nth(1);
  }

  userNameCell(cells: Locator): Locator {
    return cells.nth(0);
  }

  userName(row: Locator, name: string): Locator {
    return row.getByText(name, { exact: true });
  }

  snapshotTable(): Locator {
    return this.usersPanel.getByRole('table').last();
  }

  rowCell(row: Locator, index: number): Locator {
    return row.getByRole('cell').nth(index);
  }

  snapshotRange(): Locator {
    return this.usersPanel.getByText(/\d+\s*[\u2013-]\s*\d+\s+of\s+\d+/).last();
  }

  columnHeaders(table: Locator): Locator {
    return table.getByRole('columnheader');
  }

  tableRows(table: Locator): Locator {
    return table.getByRole('row');
  }

  rowCellsAt(rows: Locator, index: number): Locator {
    return rows.nth(index).getByRole('cell');
  }

  rowAt(rows: Locator, index: number): Locator {
    return rows.nth(index);
  }

  snapshotNext(): Locator {
    return this.usersPanel.getByRole('button', { name: 'Next page', exact: true });
  }

  snapshotPrevious(): Locator {
    return this.usersPanel.getByRole('button', { name: 'Previous page', exact: true });
  }

  calendarsBack(): Locator {
    return this.usersPanel.getByRole('button', { name: /^(?:\u2190\s*)?calendars$/i });
  }

  breadcrumbs(): Locator {
    return this.usersPanel.getByRole('navigation').last();
  }

  breadcrumbButton(breadcrumbs: Locator, folderName: string): Locator {
    return breadcrumbs.getByRole('button', { name: folderName, exact: true });
  }

  historyUser(name: string): Locator {
    return this.backupsPanel.getByRole('button', { name, exact: true });
  }

  historyUserSelector(): Locator {
    return this.backupsPanel.getByRole('button', { name: 'Select User', exact: true });
  }

  userOption(page: Page, name: string): Locator {
    return page.getByRole('option', { name, exact: true });
  }

  historySearch(): Locator {
    return this.backupsPanel.getByRole('button', { name: 'Search', exact: true });
  }

  historyLoading(): Locator {
    return this.backupsPanel.getByText(calendarBackupLabels.loading, { exact: true });
  }

  historyRows(): Locator {
    return this.backupsPanel.getByRole('table').first().getByRole('row');
  }

  historyRange(): Locator {
    return this.backupsPanel.getByText(/\d+\s*[\u2013-]\s*\d+\s+of\s+\d+/);
  }
}
