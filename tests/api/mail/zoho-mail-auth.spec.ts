import { test } from '@playwright/test';
import { ZohoMailApi } from '../../../pages/mail/api/zoho-mail.api';
import { OAuthPage } from '../../../pages/oauth.page';
import { testSettings } from '../../../test-settings';

test('authorize Zoho Mail read and send access', async ({ page }) => {
  test.skip(
    process.env.SETUP_ZOHO_MAIL_OAUTH !== '1',
    'Opt in by setting SETUP_ZOHO_MAIL_OAUTH=1 before running this headed setup test.',
  );
  test.setTimeout(16 * 60_000);

  await new ZohoMailApi(testSettings.zohoMail).authorize(new OAuthPage(page).open);
});
