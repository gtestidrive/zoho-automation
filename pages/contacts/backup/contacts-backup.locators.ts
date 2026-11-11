import type { Locator, Page } from '@playwright/test';
import { contactsBackupLabels } from './contacts-backup.labels';

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
}
