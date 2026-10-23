import { test as base } from '@playwright/test';
import { RecoveryPage } from '../../recovery.page';
import { SignInPage } from '../../sign-in.page';
import { testSettings } from '../../../test-settings';
import { DriveBackupPage } from './backup.page';

type BackupFixtures = {
  driveBackupPage: DriveBackupPage;
};

export const test = base.extend<BackupFixtures>({
  driveBackupPage: async ({ page }, use) => {
    await page.goto(testSettings.c2cZoho.url, { waitUntil: 'domcontentloaded' });

    const signInPage = new SignInPage(page);
    await signInPage.signInIfRequired(testSettings.c2cZoho.email, testSettings.c2cZoho.password);

    const recoveryPage = new RecoveryPage(page);
    await recoveryPage.openTab('Drive');

    await use(new DriveBackupPage(page));
  },
});
