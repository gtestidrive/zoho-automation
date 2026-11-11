import type { Locator, Page } from '@playwright/test';
import { contactsBackupLabels, contactsBackupPatterns } from './contacts-backup.labels';

export class ContactsBackupLocators {
  readonly usersTab: Locator;
  readonly backupsTab: Locator;
  readonly usersTable: Locator;
  readonly usersMain: Locator;
  readonly usersPanel: Locator;
  readonly snapshotDate: Locator;
  readonly backupNowButton: Locator;
  readonly notifications: Locator;
  readonly backupsPanel: Locator;
  readonly backupsTable: Locator;
  readonly activityLogsLink: Locator;
  readonly allEventLogsTab: Locator;
  readonly eventLogsTable: Locator;
  readonly jobDetailsDialog: Locator;

  constructor(protected readonly page: Page) {
    this.usersTab = page.getByRole('tab', { name: contactsBackupLabels.usersTab, exact: true });
    this.backupsTab = page.getByRole('tab', { name: contactsBackupLabels.backupsTab, exact: true });
    this.usersMain = page.getByRole('main');
    this.usersPanel = page.getByRole('tabpanel', { name: contactsBackupLabels.usersTab, exact: true });
    this.snapshotDate = this.usersPanel.locator(contactsBackupLabels.snapshotDateSelector);
    this.usersTable = this.usersMain.getByRole('table').first();
    this.backupNowButton = page.getByRole('button', { name: contactsBackupLabels.backupNow, exact: true });
    this.notifications = page.getByRole('region', { name: contactsBackupLabels.notifications });
    this.backupsPanel = page.getByRole('tabpanel', { name: contactsBackupLabels.backupsTab });
    this.backupsTable = this.backupsPanel.getByRole('table');
    this.activityLogsLink = page.getByRole('link', { name: contactsBackupLabels.activityLogs, exact: true });
    this.allEventLogsTab = page.getByRole('tab', { name: contactsBackupLabels.allEventLogs, exact: true });
    this.eventLogsTable = page.getByRole('table', { name: contactsBackupLabels.eventLogsTable, exact: true });
    this.jobDetailsDialog = page.getByRole('dialog').filter({
      has: page.getByText(contactsBackupLabels.jobDetails, { exact: true }),
    });
  }

  tableRows(table: Locator): Locator {
    return table.getByRole('row');
  }

  rowCells(row: Locator): Locator {
    return row.getByRole('cell');
  }

  firstUserRow(rows: Locator): Locator {
    return rows.nth(1);
  }

  rowAt(rows: Locator, index: number): Locator {
    return rows.nth(index);
  }

  failedBackupEvent(page: Page, email: string, eventTimestamp: string): Locator {
    return this.eventLogsTable.getByRole('row')
      .filter({ has: page.getByRole('cell', { name: email, exact: true }) })
      .filter({ has: page.getByRole('cell', { name: 'Contacts', exact: true }) })
      .filter({ has: page.getByRole('cell', { name: 'Backup', exact: true }) })
      .filter({ has: page.getByRole('cell', { name: /^Failed$/i }) })
      .filter({ hasText: new RegExp(eventTimestamp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
  }

  eventDetails(row: Locator): Locator {
    return row.getByRole('link', { name: contactsBackupLabels.details, exact: true });
  }

  snapshotLoading(): Locator {
    return this.usersPanel.getByText(contactsBackupLabels.loading, { exact: true });
  }

  lastBackupCard(page: Page): Locator {
    return this.usersPanel.locator('.rcv-stat-item')
      .filter({ has: page.getByText('Last Backup', { exact: true }) });
  }

  snapshotRange(): Locator {
    return this.usersPanel.getByText(contactsBackupPatterns.pagination);
  }

  snapshotTable(panel: Locator): Locator {
    return panel.getByRole('table');
  }

  columnHeaders(table: Locator): Locator {
    return table.getByRole('columnheader');
  }

  panelLoading(panel: Locator): Locator {
    return panel.getByText(contactsBackupLabels.loading, { exact: true });
  }

  rowCellsAt(rows: Locator, index: number): Locator {
    return rows.nth(index).getByRole('cell');
  }

  snapshotNext(panel: Locator): Locator {
    return panel.getByRole('button', { name: contactsBackupLabels.nextPage, exact: true });
  }

  panelRange(panel: Locator): Locator {
    return panel.getByText(contactsBackupPatterns.pagination);
  }

  historyUserSelector(panel: Locator): Locator {
    return panel.getByRole('button', { name: contactsBackupLabels.selectUser, exact: true });
  }

  historyUser(panel: Locator, name: string): Locator {
    return panel.getByRole('button', { name: name, exact: true });
  }

  userOption(page: Page, name: string): Locator {
    return page.getByRole('option', { name: name, exact: true });
  }

  historySearch(panel: Locator): Locator {
    return panel.getByRole('button', { name: contactsBackupLabels.search, exact: true });
  }
}
