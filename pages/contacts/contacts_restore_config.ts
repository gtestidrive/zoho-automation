import type { Page } from '@playwright/test';
import { ContactsRestorePage } from './restore/contacts-restore.page';
import { setupNativeContacts, signInToContactsC2C } from './backup/contacts_backup_config';

export async function setupContacts(page: Page) {
  const setup = setupNativeContacts(page);
  await signInToContactsC2C(page);
  return {
    ...setup,
    contactsPage: new ContactsRestorePage(page),
  };
}
