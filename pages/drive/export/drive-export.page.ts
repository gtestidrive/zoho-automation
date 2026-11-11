import type { Page } from '@playwright/test';
import { testSettings } from '../../../test-settings';
import { exportLog } from '../../export/export-log';
import { ZohoWorkDriveApi } from '../api/zoho-workdrive.api';
import { DriveBackupPage } from '../backup/backup.page';
import { DriveExportLocators } from './drive-export.locators';
import { WorkDriveExportPage } from './workdrive-export.page';

export type { DriveExportResult } from './workdrive-export.page';

export class DriveExportPage extends WorkDriveExportPage {
  constructor(page: Page) {
    const backupPage = new DriveBackupPage(page);
    const api = new ZohoWorkDriveApi(testSettings.zohoWorkDrive);
    super(page, new DriveExportLocators(page), {
      product: 'Zoho C2C Drive',
      typeColumn: 2,
      openRoot: async (email) => {
        await backupPage.openUsersTab();
        await backupPage.selectUser(email);
      },
      readCurrentFolder: (parentPath) => backupPage.getSnapshotEntries(parentPath),
      listSource: (selected) => {
        const names = selected.map(({ name }) => name);
        exportLog('Zoho C2C Drive', 'Zoho inventory',
          `Reading only ${names.length} selected root items and their descendants: ${names.join(', ')}. Unselected folders are not scanned.`);
        return api.listFilesAndFolders(names);
      },
      downloadSource: (id) => api.downloadFile(id),
    });
  }
}
