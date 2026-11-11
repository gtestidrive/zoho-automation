import type { Locator, Page } from '@playwright/test';
import { MailBackupLocators } from '../backup/mail-backup.locators';
import { mailExportLabels as labels, mailExportPatterns as patterns } from './mail-export.labels';

export class MailExportLocators {
  readonly snapshot: MailBackupLocators;
  readonly table: Locator;
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

  constructor(private readonly page: Page) {
    this.snapshot = new MailBackupLocators(page);
    const panel = this.snapshot.usersPanel;
    this.table = panel.getByRole('table').last();
    this.range = panel.getByText(patterns.pagination).last();
    this.loading = panel.getByText(labels.loading, { exact: true });
    this.next = panel.getByRole('button', { name: labels.next, exact: true });
    this.previous = panel.getByRole('button', { name: labels.previous, exact: true });
    this.exportButton = panel.getByRole('button', { name: labels.export, exact: true });
    this.dialog = page.getByRole('dialog', { name: labels.export, exact: true });
    this.format = this.dialog.getByRole('combobox');
    this.selectedItems = this.dialog.getByRole('radio', { name: patterns.selected });
    this.confirm = this.dialog.getByRole('button', { name: labels.export, exact: true });
    this.exportsTab = this.snapshot.main.getByRole('tab', { name: labels.exports, exact: true });
    this.exportsTable = this.snapshot.main.getByRole('table').last();
  }

  folderRow(name: string): Locator {
    return this.table.getByRole('row').filter({ has: this.page.getByRole('cell', { name, exact: true }) });
  }

  download(row: Locator): Locator {
    return row.getByRole('button', { name: /download/i }).or(row.getByRole('link', { name: /download/i })).first();
  }

  firstSnapshotName(): Locator {
    return this.table.getByRole('row').nth(1).getByRole('cell').nth(1);
  }

  rowCells(row: Locator): Locator {
    return row.getByRole('cell');
  }

  folderNameCell(row: Locator): Locator {
    return row.getByRole('cell').nth(1);
  }

  inboxBreadcrumb(): Locator {
    return this.snapshot.usersPanel.getByRole('navigation').last()
      .getByText(labels.inbox, { exact: true });
  }

  snapshotRows(): Locator {
    return this.table.getByRole('row');
  }

  rowAt(rows: Locator, index: number): Locator {
    return rows.nth(index);
  }

  messageCheckbox(row: Locator): Locator {
    return row.getByRole('checkbox');
  }

  historyLoading(): Locator {
    return this.exportsTable.getByText(labels.loading, { exact: true });
  }

  historyHeaders(): Locator {
    return this.exportsTable.getByRole('columnheader');
  }

  historyRows(): Locator {
    return this.exportsTable.getByRole('row');
  }
}
