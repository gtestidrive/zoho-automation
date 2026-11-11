import type { DriveExportResult } from '../../drive/export/workdrive-export.page';

export type TeamFolderExportOutcome = {
  team: string;
  status: 'Passed' | 'Failed' | 'Skipped';
  detail: string;
  exportResult?: DriveExportResult;
};

export class TeamFolderExportAssertions {
  expectEveryExportVerified(outcomes: TeamFolderExportOutcome[]): void {
    console.table(outcomes.map(({ team, status, detail, exportResult }) => ({
      Team: team,
      Status: status,
      SelectedFolders: exportResult?.selectedEntries.length ?? 0,
      Archive: exportResult?.archivePath ?? '',
      Detail: detail,
    })));
    const failures = outcomes.filter(({ status }) => status === 'Failed');
    if (failures.length > 0) {
      throw new Error(`Team Folder exports failed: ${failures.map(({ team, detail }) => `${team}: ${detail}`).join('; ')}`);
    }
    if (!outcomes.some(({ status }) => status === 'Passed')) {
      throw new Error('No Team Folder exports were verified; every team had no selectable folders.');
    }
  }
}
