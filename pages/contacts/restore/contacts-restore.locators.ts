import type { Locator, Page } from '@playwright/test';
import { ContactsBackupLocators } from '../backup/contacts-backup.locators';
import { contactsBackupLabels } from '../backup/contacts-backup.labels';

export class ContactsRestoreLocators extends ContactsBackupLocators {
  readonly restoresTab: Locator;
  readonly restoresPanel: Locator;
  readonly restoresTable: Locator;
  readonly dialog: Locator;

  constructor(page: Page) {
    super(page);
    this.restoresTab = page.getByRole('tab', { name: contactsBackupLabels.restoresTab, exact: true });
    this.restoresPanel = page.getByRole('tabpanel', { name: contactsBackupLabels.restoresTab });
    this.restoresTable = this.restoresPanel.getByRole('table');
    this.dialog = page.getByRole('dialog', { name: contactsBackupLabels.restoreDialog });
  }
}
