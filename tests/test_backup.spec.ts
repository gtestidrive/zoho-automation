import { expect, test } from '@playwright/test';
import { setupNativeCalendar, signInToCalendarC2C } from '../pages/calendar/backup/calendar_backup_config';
import {
  setupNativeContacts, signInToContactsC2C,
} from '../pages/contacts/backup/contacts_backup_config';
import { printZohoContacts, zohoContactsChecksum } from '../pages/contacts/api/zoho-contacts.api';
import {
  openMailRecovery, setupNativeMail, signInToMailC2C,
} from '../pages/mail/backup/mail_backup_config';
import { setupTeamFolders } from '../pages/team-folder/backup/team_folder_backup_config';
import { setupDriveBackup } from '../pages/drive/backup/drive_backup_config';

const suiteEnabled = process.env.RUN_ZOHO_BACKUP_SUITE === '1';

test.describe('Zoho backup and snapshot comparison suite', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async () => {
    test.skip(!suiteEnabled, 'Opt in by setting RUN_ZOHO_BACKUP_SUITE=1 to run live backups and comparisons.');
  });

  
  test('Drive: back up and compare the latest snapshot', { tag: '@zoho' }, async ({ page }) => {
    test.setTimeout(60 * 60_000);

    const { email, drivePage } = await test.step(
      'Sign in and open Drive recovery',
      () => setupDriveBackup(page),
    );

    const newFolder = await test.step(
      'Create a folder in native Drive',
      () => drivePage.createNativeFolder(),
    );

    await test.step(
      'Start the C2C backup and verify it completes',
      () => drivePage.backupUserAndVerifySnapshot(email, newFolder),
    );

    await test.step(
      'Compare the C2C snapshot with Zoho Drive',
      () => drivePage.expectSnapshotMatchesNativeDrive(email),
    );
  });


  test('Contacts: back up and compare visible contact fields', async ({ page }) => {
    test.setTimeout(60 * 60_000);
    const { email, contactsPage, contactsApi } = setupNativeContacts(page);
    const sourceContacts = await test.step('Capture native Zoho Contacts before backup', async () => {
      await contactsApi.expectAccountEmail(email);
      const contacts = await contactsApi.listContacts();
      printZohoContacts(contacts);
      if (contacts.length === 0) {
        throw new Error('Zoho Contacts is empty; add contacts before running the backup comparison.');
      }
      return contacts;
    });

    await test.step('Sign in to C2C and open Contacts recovery', () =>
      signInToContactsC2C(page));

    const user = await test.step('Select the Contacts user', () => contactsPage.selectUser(email));
    const backup = await test.step('Start the C2C Contacts backup and wait for completion', () =>
      contactsPage.startBackupAndWait(user));
    expect(backup.status).toBe('Completed');

    const snapshotContacts = await test.step('Read contacts from the latest C2C snapshot', () =>
      contactsPage.readLatestSnapshotContacts(user));
    await test.step('Verify native Contacts did not change during backup', async () => {
      const currentContacts = await contactsApi.listContacts();
      expect(zohoContactsChecksum(currentContacts)).toBe(zohoContactsChecksum(sourceContacts));
    });

    await test.step('Compare Zoho Contacts with the C2C snapshot', () =>
      contactsPage.expectSnapshotMatchesNativeContacts(
        sourceContacts, snapshotContacts,
      ));
  });


  test('Calendar: back up and compare events within matching calendar folders', async ({ page }) => {
    test.setTimeout(60 * 60_000);
    const { email, calendarPage, calendarApi } = setupNativeCalendar(page);
    const testEvent = await test.step('Create a test event in native Zoho Calendar', () =>
      calendarPage.createNativeTestEvent(calendarApi));

    await test.step(
      'Sign in to C2C and open Calendar recovery',
      () => signInToCalendarC2C(page),
    );

    const backup = await test.step('Start the C2C Calendar backup and wait for completion', () =>
      calendarPage.startBackupAndWait(email));
    expect(backup.status).toBe('Completed');

    const snapshot = await test.step('Read events and folders from the latest C2C snapshot', () =>
      calendarPage.readSnapshot(email));

    await test.step('Compare Zoho Calendar events with the C2C snapshot', () =>
      calendarPage.expectSnapshotMatchesNativeCalendar(calendarApi, snapshot, testEvent));
  });


  test('Team Folders: back up active folders and compare every inventory', async ({ page }) => {
    test.setTimeout(90 * 60_000);
    const { teamFolderPage, workDriveApi } = await test.step(
      'Sign in and open Team Folder recovery',
      () => setupTeamFolders(page),
    );

    const teams = await test.step('Select the teams to process', () =>
      teamFolderPage.listMatchingTeams(workDriveApi));

    for (const team of teams) {
      let preparedTeam = team;
      await test.step(`Select "${team.sourceFolder.name}" and create its folder and files`, async () => {
        preparedTeam = await teamFolderPage.createFolderForTeam(workDriveApi, team);
      });

      await test.step(`Back up and compare "${team.sourceFolder.name}"`, () =>
        teamFolderPage.backupAndCompareTeam(workDriveApi, preparedTeam));
    }
  });


  test('Mail: back up and compare folders and message metadata', async ({ page }) => {
    test.setTimeout(60 * 60_000);
    const { email, recipientEmail, mailApi } = setupNativeMail();

    const { subject } = await test.step(
      `Send a new test mail to ${recipientEmail}`,
      () => mailApi.sendTestMessageTo(email, recipientEmail),
    );

    const { mailPage: mailBackupPage } = await test.step(
      'Sign in to C2C',
      () => signInToMailC2C(page),
    );

    await test.step('Navigate to Mail recovery', () => openMailRecovery(page));

    await test.step('Back up Mail and compare all folders and messages with Zoho', () =>
      mailBackupPage.backupAndCompareWithNative(email, mailApi, subject));
  });
});
