import type { Page } from '@playwright/test';
import { DriveExportLocators } from '../../drive/export/drive-export.locators';
import { TeamFolderBackupLocators } from '../backup/team-folder-backup.locators';
import { teamFolderExportLabels, teamFolderExportPatterns } from './team-folder-export.labels';

export class TeamFolderExportLocators extends DriveExportLocators {
  constructor(page: Page) {
    const { teamFoldersPanel: panel } = new TeamFolderBackupLocators(page);
    super(page, teamFolderExportLabels.main, {
      snapshotLoading: panel.getByText(teamFolderExportLabels.loading, { exact: true }),
      snapshotRange: panel.getByText(teamFolderExportPatterns.pagination).last(),
      snapshotTable: panel.getByRole('table').last(),
      snapshotNextPageButton: panel.getByRole('button', { name: teamFolderExportLabels.nextPage, exact: true }),
      snapshotPreviousPageButton: panel.getByRole('button', { name: teamFolderExportLabels.previousPage, exact: true }),
      snapshotBreadcrumb: (name) => panel.getByRole('navigation').last().getByText(name, { exact: true }),
      cellAt: (row, index) => row.getByRole('cell').nth(index),
      tableRows: (table) => table.getByRole('row'),
      rowCells: (row) => row.getByRole('cell'),
    });
  }
}
