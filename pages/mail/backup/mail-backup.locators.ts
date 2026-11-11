import type { Locator, Page } from '@playwright/test';
import { mailBackupLabels, mailBackupPatterns } from './mail-backup.labels';

export class MailBackupLocators {
  readonly main: Locator;
  readonly usersTab: Locator;
  readonly backupsTab: Locator;
  readonly usersPanel: Locator;
  readonly backupsPanel: Locator;
  readonly usersTable: Locator;
  readonly backupNowButton: Locator;
  readonly notifications: Locator;

  constructor(page: Page) {
    this.main = page.getByRole('main', { name: mailBackupLabels.main });
    this.usersTab = this.main.getByRole('tab', { name: mailBackupLabels.usersTab, exact: true });
    this.backupsTab = this.main.getByRole('tab', { name: mailBackupLabels.backupsTab, exact: true });
    this.usersPanel = this.main.getByRole('tabpanel', { name: mailBackupLabels.usersPanel, exact: true });
    this.backupsPanel = this.main.getByRole('tabpanel', { name: mailBackupLabels.backupsPanel, exact: true });
    this.usersTable = this.usersPanel.getByRole('table').first();
    this.backupNowButton = this.usersPanel.getByRole('button', { name: mailBackupLabels.backupNow, exact: true });
    this.notifications = page.getByRole('region', { name: mailBackupLabels.notifications });
  }

  allUsers(): Locator {
    return this.usersPanel.getByRole('button', { name: mailBackupPatterns.allUsers });
  }

  userSearch(): Locator {
    return this.usersPanel.getByRole('searchbox', { name: mailBackupLabels.searchUsers });
  }

  userLoading(): Locator {
    return this.usersPanel.getByText(mailBackupLabels.loading, { exact: true });
  }

  userRows(): Locator {
    return this.usersTable.getByRole('row');
  }

  firstUserRow(rows: Locator): Locator {
    return rows.nth(1);
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

  historyUserSelector(): Locator {
    return this.backupsPanel.getByRole('button', { name: 'Select User', exact: true });
  }

  historyUser(name: string): Locator {
    return this.backupsPanel.getByRole('button', { name: name, exact: true });
  }

  userOption(page: Page, name: string): Locator {
    return page.getByRole('option', { name: name, exact: true });
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

  tableRows(table: Locator): Locator {
    return table.getByRole('row');
  }

  historyRange(): Locator {
    return this.backupsPanel.getByText(/\d+\s*[–-]\s*\d+\s+of\s+\d+/);
  }

  rowCellsAt(rows: Locator, index: number): Locator {
    return rows.nth(index).getByRole('cell');
  }

  snapshotTable(): Locator {
    return this.usersPanel.getByRole('table').last();
  }

  snapshotRange(): Locator {
    return this.usersPanel.getByText(/\d+\s*[–-]\s*\d+\s+of\s+\d+/).last();
  }

  snapshotLoading(): Locator {
    return this.usersPanel.getByText('Loading...', { exact: true });
  }

  snapshotNext(): Locator {
    return this.usersPanel.getByRole('button', { name: 'Next page', exact: true });
  }

  folderNameCell(folderRow: Locator): Locator {
    return folderRow.getByRole('cell').nth(1);
  }

  snapshotBreadcrumbs(): Locator {
    return this.usersPanel.getByRole('navigation').last();
  }

  snapshotBreadcrumb(breadcrumbs: Locator, folderName: string): Locator {
    return breadcrumbs.getByText(folderName, { exact: true }).last();
  }

  snapshotParentBreadcrumb(parentName: string): Locator {
    return this.usersPanel.getByRole('navigation').last().getByRole('button', { name: parentName, exact: true });
  }

  snapshotPrevious(): Locator {
    return this.usersPanel.getByRole('button', { name: 'Previous page', exact: true });
  }

  rowAt(rows: Locator, index: number): Locator {
    return rows.nth(index);
  }
}
