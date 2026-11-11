import { expect, test } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chooseRandomDriveExportEntries,
} from '../pages/drive/backup/backup.page';
import { DriveBackupLocators } from '../pages/drive/backup/backup.locators';
import { setupDriveBackup } from '../pages/drive/backup/drive_backup_config';
import { openMailRecovery, signInToMailC2C } from '../pages/mail/backup/mail_backup_config';
import { compareMailExportMessages, readExportedMailMessages } from '../pages/mail/export/mail-export.comparison';

const exportSuiteEnabled = process.env.RUN_ZOHO_EXPORT_SUITE === '1';

test('Drive export selection includes a random file and folder when available', () => {
  const entries = [
    { type: 'File' as const, path: 'file-a' },
    { type: 'File' as const, path: 'file-b' },
    { type: 'Folder' as const, path: 'folder-a' },
  ];

  expect(chooseRandomDriveExportEntries(entries, () => 0).map(({ path }) => path))
    .toEqual(['file-a', 'folder-a', 'file-b']);
});

test('Drive export history locator supports a selected tab without a tabpanel role', async ({ page }) => {
  await page.setContent(`
    <main aria-label="Drive recovery">
      <div role="tablist">
        <button role="tab" aria-selected="true">Exports</button>
      </div>
      <table>
        <thead><tr><th>Source</th><th>Type</th><th>Destination</th></tr></thead>
        <tbody><tr><td colspan="3">Loading...</td></tr></tbody>
      </table>
    </main>
  `);
  const locators = new DriveBackupLocators(page);

  await expect(locators.exportsTab).toHaveAttribute('aria-selected', 'true');
  await expect(locators.exportsTable).toBeVisible();
  await expect(locators.exportsLoading).toBeVisible();
});

test('reads Mail message headers from an export ZIP and preserves duplicate messages', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mail-export-comparison-'));
  const zipPath = join(directory, 'inbox.zip');
  const message = [
    'From: Zoho Sender <sender@example.com>',
    'To: c2c@example.com',
    'Subject: =?UTF-8?B?SGVsbG8gV29ybGQ=?=',
    '',
    'Message body is not needed for metadata comparison.',
  ].join('\r\n');
  try {
    await writeFile(zipPath, zipSync({
      'Inbox/1.eml': strToU8(message),
      'Inbox/2.eml': strToU8(message),
    }, { level: 6 }));
    const exported = await readExportedMailMessages(zipPath);
    const native = [
      { from: 'sender@example.com', to: 'c2c@example.com', subject: 'Hello World', size: '1kb' },
      { from: 'sender@example.com', to: 'c2c@example.com', subject: 'Hello World', size: '1kb' },
    ];

    expect(exported).toHaveLength(2);
    expect(compareMailExportMessages(native, exported)).toEqual({ nativeOnly: [], exportOnly: [] });
    expect(compareMailExportMessages(native.slice(0, 1), exported)).toEqual({
      nativeOnly: [],
      exportOnly: [{ from: 'sender@example.com', to: 'c2c@example.com', subject: 'Hello World' }],
    });
    expect(compareMailExportMessages([{
      from: 'Zoho Sender &lt;sender@example.com&gt;',
      to: 'c2c@example.com&gt;',
      subject: 'Hello &#39;World&#39;',
      size: '1kb',
    }], [{
      from: 'sender@example.com',
      to: 'c2c@example.com',
      subject: "Hello 'World'",
    }])).toEqual({ nativeOnly: [], exportOnly: [] });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test.describe('Zoho export suite', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async () => {
    test.skip(!exportSuiteEnabled, 'Opt in by setting RUN_ZOHO_EXPORT_SUITE=1 to run live exports.');
  });

  test('Drive export: randomly select snapshot files and folders and wait for Active', async ({ page }) => {
    test.setTimeout(20 * 60_000);

    const { email, drivePage } = await test.step(
      'Sign in and open Drive recovery',
      () => setupDriveBackup(page),
    );

    const result = await test.step(
      'Select snapshot items and wait for the export to become Active',
      () => drivePage.exportRandomSnapshotEntriesAndWait(email),
    );

    await test.step('Verify the Drive export completed', async () => {
      expect(result.selectedEntries.length).toBeGreaterThan(0);
      expect(result.status).toBe('Active');
    });
  });

  test('Mail export: download Inbox and compare exported messages with Zoho Inbox', async ({ page }) => {
    test.setTimeout(30 * 60_000);

    const { email, mailPage, mailApi } = await test.step(
      'Sign in to C2C',
      () => signInToMailC2C(page),
    );
    await test.step('Navigate to Mail recovery', () => openMailRecovery(page));

    const inbox = await test.step('Read the native Zoho Inbox inventory', async () => {
      const nativeFolders = await mailApi.listFoldersAndMessages(email);
      const matchingInboxes = nativeFolders.filter((folder) =>
        folder.name.trim().toLowerCase() === 'inbox');
      const selectedInbox = matchingInboxes.find((folder) => folder.path.trim().toLowerCase() === 'inbox')
        ?? (matchingInboxes.length === 1 ? matchingInboxes[0] : undefined);
      if (!selectedInbox) {
        throw new Error(`Expected exactly one Zoho Mail Inbox, found ${matchingInboxes.length}.`);
      }
      return selectedInbox;
    });

    const downloadDirectory = join(homedir(), 'Downloads', 'ZohoMailExportInspection');
    await test.step('Prepare the download folder', async () => {
      await mkdir(downloadDirectory, { recursive: true });
    });

    const download = await test.step('Download the completed Inbox export', () =>
      mailPage.exportFolderAndDownload(email, inbox.name, downloadDirectory));
    console.log(`[Zoho C2C Mail] Preserved export ZIP for Explorer inspection: ${download.archivePath}`);

    const exportedMessages = await test.step('Read message headers from the downloaded ZIP', () =>
      readExportedMailMessages(download.archivePath));
    await test.step('Compare exported headers with the Zoho Inbox', async () => {
      const result = compareMailExportMessages(inbox.messages, exportedMessages);
      console.table([{
        Folder: inbox.path,
        ZohoInboxMessages: inbox.messages.length,
        DownloadedMessages: exportedMessages.length,
        MissingFromExport: result.nativeOnly.length,
        ExtraInExport: result.exportOnly.length,
      }]);
      expect(result.nativeOnly, 'Zoho Inbox contains messages missing from the downloaded export.').toEqual([]);
      expect(result.exportOnly, 'The downloaded Inbox export contains messages not found in Zoho Inbox.').toEqual([]);
    });
  });
});
