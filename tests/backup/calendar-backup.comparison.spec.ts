import { expect, test } from '@playwright/test';
import { compareCalendarFolders } from '../../pages/calendar/backup/calendar-backup.assertions';
import type { ZohoCalendar, ZohoCalendarEvent } from '../../pages/calendar/api/zoho-calendar.api';

test('compares events only within their matching calendar folder and retains empty folders', () => {
  const calendars: ZohoCalendar[] = [
    { uid: 'ajay-uid', name: 'Ajay' },
    { uid: 'empty-uid', name: 'Empty Calendar' },
  ];
  const zohoEvents: ZohoCalendarEvent[] = [
    {
      uid: 'event-ajay',
      calendarUid: 'ajay-uid',
      calendarName: 'Ajay',
      title: 'Planning',
      organizer: 'ajay@example.com',
      start: '20261025T100000+0000',
    },
  ];
  const c2cEvents = [
    { calendarName: ' ajay ', title: ' Planning  ', organizer: 'Ajay Para', start: '2026-10-25T10:00:00Z' },
    { calendarName: 'Other', title: 'Planning', organizer: 'Ajay Para', start: '2026-10-25T10:00:00Z' },
  ];

  const result = compareCalendarFolders(
    calendars,
    zohoEvents,
    ['Ajay', 'Empty Calendar', 'Other'],
    c2cEvents,
  );

  expect(result).toEqual([
    {
      calendarName: 'Ajay',
      zohoCalendarCount: 1,
      c2cFolderCount: 1,
      zohoEventCount: 1,
      c2cEventCount: 1,
      zohoOnly: [],
      c2cOnly: [],
    },
    {
      calendarName: 'Empty Calendar',
      zohoCalendarCount: 1,
      c2cFolderCount: 1,
      zohoEventCount: 0,
      c2cEventCount: 0,
      zohoOnly: [],
      c2cOnly: [],
    },
    {
      calendarName: 'Other',
      zohoCalendarCount: 0,
      c2cFolderCount: 1,
      zohoEventCount: 0,
      c2cEventCount: 1,
      zohoOnly: [],
      c2cOnly: [c2cEvents[1]],
    },
  ]);
});
