import { test } from '@playwright/test';
import { ZohoCalendarApi } from '../../../pages/calendar/api/zoho-calendar.api';
import { testSettings } from '../../../test-settings';

test('authorize Zoho Calendar read and event creation access', async ({ page }) => {
  test.skip(
    process.env.SETUP_ZOHO_CALENDAR_OAUTH !== '1',
    'Opt in by setting SETUP_ZOHO_CALENDAR_OAUTH=1 before running this headed setup test.',
  );
  test.setTimeout(16 * 60_000);

  await new ZohoCalendarApi(testSettings.zohoCalendar).authorize(page, testSettings.zohoNative.email);
});