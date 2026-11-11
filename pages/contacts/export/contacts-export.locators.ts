import type { Locator, Page } from '@playwright/test';
import { ContactsBackupLocators } from '../backup/contacts-backup.locators';
import { contactsExportLabels as labels, contactsExportPatterns as patterns } from './contacts-export.labels';

export class ContactsExportLocators {
  readonly snapshot: ContactsBackupLocators;
  readonly snapshotTable: Locator;
  readonly range: Locator;
  readonly loading: Locator;
  readonly next: Locator;
  readonly previous: Locator;
  readonly exportButton: Locator;
  readonly dialog: Locator;
  readonly format: Locator;
  readonly selectedItems: Locator;
  readonly confirm: Locator;
  readonly exportsTab: Locator;
  readonly exportsTable: Locator;

  constructor(page: Page) {
    this.snapshot = new ContactsBackupLocators(page);
    const panel = this.snapshot.usersPanel;
    this.snapshotTable = panel.getByRole('table');
    this.range = panel.getByText(patterns.pagination);
    this.loading = panel.getByText(labels.loading, { exact: true });
    this.next = panel.getByRole('button', { name: labels.next, exact: true });
    this.previous = panel.getByRole('button', { name: labels.previous, exact: true });
    this.exportButton = panel.getByRole('button', { name: labels.export, exact: true });
    this.dialog = page.getByRole('dialog', { name: labels.export, exact: true });
    this.format = this.dialog.getByRole('combobox');
    this.selectedItems = this.dialog.getByRole('radio', { name: patterns.selected });
    this.confirm = this.dialog.getByRole('button', { name: labels.export, exact: true });
    this.exportsTab = page.getByRole('tab', { name: labels.exports, exact: true });
    this.exportsTable = page.getByRole('main').getByRole('table').last();
  }

  download(row: Locator): Locator {
    return row.getByRole('button', { name: patterns.download })
      .or(row.getByRole('link', { name: patterns.download })).first();
  }

  loadingExports(): Locator {
    return this.exportsTable.getByText(labels.loading, { exact: true });
  }


  snapshotHeaders(): Locator {
    return this.snapshotTable.getByRole('columnheader');
  }

  snapshotRows(): Locator {
    return this.snapshotTable.getByRole('row');
  }

  rowAt(rows: Locator, index: number): Locator {
    return rows.nth(index);
  }

  rowCells(row: Locator): Locator {
    return row.getByRole('cell');
  }

  contactCheckbox(row: Locator): Locator {
    return row.getByRole('checkbox');
  }

  historyHeaders(): Locator {
    return this.exportsTable.getByRole('columnheader');
  }

  historyRows(): Locator {
    return this.exportsTable.getByRole('row');
  }
}
