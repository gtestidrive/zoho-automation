import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import {
  CalendarExportAssertions,
  calendarEventChecksum,
  canonicalDownloadedEvent,
  canonicalSourceEvent,
} from '../pages/calendar/export/calendar-export.assertions';
import { readCalendarExport, readCalendarOriginals } from '../pages/calendar/export/calendar-export.page';

const event = [
  'BEGIN:VEVENT',
  'UID:event@zoho.in',
  'SUMMARY:Export verification',
  'CREATED:20260709T060551',
  'DTSTART;TZID=Asia/Kolkata:20260720T090000',
  'DTEND;TZID=Asia/Kolkata:20260720T093000',
  'ORGANIZER;CN=Example Owner:mailto:owner@example.com',
  'DESCRIPTION:First line\\nSecond line\\,',
  '  continued',
  'LOCATION:Room 1',
  'ATTENDEE:mailto:guest@example.com',
  'END:VEVENT',
].join('\r\n');

function archive(events: string): Uint8Array {
  return zipSync({ 'account/Calendar.ical': strToU8(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}\r\nEND:VCALENDAR`) });
}

function sourceEvent(): Record<string, unknown> {
  return {
    uid: 'event@zoho.in', title: 'Export verification', organizer: 'owner@example.com',
    dateandtime: { start: '20260720T090000+0530', end: '20260720T093000+0530' },
    isallday: false, description: 'First line\nSecond line, continued', location: 'Room 1',
    attendees: [{ email: 'guest@example.com' }],
  };
}

test('Calendar parser preserves duplicate UIDs, folded fields, timezone dates and .ical payloads', () => {
  const downloaded = readCalendarExport(archive(`${event}\r\n${event}`));
  expect(downloaded).toHaveLength(2);
  const canonical = canonicalDownloadedEvent(downloaded[0]);
  expect(canonical.start).toBe('2026-07-20T03:30:00.000Z');
  expect(canonical.end).toBe('2026-07-20T04:00:00.000Z');
  expect(canonical.description).toBe('First line\nSecond line, continued');
  expect(canonical).toEqual(canonicalSourceEvent(sourceEvent()));
});

test('Calendar checksum changes for altered event data, attendees and recurrence', () => {
  const original = calendarEventChecksum(canonicalDownloadedEvent(readCalendarExport(archive(event))[0]));
  for (const change of [
    { title: 'Changed title' }, { description: 'Changed description' }, { location: 'Room 2' },
    { attendees: [] }, { rrule: 'FREQ=DAILY;COUNT=2' },
    { dateandtime: { start: '20260720T090000+0530', end: '20260720T100000+0530' } },
  ]) {
    expect(calendarEventChecksum(canonicalSourceEvent({ ...sourceEvent(), ...change }))).not.toBe(original);
  }
});

test('Calendar C2C comparison uses creation time, consumes duplicates and rejects missing/extra events', () => {
  const downloaded = readCalendarExport(archive(`${event}\r\n${event}`));
  const selected = {
    calendarName: 'Calendar', title: 'Export verification', organizer: 'Example Owner', created: '2026-07-09 06:05:51',
  };
  const assertions = new CalendarExportAssertions();
  assertions.expectC2CMatches([selected, selected], downloaded);
  expect(() => assertions.expectC2CMatches([selected], downloaded)).toThrow();
  expect(() => assertions.expectC2CMatches([selected, selected], downloaded.slice(0, 1))).toThrow();
  expect(() => assertions.expectC2CMatches([{ ...selected, created: '2026-07-20 09:00:00' }], downloaded.slice(0, 1))).toThrow();
});

test('Calendar parser handles all-day dates and recurrence rules', () => {
  const allDay = event.replace('DTSTART;TZID=Asia/Kolkata:20260720T090000', 'DTSTART;VALUE=DATE:20260720')
    .replace('DTEND;TZID=Asia/Kolkata:20260720T093000', 'DTEND;VALUE=DATE:20260721')
    .replace('END:VEVENT', 'RRULE:FREQ=DAILY;COUNT=2\r\nEND:VEVENT');
  const canonical = canonicalDownloadedEvent(readCalendarExport(archive(allDay))[0]);
  expect(canonical.start).toBe('2026-07-20');
  expect(canonical.end).toBe('2026-07-21');
  expect(canonical.allDay).toBe(true);
  expect(canonical).toEqual(canonicalSourceEvent({
    ...sourceEvent(), isallday: true,
    dateandtime: { start: '20260720', end: '20260721' }, rrule: 'COUNT=2;FREQ=DAILY',
  }));
});

test('Calendar filename sanitization matches slash names without weakening event fields or source identity', async () => {
  const downloaded = readCalendarExport(zipSync({
    'account/Calendar with Free_Busy.ical': strToU8(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${event}\r\nEND:VCALENDAR`),
  }));
  const selected = {
    calendarName: 'Calendar with Free/Busy', title: 'Export verification',
    organizer: 'Example Owner', created: '2026-07-09 06:05:51',
  };
  const assertions = new CalendarExportAssertions();
  assertions.expectC2CMatches([selected], downloaded);
  expect(() => assertions.expectC2CMatches([{ ...selected, organizer: 'Wrong owner' }], downloaded)).toThrow();
  expect(() => assertions.expectC2CMatches([{ ...selected, calendarName: 'Other calendar' }], downloaded)).toThrow();
  const calls: string[][] = [];
  const api = {
    listCalendars: async () => [{ uid: 'calendar-uid', name: selected.calendarName }],
    getEventDetails: async (calendarUid: string, eventUid: string) => {
      calls.push([calendarUid, eventUid]);
      return sourceEvent();
    },
  };
  assertions.expectZohoMatches(await readCalendarOriginals(downloaded, api));
  expect(calls).toEqual([['calendar-uid', 'event@zoho.in']]);
  await expect(readCalendarOriginals(downloaded, {
    ...api, listCalendars: async () => [
      { uid: 'calendar-uid', name: selected.calendarName },
      { uid: 'other-uid', name: 'Calendar with Free_Busy' },
    ],
  })).rejects.toThrow('Cannot uniquely identify Zoho calendar');
  expect(calls).toHaveLength(1);
});

test('Calendar verification rejects malformed archives and unsupported source shapes', () => {
  expect(() => readCalendarExport(archive(event.replace('END:VEVENT', '')))).toThrow();
  expect(() => readCalendarExport(zipSync({ 'wrong.txt': strToU8('not a calendar') }))).toThrow();
  expect(() => readCalendarExport(archive(''))).toThrow();
  expect(() => canonicalSourceEvent({ ...sourceEvent(), attendees: 'unknown' })).toThrow();
  expect(() => canonicalSourceEvent({ ...sourceEvent(), rrule: { unknown: true } })).toThrow();
  expect(() => canonicalSourceEvent({
    ...sourceEvent(), dateandtime: { start: '20260720T090000', end: '20260720T093000' },
  })).toThrow(/timezone/);
});
