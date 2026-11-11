import type { Page } from '@playwright/test';
import { join } from 'node:path';
import { ZohoWorkDriveApi } from '../../drive/api/zoho-workdrive.api';
import { NoSelectableExportFoldersError } from '../../drive/export/drive-export.assertions';
import { WorkDriveExportPage } from '../../drive/export/workdrive-export.page';
import { TeamFolderBackupPage, type TeamFolderRun } from '../backup/team-folder-backup.page';
import { TeamFolderExportAssertions, type TeamFolderExportOutcome } from './team-folder-export.assertions';
import { teamFolderExportLabels } from './team-folder-export.labels';
import { TeamFolderExportLocators } from './team-folder-export.locators';

export class TeamFolderExportPage {
  private readonly teams: TeamFolderBackupPage;
  private readonly assertions = new TeamFolderExportAssertions();

  constructor(private readonly page: Page, private readonly api: ZohoWorkDriveApi) {
    this.teams = new TeamFolderBackupPage(page);
  }

  async listMatchingTeams(): Promise<TeamFolderRun[]> {
    return this.teams.listMatchingTeams(this.api);
  }

  async exportEveryTeamAndVerify(
    teams: TeamFolderRun[],
    downloadDirectory: string,
  ): Promise<TeamFolderExportOutcome[]> {
    const outcomes: TeamFolderExportOutcome[] = [];
    console.log(`[Team Folder export] Processing ${teams.length} teams; download directory="${downloadDirectory}".`);
    for (const team of teams) {
      const started = Date.now();
      console.log(`[${new Date().toISOString()}] [Team Folder export] Team ${outcomes.length + 1}/${teams.length}: `
        + `"${team.c2cFolder.name}", Zoho team folder ID=${team.sourceFolder.id}.`);
      try {
        const exportResult = await this.exportTeamAndVerify(team, downloadDirectory);
        outcomes.push({
          team: team.c2cFolder.name,
          status: 'Passed',
          detail: 'C2C names/paths/types and live Zoho file sizes/SHA-256 verified.',
          exportResult,
        });
        console.log(`[Team Folder export] PASS "${team.c2cFolder.name}": ${exportResult.selectedEntries.length} folders; `
          + `ZIP="${exportResult.archivePath}"; elapsed=${((Date.now() - started) / 1000).toFixed(1)}s.`);
      } catch (error) {
        if (error instanceof NoSelectableExportFoldersError) {
          console.warn(`[Team Folder export] Skipping "${team.c2cFolder.name}": ${error.message}`);
          outcomes.push({ team: team.c2cFolder.name, status: 'Skipped', detail: error.message });
        } else {
          console.error(`[Team Folder export] Failed "${team.c2cFolder.name}".`, error);
          outcomes.push({
            team: team.c2cFolder.name,
            status: 'Failed',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    this.assertions.expectEveryExportVerified(outcomes);
    return outcomes;
  }

  async exportTeamAndVerify(team: TeamFolderRun, downloadDirectory: string) {
    const exporter = new WorkDriveExportPage(this.page, new TeamFolderExportLocators(this.page), {
      product: teamFolderExportLabels.product,
      typeColumn: 3,
      openRoot: async (name) => { await this.teams.openTeamFolder(name); },
      readCurrentFolder: (parentPath) => this.teams.readCurrentFolder(parentPath),
      listSource: () => this.api.listTeamFolderFiles(team.sourceFolder.id),
      downloadSource: (id) => this.api.downloadFile(id),
    });
    const safeTeamId = encodeURIComponent(team.sourceFolder.id);
    return exporter.exportRandomSnapshotEntriesAndWait(
      team.c2cFolder.name,
      join(downloadDirectory, `team-${safeTeamId}`),
    );
  }
}
