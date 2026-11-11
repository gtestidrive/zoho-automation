import type { Page } from '@playwright/test';
import { DriveBackupPage } from './backup.page';
import { RecoveryPage } from '../../recovery.page';
import { SignInPage } from '../../sign-in.page';
import { testSettings } from '../../../test-settings';

export type DriveBackupSetup = {
  email: string;
  drivePage: DriveBackupPage;
};

export async function setupDriveBackup(page: Page): Promise<DriveBackupSetup> {
  const email = testSettings.zohoNative.email.trim();
  if (!email) {
    throw new Error('Set ZOHO_NATIVE_EMAIL or ZOHO_NATIVE_USERNAME to the Zoho Drive user email.');
  }

  await page.goto(testSettings.c2cZoho.url, { waitUntil: 'domcontentloaded' });
  await new SignInPage(page).signInIfRequired(testSettings.c2cZoho.email, testSettings.c2cZoho.password);
  await new RecoveryPage(page).openTab('Drive');
  const drivePage = new DriveBackupPage(page);
  return { email, drivePage };
}
