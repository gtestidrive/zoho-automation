import type { Page } from '@playwright/test';
import { testSettings } from '../../../test-settings';
import { ZohoWorkDriveApi } from '../../drive/api/zoho-workdrive.api';
import { RecoveryPage } from '../../recovery.page';
import { SignInPage } from '../../sign-in.page';
import { TeamFolderExportPage } from './team-folder-export.page';

export async function setupTeamFolderExport(page: Page) {
  await page.goto(testSettings.c2cZoho.url, { waitUntil: 'domcontentloaded' });
  await new SignInPage(page).signInIfRequired(testSettings.c2cZoho.email, testSettings.c2cZoho.password);
  await new RecoveryPage(page).openTab('Team folder');
  return {
    exportPage: new TeamFolderExportPage(page, new ZohoWorkDriveApi(testSettings.zohoWorkDrive)),
  };
}
