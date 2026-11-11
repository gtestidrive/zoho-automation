import type { Page } from '@playwright/test';
import { testSettings } from '../../../test-settings';
import { RecoveryPage } from '../../recovery.page';
import { SignInPage } from '../../sign-in.page';
import { DriveExportPage } from './drive-export.page';

export type DriveExportSetup = {
  email: string;
  exportPage: DriveExportPage;
};

export async function setupDriveExport(page: Page): Promise<DriveExportSetup> {
  const email = testSettings.zohoNative.email.trim();
  if (!email) {
    throw new Error('Set ZOHO_NATIVE_EMAIL or ZOHO_NATIVE_USERNAME to the Zoho Drive user email.');
  }

  await page.goto(testSettings.c2cZoho.url, { waitUntil: 'domcontentloaded' });
  await new SignInPage(page).signInIfRequired(testSettings.c2cZoho.email, testSettings.c2cZoho.password);
  await new RecoveryPage(page).openTab('Drive');
  return { email, exportPage: new DriveExportPage(page) };
}
