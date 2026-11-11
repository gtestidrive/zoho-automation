import type { Page } from '@playwright/test';
import { setupNativeCalendar, signInToCalendarC2C } from '../backup/calendar_backup_config';
import { CalendarExportPage } from './calendar-export.page';

export async function setupCalendarExport(page: Page) {
  const { email, calendarApi } = setupNativeCalendar(page);
  await signInToCalendarC2C(page);
  return { email, exportPage: new CalendarExportPage(page, calendarApi) };
}
