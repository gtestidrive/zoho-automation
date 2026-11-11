import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupCalendarExport } from '../pages/calendar/export/calendar_export_config';
import { setupContactsExport } from '../pages/contacts/export/contacts_export_config';
import { setupDriveExport } from '../pages/drive/export/drive_export_config';
import { compareMailExportMessages } from '../pages/mail/export/mail-export.comparison';
import { readExportedMailMessages } from '../pages/mail/export/mail-export.page';
import { setupMailExport } from '../pages/mail/export/mail_export_config';
import { setupTeamFolderExport } from '../pages/team-folder/export/team_folder_export_config';

const exportSuiteEnabled = process.env.RUN_ZOHO_EXPORT_SUITE === '1';

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
  test.describe.configure({ mode: 'default' });

  test.beforeEach(async () => {
    test.skip(!exportSuiteEnabled, 'Opt in by setting RUN_ZOHO_EXPORT_SUITE=1 to run live exports.');
  });

  test('Drive export: randomly select snapshot files and folders, download ZIP, and verify selection', async ({ page }) => {
    test.setTimeout(20 * 60_000);

    const { email, exportPage } = await test.step(
      'Sign in and open Drive recovery',
      () => setupDriveExport(page),
    );

    const result = await test.step(
      'Export selected snapshot items, download the ZIP, and verify its contents',
      () => exportPage.exportRandomSnapshotEntriesAndWait(
        email,
        join(homedir(), 'Downloads', 'ZohoDriveExportInspection'),
      ),
    );

    await test.step('Verify the Drive export completed', async () => {
      expect(result.selectedEntries.length).toBeGreaterThan(0);
      expect(result.status).toBe('Active');
      expect(result.archiveEntries.length).toBeGreaterThan(0);
      expect(await readFile(result.archivePath)).toBeTruthy();
      console.log(`[Zoho C2C Drive] Preserved export ZIP for Explorer inspection: ${result.archivePath}`);
    });
  });

  test('Team Folder export: export random folders from every team and verify C2C inventory and Zoho checksums', async ({ page }) => {
    test.setTimeout(60 * 60_000);
    const { exportPage } = await test.step('Sign in and open Team Folder recovery', () =>
      setupTeamFolderExport(page));
    const teams = await test.step('Match every C2C team with Zoho WorkDrive', () =>
      exportPage.listMatchingTeams());
    test.setTimeout(Math.max(60 * 60_000, teams.length * 20 * 60_000));
    await test.step('Export and verify 1-3 random folders inside each team', () =>
      exportPage.exportEveryTeamAndVerify(
        teams,
        join(homedir(), 'Downloads', 'ZohoTeamFolderExportInspection'),
      ));
  });

  test('Contacts export: select real contacts, download VCF ZIP, and verify C2C and Zoho fields', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const { email, exportPage } = await test.step('Sign in and open Contacts recovery', () =>
      setupContactsExport(page));
    const result = await test.step('Export random contacts and verify downloaded fields with C2C and Zoho', () =>
      exportPage.exportRandomContactsAndVerify(
        email,
        join(homedir(), 'Downloads', 'ZohoContactsExportInspection'),
      ));
    expect(result.selectedContacts.length).toBeGreaterThan(0);
    expect(result.exportedContacts).toBe(result.selectedContacts.length);
    console.log(`[Contacts export] Preserved verified archive: ${result.archivePath}`);
  });

  test('Calendar export: select real events, download ZIP, and verify C2C fields and Zoho event checksums', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const { email, exportPage } = await test.step('Sign in and open Calendar recovery', () =>
      setupCalendarExport(page));
    const result = await test.step('Export 1-3 real events and verify C2C fields and live Zoho event data', () =>
      exportPage.exportRandomEventsAndVerify(email, join(homedir(), 'Downloads', 'ZohoCalendarExportInspection')));
    expect(result.selectedEvents.length).toBeGreaterThan(0);
    expect(result.selectedEvents.length).toBeLessThanOrEqual(3);
    expect(result.exportedEvents).toBe(result.selectedEvents.length);
    console.log(`[Calendar export] Preserved verified archive: ${result.archivePath}`);
  });

  test('Mail export: select real messages, download ZIP, and verify C2C headers and Zoho MIME checksums', async ({ page }) => {
    test.setTimeout(30 * 60_000);

    const { email, exportPage } = await test.step(
      'Sign in and open Mail recovery',
      () => setupMailExport(page),
    );
    const result = await test.step('Export 1-3 real messages and verify C2C fields and Zoho original MIME', () =>
      exportPage.exportRandomMessagesAndVerify(email, join(homedir(), 'Downloads', 'ZohoMailExportInspection')));
    expect(result.exportedMessages).toBe(result.selectedMessages);
    console.log(`[Mail export] Preserved verified archive: ${result.archivePath}`);
  });
});
