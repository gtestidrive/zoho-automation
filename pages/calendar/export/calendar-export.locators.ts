import type { Locator, Page } from '@playwright/test';
import { CalendarBackupLocators } from '../backup/calendar-backup.locators';
import { calendarExportLabels as labels, calendarExportPatterns as patterns } from './calendar-export.labels';

export class CalendarExportLocators {
  readonly snapshot: CalendarBackupLocators;
  readonly table: Locator;
  readonly range: Locator;
  readonly loading: Locator;
  readonly next: Locator;
  readonly previous: Locator;
  readonly exportButton: Locator;
  readonly dialog: Locator;
  readonly selectedItems: Locator;
  readonly format: Locator;
  readonly confirm: Locator;
  readonly exportsTab: Locator;
  readonly exportsTable: Locator;

  constructor(page: Page) {
    this.snapshot = new CalendarBackupLocators(page);
    const panel = this.snapshot.usersPanel;
    this.table = panel.getByRole('table').last();
    this.range = panel.getByText(patterns.pagination).last();
    this.loading = panel.getByText(labels.loading, { exact: true });
    this.next = panel.getByRole('button', { name: labels.next, exact: true });
    this.previous = panel.getByRole('button', { name: labels.previous, exact: true });
    this.exportButton = panel.getByRole('button', { name: labels.export, exact: true });
    this.dialog = page.getByRole('dialog', { name: labels.export, exact: true });
    this.selectedItems = this.dialog.getByRole('radio', { name: patterns.selected });
    this.format = this.dialog.getByRole('combobox');
    this.confirm = this.dialog.getByRole('button', { name: labels.export, exact: true });
    this.exportsTab = page.getByRole('tab', { name: labels.exports, exact: true });
    this.exportsTable = page.getByRole('main').getByRole('table').last();
  }

  download(row: Locator): Locator {
    return row.getByRole('button', { name: patterns.download })
      .or(row.getByRole('link', { name: patterns.download })).first();
  }

  snapshotRows(): Locator {
    return this.table.getByRole('row');
  }

  rowCellsAt(rows: Locator, index: number): Locator {
    return rows.nth(index).getByRole('cell');
  }

  calendarNameCell(rowIndex: number, name: number): Locator {
    return this.table.getByRole('row').nth(rowIndex).getByRole('cell').nth(name);
  }

  calendarsBack(): Locator {
    return this.snapshot.usersPanel.getByRole('button', { name: /^(?:\u2190\s*)?calendars$/i });
  }

  rowAt(rows: Locator, index: number): Locator {
    return rows.nth(index);
  }

  rowCells(row: Locator): Locator {
    return row.getByRole('cell');
  }

  eventCheckbox(row: Locator): Locator {
    return row.getByRole('checkbox');
  }

  snapshotHeaders(): Locator {
    return this.table.getByRole('columnheader');
  }

  historyLoading(): Locator {
    return this.exportsTable.getByText(labels.loading, { exact: true });
  }

  historyHeaders(table: Locator): Locator {
    return table.getByRole('columnheader');
  }

  historyRows(table: Locator): Locator {
    return table.getByRole('row');
  }
}
