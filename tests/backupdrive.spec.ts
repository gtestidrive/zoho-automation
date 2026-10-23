import { expect } from '@playwright/test';
import { test } from '../pages/drive/backup/backup.fixture';
import { DriveBackupPage, type DriveSnapshotEntry } from '../pages/drive/backup/backup.page';
import { RecoveryPage } from '../pages/recovery.page';
import { SignInPage } from '../pages/sign-in.page';
import { ZohoWorkDriveApi, type WorkDriveEntry } from '../services/zoho-workdrive.api';
import { testSettings } from '../test-settings';

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function entryKey(entry: { path: string; type: 'Folder' | 'File' }): string {
  return `${entry.type.toLowerCase()}:${entry.path.replace(/\//g, '\\').toLocaleLowerCase()}`;
}

function logEntries(title: string, entries: Array<WorkDriveEntry | DriveSnapshotEntry>): void {
  console.log(`[Zoho C2C comparison] ${title}: ${entries.length}.`);
  for (const entry of entries.slice(0, 50)) {
    console.log(`[Zoho C2C comparison] ${entry.type}: ${entry.path}`);
  }
  if (entries.length > 50) {
    console.log(`[Zoho C2C comparison] ...and ${entries.length - 50} more.`);
  }
}

test('creates and backs up a Zoho Native WorkDrive folder in C2C', { tag: '@zoho' }, async ({ driveBackupPage }) => {
  test.setTimeout(40 * 60_000);

  const nativeEmail = testSettings.zohoNative.email;
  if (!nativeEmail) {
    throw new Error('Set the WorkDrive account email with ZOHO_NATIVE_EMAIL or ZOHO_NATIVE_USERNAME.');
  }

  const createdAt = new Date();
  const runStamp = createdAt.toISOString().replace(/[-:T.Z]/g, '');
  const folderName = `test-${runStamp}`;
  const documentName = `zoho-document-${runStamp}.txt`;

  const workDriveApi = new ZohoWorkDriveApi(testSettings.zohoWorkDrive);
  log('[Zoho native] Creating a fresh WorkDrive folder with OAuth.');
  const folderId = await workDriveApi.createFolder(folderName);
  await workDriveApi.uploadTextFile(
    folderId,
    documentName,
    `Created in ${folderName} for backup at ${createdAt.toISOString()}\n`,
  );
  log(`[Zoho native] Uploaded "${documentName}" to "${folderName}" through the WorkDrive API.`);

  await driveBackupPage.backupUserAndVerifySnapshot(nativeEmail, folderName);
});

test('compares WorkDrive files and folders with the latest C2C snapshot', { tag: '@zoho' }, async ({ page }) => {
  test.skip(
    process.env.COMPARE_ZOHO_WORKDRIVE_C2C !== '1',
    'Opt in by setting COMPARE_ZOHO_WORKDRIVE_C2C=1 before running this live comparison.',
  );
  test.setTimeout(60 * 60_000);

  const nativeEmail = testSettings.zohoNative.email;
  if (!nativeEmail) {
    throw new Error('Set the WorkDrive account email with ZOHO_NATIVE_EMAIL or ZOHO_NATIVE_USERNAME.');
  }

  const workDriveApi = new ZohoWorkDriveApi(testSettings.zohoWorkDrive);
  const workDriveEntries = await workDriveApi.listFilesAndFolders();

  await page.goto(testSettings.c2cZoho.url, { waitUntil: 'domcontentloaded' });
  const signInPage = new SignInPage(page);
  await signInPage.signInIfRequired(testSettings.c2cZoho.email, testSettings.c2cZoho.password);

  const recoveryPage = new RecoveryPage(page);
  await recoveryPage.openTab('Drive');
  const driveBackupPage = new DriveBackupPage(page);
  await driveBackupPage.openUsersTab();
  const user = await driveBackupPage.selectUser(nativeEmail);
  const c2cEntries = await driveBackupPage.getSnapshotEntries();

  const c2cKeys = new Set(c2cEntries.map(entryKey));
  const workDriveKeys = new Set(workDriveEntries.map(entryKey));
  const missingFromC2C = workDriveEntries.filter((entry) => !c2cKeys.has(entryKey(entry)));
  const onlyInC2C = c2cEntries.filter((entry) => !workDriveKeys.has(entryKey(entry)));

  console.log(`[Zoho C2C comparison] WorkDrive entries: ${workDriveEntries.length}.`);
  console.log(`[Zoho C2C comparison] C2C snapshot entries for ${user.email}: ${c2cEntries.length}.`);
  logEntries('WorkDrive entries missing from the C2C snapshot', missingFromC2C);
  logEntries('Entries present only in the C2C snapshot', onlyInC2C);

  expect(
    missingFromC2C,
    `${missingFromC2C.length} WorkDrive entries are missing from ${user.email}'s current C2C snapshot.`,
  ).toEqual([]);
});

test('prints files and folders from the selected WorkDrive My Folders tree', { tag: '@zoho' }, async () => {
  test.setTimeout(10 * 60_000);

  const workDriveApi = new ZohoWorkDriveApi(testSettings.zohoWorkDrive);
  const entries = await workDriveApi.listFilesAndFolders();

  console.log(`[Zoho WorkDrive] Found ${entries.length} files and folders in the selected My Folders tree.`);
  for (const entry of entries) {
    console.log(`[Zoho WorkDrive] ${entry.type}: ${entry.path} (id=${entry.id})`);
  }
});
