import type { Page } from '@playwright/test';
import { setupNativeContacts, signInToContactsC2C } from '../backup/contacts_backup_config';
import { ContactsRestorePage } from './contacts-restore.page';

export async function setupContacts(page: Page) {
  const setup = setupNativeContacts(page);
  await signInToContactsC2C(page);
  return {
    ...setup,
    contactsPage: new ContactsRestorePage(page),
  };
}
