import { expect } from '@playwright/test';
import {
  parseCalendarDate,
  type CalendarDateRange,
  type ZohoCalendar,
  type ZohoCalendarEvent,
  type ZohoCalendarInventory,
  type ZohoCalendarTestEvent,
} from '../api/zoho-calendar.api';
import type { CalendarSnapshot } from './calendar-backup.page';

export type CalendarSnapshotEvent = Pick<ZohoCalendarEvent, 'calendarName' | 'title' | 'organizer' | 'start'>;

export type CalendarFolderComparison = {
  calendarName: string;
  zohoCalendarCount: number;
  c2cFolderCount: number;
  zohoEventCount: number;
  c2cEventCount: number;
  zohoOnly: ZohoCalendarEvent[];
  c2cOnly: CalendarSnapshotEvent[];
};

export function calendarComparisonRange(
  starts: string[],
  rangeStart: string,
  rangeEnd: string,
): CalendarDateRange {
  if (rangeStart || rangeEnd) {
    if (!rangeStart || !rangeEnd) {
      throw new Error('Set both ZOHO_CALENDAR_RANGE_START and ZOHO_CALENDAR_RANGE_END to override the comparison range.');
    }
    return inclusiveCalendarRange(rangeStart, rangeEnd);
  }
  if (starts.length === 0) {
    throw new Error('C2C Calendar snapshot is empty; provide explicit ZOHO_CALENDAR_RANGE_START and ZOHO_CALENDAR_RANGE_END values.');
  }

  const parsed = starts.map((value) => ({ value, time: parseCalendarDate(value).getTime() }));
  const earliest = parsed.reduce((result, current) => current.time < result.time ? current : result);
  const latest = parsed.reduce((result, current) => current.time > result.time ? current : result);
  return inclusiveCalendarRange(earliest.value, latest.value);
}

function inclusiveCalendarRange(startValue: string, endValue: string): CalendarDateRange {
  const start = parseCalendarDate(startValue);
  const end = parseCalendarDate(endValue);
  const hasTime = (value: string) => /(?:T\d{2}:?\d{2}|\b\d{1,2}:\d{2}\s*(?:AM|PM)?|T\d{6}Z)/i.test(value);
  if (!hasTime(startValue)) {
    start.setUTCHours(0, 0, 0, 0);
  }
  if (!hasTime(endValue)) {
    end.setUTCHours(23, 59, 59, 0);
  }
  return { start, end };
}

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function eventKey(event: Pick<CalendarSnapshotEvent, 'title' | 'start'>): string {
  return JSON.stringify([
    event.title.trim().replace(/\s+/g, ' ').toLowerCase(),
    parseCalendarDate(event.start).toISOString(),
  ]);
}

export function compareCalendarFolders(
  zohoCalendars: ZohoCalendar[],
  zohoEvents: ZohoCalendarEvent[],
  c2cFolderNames: string[],
  c2cEvents: CalendarSnapshotEvent[],
): CalendarFolderComparison[] {
  const keys = new Set([
    ...zohoCalendars.map(({ name }) => normalizedName(name)),
    ...zohoEvents.map(({ calendarName }) => normalizedName(calendarName)),
    ...c2cFolderNames.map(normalizedName),
    ...c2cEvents.map(({ calendarName }) => normalizedName(calendarName)),
  ]);
  const displayNames = new Map<string, string>();
  for (const name of [
    ...zohoCalendars.map(({ name }) => name),
    ...c2cFolderNames,
    ...zohoEvents.map(({ calendarName }) => calendarName),
    ...c2cEvents.map(({ calendarName }) => calendarName),
  ]) {
    const key = normalizedName(name);
    if (!displayNames.has(key)) {
      displayNames.set(key, name.trim());
    }
  }

  return [...keys].map((key) => {
    const sourceEvents = zohoEvents.filter((event) => normalizedName(event.calendarName) === key);
    const snapshotEvents = c2cEvents.filter((event) => normalizedName(event.calendarName) === key);
    const snapshotByKey = new Map<string, CalendarSnapshotEvent[]>();
    for (const event of snapshotEvents) {
      const eventMatchKey = eventKey(event);
      const matches = snapshotByKey.get(eventMatchKey) ?? [];
      matches.push(event);
      snapshotByKey.set(eventMatchKey, matches);
    }

    const consumedByKey = new Map<string, number>();
    const zohoOnly: ZohoCalendarEvent[] = [];
    for (const event of sourceEvents) {
      const eventMatchKey = eventKey(event);
      const matches = snapshotByKey.get(eventMatchKey) ?? [];
      const consumed = consumedByKey.get(eventMatchKey) ?? 0;
      if (consumed >= matches.length) {
        zohoOnly.push(event);
      } else {
        consumedByKey.set(eventMatchKey, consumed + 1);
      }
    }

    const c2cOnly = [...snapshotByKey].flatMap(([eventMatchKey, events]) =>
      events.slice(consumedByKey.get(eventMatchKey) ?? 0));
    return {
      calendarName: displayNames.get(key) ?? key,
      zohoCalendarCount: zohoCalendars.filter(({ name }) => normalizedName(name) === key).length,
      c2cFolderCount: c2cFolderNames.filter((name) => normalizedName(name) === key).length,
      zohoEventCount: sourceEvents.length,
      c2cEventCount: snapshotEvents.length,
      zohoOnly,
      c2cOnly,
    };
  }).sort((left, right) => left.calendarName.localeCompare(right.calendarName));
}

export class CalendarBackupAssertions {
  expectSnapshotMatchesNativeCalendar(
    inventory: ZohoCalendarInventory,
    snapshot: CalendarSnapshot,
    testEvent: ZohoCalendarTestEvent,
  ): void {
    expect(inventory.events.some((event) => event.title === testEvent.title),
      `The test event "${testEvent.title}" was not found in native Zoho Calendar.`).toBe(true);
    expect(snapshot.events.some((event) => event.title === testEvent.title),
      `The test event "${testEvent.title}" was not found in the C2C Calendar snapshot.`).toBe(true);

    const comparisons = compareCalendarFolders(
      inventory.calendars,
      inventory.events,
      snapshot.folderNames,
      snapshot.events,
    );
    console.table(comparisons.map((result) => ({
      Calendar: result.calendarName,
      ZohoCalendars: result.zohoCalendarCount,
      C2CFolders: result.c2cFolderCount,
      ZohoEvents: result.zohoEventCount,
      C2CEvents: result.c2cEventCount,
      ZohoOnly: result.zohoOnly.length,
      C2COnly: result.c2cOnly.length,
    })));
    const mismatches = comparisons.filter((result) =>
      result.zohoCalendarCount !== result.c2cFolderCount
      || result.zohoOnly.length > 0
      || result.c2cOnly.length > 0);
    expect(mismatches, 'Zoho Calendar and C2C event metadata differ.').toEqual([]);
  }
}
