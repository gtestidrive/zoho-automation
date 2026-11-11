import type { Locator, Page } from '@playwright/test';
import { mailBackupLabels } from './mail-backup.labels';

export class MailBackupLocators {
  readonly main: Locator;
  readonly usersTab: Locator;
  readonly backupsTab: Locator;
  readonly usersPanel: Locator;
  readonly backupsPanel: Locator;
  readonly usersTable: Locator;
  readonly backupNowButton: Locator;
  readonly notifications: Locator;
  readonly exportButton: Locator;
  readonly exportDialog: Locator;
  readonly selectedItemsRadio: Locator;
  readonly confirmExportButton: Locator;
  readonly exportsTab: Locator;
  readonly exportsTable: Locator;
  readonly exportsLoading: Locator;

  constructor(page: Page) {
    this.main = page.getByRole('main', { name: mailBackupLabels.main });
    this.usersTab = this.main.getByRole('tab', { name: mailBackupLabels.usersTab, exact: true });
    this.backupsTab = this.main.getByRole('tab', { name: mailBackupLabels.backupsTab, exact: true });
    this.usersPanel = this.main.getByRole('tabpanel', { name: mailBackupLabels.usersPanel, exact: true });
    this.backupsPanel = this.main.getByRole('tabpanel', { name: mailBackupLabels.backupsPanel, exact: true });
    this.usersTable = this.usersPanel.getByRole('table').first();
    this.backupNowButton = this.usersPanel.getByRole('button', { name: mailBackupLabels.backupNow, exact: true });
    this.notifications = page.getByRole('region', { name: mailBackupLabels.notifications });
    this.exportButton = this.main.getByRole('button', { name: mailBackupLabels.export });
    this.exportDialog = page.getByRole('dialog', { name: mailBackupLabels.export });
    this.selectedItemsRadio = this.exportDialog.getByRole('radio', { name: mailBackupLabels.selectedItems });
    this.confirmExportButton = this.exportDialog.getByRole('button', { name: mailBackupLabels.export });
    this.exportsTab = this.main.getByRole('tab', { name: mailBackupLabels.exportsTab });
    this.exportsTable = this.main.getByRole('table').last();
    this.exportsLoading = this.exportsTable.getByText(mailBackupLabels.loading, { exact: true });
  }
}
