import type { Locator, Page } from '@playwright/test';
import { DriveBackupLocators } from '../backup/backup.locators';
import { exportLabels, exportPatterns } from './drive-export.labels';

export type ExportSnapshotLocators = Pick<DriveBackupLocators,
  'snapshotLoading' | 'snapshotRange' | 'snapshotTable' | 'snapshotNextPageButton'
  | 'snapshotPreviousPageButton' | 'snapshotBreadcrumb' | 'cellAt' | 'tableRows' | 'rowCells'>;

export class DriveExportLocators {
  readonly snapshot: ExportSnapshotLocators;
  readonly main: Locator;
  readonly snapshotExportButton: Locator;
  readonly exportDialog: Locator;
  readonly selectedItemsRadio: Locator;
  readonly confirmExportButton: Locator;
  readonly exportsTab: Locator;
  readonly exportsTable: Locator;
  readonly exportsLoading: Locator;

  constructor(page: Page, mainName: string = exportLabels.main, snapshot?: ExportSnapshotLocators) {
    this.snapshot = snapshot ?? new DriveBackupLocators(page);
    this.main = page.getByRole('main', { name: mainName });
    this.snapshotExportButton = this.main.getByRole('button', { name: exportPatterns.exportButton });
    this.exportDialog = page.getByRole('dialog', { name: exportPatterns.exportDialog });
    this.selectedItemsRadio = this.exportDialog.getByRole('radio', { name: exportPatterns.selectedItemsRadio });
    this.confirmExportButton = this.exportDialog.getByRole('button', { name: exportPatterns.exportButton });
    this.exportsTab = this.main.getByRole('tab', { name: exportPatterns.exportsTab });
    this.exportsTable = this.main.getByRole('table').last();
    this.exportsLoading = this.exportsTable.getByText(exportLabels.loading, { exact: true });
  }

  exportRows(): Locator {
    return this.exportsTable.getByRole('row');
  }

  downloadAction(row: Locator): Locator {
    const button = row.getByRole('button', { name: exportPatterns.download });
    return button.or(row.getByRole('link', { name: exportPatterns.download })).first();
  }


  currentFolderBreadcrumb(name: string): Locator {
    return this.snapshot.snapshotBreadcrumb(name).last();
  }

  rowAt(rows: Locator, index: number): Locator {
    return rows.nth(index);
  }

  entryCheckbox(row: Locator): Locator {
    return row.getByRole('checkbox');
  }
}
