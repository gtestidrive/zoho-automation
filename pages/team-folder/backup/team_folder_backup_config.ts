import type { Page } from '@playwright/test';
import { TeamFolderBackupPage } from './team-folder-backup.page';
import { RecoveryPage } from '../../recovery.page';
import { SignInPage } from '../../sign-in.page';
import { ZohoWorkDriveApi } from '../../drive/api/zoho-workdrive.api';
import { testSettings } from '../../../test-settings';

export async function setupTeamFolders(page: Page) {
  await page.goto(testSettings.c2cZoho.url, { waitUntil: 'domcontentloaded' });
  await new SignInPage(page).signInIfRequired(testSettings.c2cZoho.email, testSettings.c2cZoho.password);
  await new RecoveryPage(page).openTab('Team folder');
  return {
    teamFolderPage: new TeamFolderBackupPage(page),
    workDriveApi: new ZohoWorkDriveApi(testSettings.zohoWorkDrive),
  };
}
