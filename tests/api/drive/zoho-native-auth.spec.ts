import { test } from '@playwright/test';
import { ZohoWorkDriveApi } from '../../../pages/drive/api/zoho-workdrive.api';
import { testSettings } from '../../../test-settings';

// Run this opt-in headed test only when initially authorizing or intentionally switching WorkDrive accounts.
test('authorizes Zoho WorkDrive API with OAuth', async ({ page }) => {
  test.skip(
    process.env.SETUP_ZOHO_WORKDRIVE_OAUTH !== '1',
    'Opt in by setting SETUP_ZOHO_WORKDRIVE_OAUTH=1 before running this headed OAuth setup test.',
  );
  test.setTimeout(16 * 60_000);

  const workDriveApi = new ZohoWorkDriveApi(testSettings.zohoWorkDrive);
  await workDriveApi.authorize(page);
});