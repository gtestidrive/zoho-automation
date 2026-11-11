import type { Page } from '@playwright/test';
import { setupNativeContacts, signInToContactsC2C } from '../backup/contacts_backup_config';
import { ContactsExportPage } from './contacts-export.page';

export async function setupContactsExport(page: Page) {
  const { email, contactsApi } = setupNativeContacts(page);
  await signInToContactsC2C(page);
  return { email, exportPage: new ContactsExportPage(page, contactsApi) };
}
