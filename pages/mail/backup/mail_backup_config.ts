import type { Page } from '@playwright/test';
import { MailBackupPage } from './mail-backup.page';
import { RecoveryPage } from '../../recovery.page';
import { SignInPage } from '../../sign-in.page';
import { ZohoMailApi } from '../api/zoho-mail.api';
import { testSettings } from '../../../test-settings';

function nativeMailEmail(): string {
  const email = testSettings.zohoNative.email.trim();
  if (!email) {
    throw new Error('Set ZOHO_NATIVE_EMAIL or ZOHO_NATIVE_USERNAME to the Zoho Mail user email.');
  }
  return email;
}

export function setupNativeMail() {
  return {
    email: nativeMailEmail(),
    recipientEmail: testSettings.zohoMail.testRecipientEmail,
    mailApi: new ZohoMailApi(testSettings.zohoMail),
  };
}

export async function signInToMailC2C(page: Page) {
  const email = nativeMailEmail();
  await page.goto(testSettings.c2cZoho.url, { waitUntil: 'domcontentloaded' });
  await new SignInPage(page).signInIfRequired(testSettings.c2cZoho.email, testSettings.c2cZoho.password);
  return {
    email,
    mailPage: new MailBackupPage(page),
    mailApi: new ZohoMailApi(testSettings.zohoMail),
  };
}

export async function openMailRecovery(page: Page): Promise<void> {
  await new RecoveryPage(page).openTab('Mail');
}
