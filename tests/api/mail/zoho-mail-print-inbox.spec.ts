import { test } from '@playwright/test';
import { ZohoMailApi } from '../../../pages/mail/api/zoho-mail.api';
import { testSettings } from '../../../test-settings';

test('print Zoho Mail Inbox metadata from API', async () => {
  const folders = await new ZohoMailApi(testSettings.zohoMail)
    .listFoldersAndMessages(testSettings.zohoNative.email);
  const inboxes = folders.filter((folder) => folder.path.trim().toLowerCase() === 'inbox');
  if (inboxes.length !== 1) {
    throw new Error(`Expected exactly one Zoho API Inbox, found ${inboxes.length}.`);
  }

  console.log(`[Zoho Mail API] Inbox contains ${inboxes[0].messages.length} message records.`);
  console.table(inboxes[0].messages.map((message, index) => ({
    Index: index + 1,
    From: message.from,
    To: message.to,
    Subject: message.subject,
    Size: message.size,
  })));
});
