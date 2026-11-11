import type { Locator, Page } from '@playwright/test';
import { ContactsBackupLocators } from '../backup/contacts-backup.locators';
import { contactsRestoreLabels as labels, contactsRestorePatterns as patterns } from './contacts-restore.labels';

export class ContactsRestoreLocators extends ContactsBackupLocators {
  readonly restoresTab: Locator;
  readonly restoresPanel: Locator;
  readonly restoresTable: Locator;
  readonly dialog: Locator;

  constructor(page: Page) {
    super(page);
    this.restoresTab = page.getByRole('tab', { name: labels.restoresTab, exact: true });
    this.restoresPanel = page.getByRole('tabpanel', { name: labels.restoresTab });
    this.restoresTable = this.restoresPanel.getByRole('table');
    this.dialog = page.getByRole('dialog', { name: labels.restoreDialog });
  }

  restoreButton(page: Page): Locator {
    return page.getByRole('button', { name: labels.restoreDialog, exact: true });
  }

  snapshotRadio(dialog: Locator): Locator {
    return dialog.getByRole('radio', { name: labels.snapshot, exact: true });
  }

  newFolderRadio(dialog: Locator): Locator {
    return dialog.getByRole('radio', { name: patterns.newFolder });
  }

  destination(dialog: Locator): Locator {
    return dialog.getByRole('combobox', { name: labels.restoreTo });
  }

  submitRestore(dialog: Locator): Locator {
    return dialog.getByRole('button', { name: labels.restoreDialog, exact: true });
  }

  confirmation(page: Page): Locator {
    return page.getByRole('dialog').filter({ hasText: patterns.confirmation });
  }

  confirmRestore(confirmation: Locator): Locator {
    return confirmation.getByRole('button', { name: patterns.confirm });
  }

  historyTable(): Locator {
    return this.restoresPanel.getByRole('table');
  }

  historyLoading(): Locator {
    return this.restoresPanel.getByText(labels.loading, { exact: true });
  }

  historyRange(): Locator {
    return this.restoresPanel.getByText(patterns.pagination);
  }

  rowAt(rows: Locator, index: number): Locator {
    return rows.nth(index);
  }
}
