import { expect, test } from '@playwright/test';
import { compareWorkDriveEntries } from '../../pages/drive/backup/backup.assertions';
import type { DriveSnapshotEntry } from '../../pages/drive/backup/backup.page';
import type { WorkDriveEntry } from '../../pages/drive/api/zoho-workdrive.api';
import { TeamFolderBackupPage } from '../../pages/team-folder/backup/team-folder-backup.page';

test('Team Folder comparison normalizes separators and repeated spaces', () => {
  const source: WorkDriveEntry[] = [
    { id: 'source-folder', name: 'work  projects', type: 'Folder', path: 'DropboxFiles/EmojiPaths/work  projects' },
    { id: 'source-file', name: 'report   final.txt', type: 'File', path: 'DropboxFiles/EdgeCases/report   final.txt' },
  ];
  const snapshot: DriveSnapshotEntry[] = [
    { name: 'work projects', type: 'Folder', path: 'DropboxFiles\\EmojiPaths\\work projects' },
    { name: 'report final.txt', type: 'File', path: 'DropboxFiles\\EdgeCases\\report final.txt' },
  ];

  expect(compareWorkDriveEntries(source, snapshot)).toEqual({ missingFromC2C: [], extraInC2C: [] });
});

test('ignores empty placeholder rows when reading a Team Folder snapshot', async ({ page }) => {
  await page.setContent(`
    <main aria-label="Team Folder recovery">
      <button role="tab">Team Folders</button>
      <section role="tabpanel" aria-label="Team Folders">
        <div id="team-content">
          <input type="search" aria-label="Search Team Folders">
          <table>
            <thead><tr><th>Folder Name</th><th>Owner</th><th>Unused</th><th>Last Backup</th><th>Storage Used</th></tr></thead>
            <tbody><tr><td>Engineering</td><td>Owner</td><td></td><td>Today</td><td>1 GB</td></tr></tbody>
          </table>
        </div>
      </section>
      <section role="tabpanel" aria-label="Backups"></section>
      <div class="rcv-stat-item__body">Status Active</div>
    </main>
  `);
  await page.evaluate(() => {
    const renderSnapshot = () => {
      document.querySelector('#team-content')!.innerHTML = `
        <button>← All Team Folders</button>
        <input type="search" aria-label="Search Folders/Files">
        <table>
          <thead><tr><th>Select</th><th>Name</th><th>Size</th><th>Type</th></tr></thead>
          <tbody>
            <tr></tr>
            <tr><td></td><td>report.txt</td><td>1 KB</td><td>File</td></tr>
          </tbody>
        </table>
        <span>1–1 of 1</span>
        <button aria-label="Next page" disabled></button>
      `;
    };
    document.querySelector('#team-content tbody tr')!.addEventListener('click', renderSnapshot);
  });

  const entries = await new TeamFolderBackupPage(page).readSnapshot('Engineering');
  expect(entries).toEqual([
    { id: 'report.txt', name: 'report.txt', type: 'File', path: 'report.txt' },
  ]);
});
