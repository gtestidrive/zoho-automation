import { expect, test } from '@playwright/test';
import { setupContacts } from '../pages/contacts/contacts_restore_config';
import {
  isCurrentContactsRestoreFolder,
  type ZohoContactCategory,
  zohoContactSummary,
  ZohoContactsApi,
  zohoContactsChecksum,
} from '../pages/contacts/api/zoho-contacts.api';
import { contactSummariesChecksum } from '../pages/contacts/backup/contacts-backup.assertions';
import { testSettings } from '../test-settings';

test('backs up Zoho Contacts and verifies a new timestamped restore folder', { tag: '@zoho' }, async ({ page }) => {
  test.skip(
    process.env.RUN_ZOHO_CONTACTS_RESTORE !== '1',
    'This live test backs up and restores Zoho Contacts. Set RUN_ZOHO_CONTACTS_RESTORE=1 to opt in.',
  );
  test.setTimeout(40 * 60_000);

  const nativeEmail = testSettings.zohoNative.email.trim();
  if (!nativeEmail) {
    throw new Error('Set ZOHO_NATIVE_EMAIL or ZOHO_NATIVE_USERNAME to the backed-up Zoho Contacts user email.');
  }

  const api = new ZohoContactsApi(testSettings.zohoContacts);
  const sourceContacts = await test.step('Capture native Zoho Contacts before backup', async () => {
    await api.expectAccountEmail(nativeEmail);
    const contacts = await api.listContacts();
    if (contacts.length === 0) {
      throw new Error('Zoho Contacts is empty. Add contacts to the authorized account before running backup/restore verification.');
    }
    return contacts;
  });
  const sourceChecksum = zohoContactsChecksum(sourceContacts);
  const existingCategories = new Set((await api.listCategories()).map((category) => category.category_id));

  console.log(`[Zoho Contacts] Captured ${sourceContacts.length} source contacts before backup.`);

  const { contactsPage, email } = await test.step('Sign in and open Contacts recovery', () => setupContacts(page));
  const user = await test.step('Select the Contacts user', () => contactsPage.selectUser(email));

  const backup = await test.step('Start the C2C backup and wait for completion', () =>
    contactsPage.startBackupAndWait(user));
  expect(backup.status).toBe('Completed');

  await test.step('Verify the native contacts did not change during backup', async () => {
    expect(
      zohoContactsChecksum(await api.listContacts()),
      'Source contacts changed during backup; a stable source is required for verification.',
    ).toBe(sourceChecksum);
  });

  const snapshotCount = await test.step('Verify the latest C2C snapshot count', () =>
    contactsPage.readLatestSnapshotContactCount(user));
  expect(
    snapshotCount,
    'The latest C2C backup snapshot must contain exactly the contacts captured from Zoho before restoring.',
  ).toBe(sourceContacts.length);

  const restore = await test.step('Restore the snapshot to a new Zoho folder', () =>
    contactsPage.restoreToNewFolder(user));
  expect(restore.status).toMatch(/completed/i);
  console.log(`[Zoho C2C Contacts] Restore history reports ${restore.itemCount} items; native folder contents determine verification.`);
  const completedAt = Date.now();

  let restoredFolder: ZohoContactCategory | undefined;
  await test.step('Verify the new native restore folder matches the source contacts', async () => {
    await expect.poll(async () => {
      const candidates = (await api.listCategories()).filter((category) =>
        !existingCategories.has(category.category_id)
        && isCurrentContactsRestoreFolder(category.category_name, Date.parse(restore.startedAt), completedAt));
      if (candidates.length > 1) {
        throw new Error('Multiple new timestamped restore folders were created; cannot attribute this restore safely.');
      }
      restoredFolder = candidates[0];
      if (!restoredFolder || restoredFolder.count !== sourceContacts.length) {
        return false;
      }
      const contacts = await api.listCategoryContacts(restoredFolder);
      return contacts.length === sourceContacts.length
        && zohoContactsChecksum(contacts) === sourceChecksum;
    }, {
      timeout: 3 * 60_000,
      intervals: [5_000],
      message: 'A new UTC-timestamped Restored Contacts folder must contain every backed-up contact with matching content.',
    }).toBe(true);

    if (!restoredFolder) {
      throw new Error('No verified restore folder was found.');
    }
    console.table([{
      Folder: restoredFolder.category_name,
      Count: restoredFolder.count,
      SourceCount: sourceContacts.length,
      Checksum: sourceChecksum,
      Status: 'Verified',
    }]);
  });
});

test('restores the existing C2C Contacts snapshot to a new Zoho folder', { tag: '@zoho' }, async ({ page }) => {
  test.skip(
    process.env.RUN_ZOHO_CONTACTS_RESTORE_ONLY !== '1',
    'Set RUN_ZOHO_CONTACTS_RESTORE_ONLY=1 to restore the existing C2C snapshot without a new backup.',
  );
  test.setTimeout(20 * 60_000);

  const { email, contactsPage: c2c, contactsApi: api } = await test.step(
    'Sign in and open Contacts recovery',
    () => setupContacts(page),
  );
  await api.expectAccountEmail(email);

  const user = await c2c.selectUser(email);
  const snapshot = await test.step('Read the existing C2C snapshot contacts', () =>
    c2c.readLatestSnapshotContacts(user));
  expect(snapshot.length, 'The C2C snapshot must contain contacts to verify a restore.').toBeGreaterThan(0);
  const checksum = contactSummariesChecksum(snapshot);

  const existing = new Set((await api.listCategories()).map((category) => category.category_id));
  console.log(`[C2C restore-only] Captured ${snapshot.length} snapshot contacts; no backup will be started.`);

  const restore = await test.step('Restore the existing snapshot to a new Zoho folder', () =>
    c2c.restoreToNewFolder(user));
  const completedAt = Date.now();
  let folder: ZohoContactCategory | undefined;
  let actualCount = 0;

  await test.step('Verify the new restore folder matches the C2C snapshot', async () => {
    await expect.poll(async () => {
      const candidates = (await api.listCategories()).filter((category) =>
        !existing.has(category.category_id)
        && isCurrentContactsRestoreFolder(category.category_name, Date.parse(restore.startedAt), completedAt));
      if (candidates.length > 1) {
        throw new Error('Multiple new timestamped restore folders found; cannot safely identify this restore.');
      }
      folder = candidates[0];
      if (!folder) {
        return { folderCreated: false, count: 0, checksum: '' };
      }
      const contacts = await api.listCategoryContacts(folder);
      actualCount = contacts.length;
      return {
        folderCreated: true,
        count: actualCount,
        checksum: contactSummariesChecksum(contacts.map(zohoContactSummary)),
      };
    }, {
      timeout: 3 * 60_000,
      intervals: [5_000],
      message: `New Zoho restore folder must match all ${snapshot.length} C2C snapshot contacts (Name, Email, Phone, including duplicates).`,
    }).toEqual({ folderCreated: true, count: snapshot.length, checksum });

    console.table([{
      Folder: folder?.category_name,
      C2C: snapshot.length,
      Zoho: actualCount,
      Status: 'Verified',
    }]);
  });
});
