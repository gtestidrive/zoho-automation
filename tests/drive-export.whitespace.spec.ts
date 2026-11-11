import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { DriveBackupPage } from '../pages/drive/backup/backup.page';
import { DriveExportAssertions } from '../pages/drive/export/drive-export.assertions';
import { DriveExportLocators } from '../pages/drive/export/drive-export.locators';
import { readDriveExportArchiveEntries, readDriveExportArchiveFiles } from '../pages/drive/export/workdrive-export.page';
import { TeamFolderBackupPage } from '../pages/team-folder/backup/team-folder-backup.page';

for (const team of [false, true]) {
  test(`${team ? 'Team Folder' : 'Drive'} snapshot preserves repeated spaces while reading and reopening folders`, async ({ page }) => {
    const main = team ? 'Team Folder recovery' : 'Drive recovery';
    const panel = team ? 'Team Folders' : 'Users';
    const root = team ? 'Root' : 'My Folder';
    await page.setContent(`
      <main aria-label="${main}"><section role="tabpanel" aria-label="${panel}">
        <nav><button onclick="render(false)">${root}</button><span id="crumb"></span></nav>
        <table><thead><tr><th></th><th>Name</th>${team ? '<th>Size</th>' : ''}<th>Type</th></tr></thead><tbody></tbody></table>
        <div>1-1 of 1</div><button disabled>Previous page</button><button disabled>Next page</button>
      </section></main>
      <script>
        function render(child) {
          document.querySelector('#crumb').textContent = child ? 'work  projects' : '';
          document.querySelector('tbody').innerHTML = '<tr><td></td><td onclick="render(true)">'
            + (child ? 'filename with   multiple   spaces.txt' : 'work  projects')
            + '</td>${team ? '<td>0 B</td>' : ''}<td>' + (child ? 'File' : 'Folder') + '</td></tr>';
        }
        render(false);
      </script>
    `);
    const entries = team
      ? await new TeamFolderBackupPage(page).readCurrentFolder([])
      : await new DriveBackupPage(page).getSnapshotEntries();
    expect(entries.map(({ path }) => path)).toEqual([
      'work  projects', 'work  projects\\filename with   multiple   spaces.txt',
    ]);
    const archive = zipSync({
      'work  projects/filename with   multiple   spaces.txt': strToU8('unchanged contents'),
    });
    const assertions = new DriveExportAssertions(new DriveExportLocators(page));
    assertions.expectSelectionInArchive([entries[0]], entries,
      readDriveExportArchiveEntries(archive), readDriveExportArchiveFiles(archive));
    const renamed = zipSync({
      'work  projects/filename with multiple spaces.txt': strToU8('unchanged contents'),
    });
    expect(() => assertions.expectSelectionInArchive([entries[0]], entries,
      readDriveExportArchiveEntries(renamed), readDriveExportArchiveFiles(renamed))).toThrow('does not match');
  });
}
