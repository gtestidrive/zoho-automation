import type { Locator, Page } from '@playwright/test';
import { teamFolderBackupLabels } from './team-folder-backup.labels';

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
}
