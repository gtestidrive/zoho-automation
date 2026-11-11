import type { Page } from '@playwright/test';
import { ContactsBackupPage } from './contacts-backup.page';
import { RecoveryPage } from '../../recovery.page';
import { SignInPage } from '../../sign-in.page';
import { ZohoContactsApi } from '../api/zoho-contacts.api';
import { testSettings } from '../../../test-settings';

export function setupNativeContacts(page: Page) {
  const email = testSettings.zohoNative.email.trim();
  if (!email) {
    throw new Error('Set ZOHO_NATIVE_EMAIL or ZOHO_NATIVE_USERNAME to the Zoho Contacts user email.');
  }

  return {
    email,
    contactsPage: new ContactsBackupPage(page),
    contactsApi: new ZohoContactsApi(testSettings.zohoContacts),
  };
}

export async function signInToContactsC2C(page: Page): Promise<void> {
  await page.goto(testSettings.c2cZoho.url, { waitUntil: 'domcontentloaded' });
  await new SignInPage(page).signInIfRequired(testSettings.c2cZoho.email, testSettings.c2cZoho.password);
  await new RecoveryPage(page).openTab('Contacts');
}
