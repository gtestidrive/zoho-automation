import type { Page } from '@playwright/test';
import { CalendarBackupPage } from './calendar-backup.page';
import { RecoveryPage } from '../../recovery.page';
import { SignInPage } from '../../sign-in.page';
import { ZohoCalendarApi } from '../api/zoho-calendar.api';
import { testSettings } from '../../../test-settings';

export function setupNativeCalendar(page: Page) {
  const email = testSettings.zohoNative.email.trim();
  if (!email) {
    throw new Error('Set ZOHO_NATIVE_EMAIL or ZOHO_NATIVE_USERNAME to the Zoho Calendar user email.');
  }

  return {
    email,
    calendarPage: new CalendarBackupPage(page),
    calendarApi: new ZohoCalendarApi(testSettings.zohoCalendar),
  };
}

export async function signInToCalendarC2C(page: Page): Promise<void> {
  await page.goto(testSettings.c2cZoho.url, { waitUntil: 'domcontentloaded' });
  await new SignInPage(page).signInIfRequired(testSettings.c2cZoho.email, testSettings.c2cZoho.password);
  await new RecoveryPage(page).openTab('Calendar');
}
