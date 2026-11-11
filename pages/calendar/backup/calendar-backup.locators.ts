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
}
