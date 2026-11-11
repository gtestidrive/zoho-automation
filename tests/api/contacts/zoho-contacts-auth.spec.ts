import { test } from '@playwright/test';
import { ZohoContactsApi } from '../../../pages/contacts/api/zoho-contacts.api';
import { testSettings } from '../../../test-settings';

test('authorize Zoho Contacts read and create access', async ({ page }) => {
  test.skip(
    process.env.SETUP_ZOHO_CONTACTS_OAUTH !== '1',
    'Opt in by setting SETUP_ZOHO_CONTACTS_OAUTH=1 before running this headed setup test.',
  );
  test.setTimeout(16 * 60_000);

  await new ZohoContactsApi(testSettings.zohoContacts).authorize(page);
});
