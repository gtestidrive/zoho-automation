import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { exportLog } from '../../export/export-log';
import { parseCalendarDate } from '../api/zoho-calendar.api';
import type { CalendarSourceEvent, ExportedCalendarEvent, SelectedCalendarEvent } from './calendar-export.page';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.replace(/\r\n/g, '\n');
  if (record(value) && typeof value.val === 'string') return value.val.replace(/\r\n/g, '\n');
  throw new Error('Unsupported Calendar text field shape; refusing an incomplete checksum.');
}

function address(value: unknown): string {
  return text(value).replace(/^mailto:/i, '').trim().toLowerCase();
}

function rules(value: unknown): string {
  return text(value).replace(/^RRULE:/i, '').split(';').filter(Boolean)
    .map((part) => {
      const [key, values] = part.split('=');
      if (!key || !values) throw new Error(`Invalid Calendar recurrence rule component "${part}".`);
      return `${key.toUpperCase()}=${values.split(',').sort().join(',')}`;
    }).sort().join(';');
}

function stamp(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error('Calendar event has a missing or invalid date.');
  }
  return value.toISOString();
}

export function canonicalDownloadedEvent({ event, raw }: ExportedCalendarEvent) {
  const allDay = event.datetype === 'date';
  const dateOnly = (value: string): string => {
    if (!/^\d{8}$/.test(value)) throw new Error(`Invalid all-day iCalendar date "${value}".`);
    return parseCalendarDate(value).toISOString().slice(0, 10);
  };
  const date = (field: string, value: unknown): string => {
    if (!allDay) return stamp(value);
    const rawDate = new RegExp(`^${field}(?:;[^:]*)?:(.*)$`, 'mi').exec(raw)?.[1].trim();
    if (!rawDate) throw new Error(`All-day iCalendar event is missing ${field}.`);
    return dateOnly(rawDate);
  };
  const attendees: unknown[] = event.attendee === undefined
    ? [] : Array.isArray(event.attendee) ? event.attendee : [event.attendee];
  return {
    uid: event.uid, title: text(event.summary), organizer: address(event.organizer),
    start: date('DTSTART', event.start), end: date('DTEND', event.end), allDay,
    description: text(event.description), location: text(event.location),
    attendees: attendees.map(address).sort(),
    recurrence: rules(/^RRULE:(.*)$/mi.exec(raw)?.[1]),
    recurrenceId: event.recurrenceid ? date('RECURRENCE-ID', event.recurrenceid) : '',
    excludedDates: allDay
      ? [...raw.matchAll(/^EXDATE(?:;[^:]*)?:(.*)$/gmi)].flatMap((match) => match[1].trim().split(',').map(dateOnly)).sort()
      : Object.values(event.exdate ?? {}).map(stamp).sort(),
  };
}

export function canonicalSourceEvent(source: Record<string, unknown>) {
  if (!record(source.dateandtime) || typeof source.isallday !== 'boolean') {
    throw new Error('Zoho Calendar event lacks dateandtime or a boolean isallday field.');
  }
  const allDay = source.isallday;
  const date = (value: unknown): string => {
    const raw = text(value);
    if (!raw) throw new Error('Zoho Calendar event is missing a required date.');
    if (allDay) {
      const match = /^(\d{4})(\d{2})(\d{2})(?:T.*)?$/.exec(raw);
      if (!match) throw new Error(`Unrecognized all-day Calendar date "${raw}".`);
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
    if (!/(Z|[+-]\d{4})$/.test(raw)) {
      throw new Error(`Zoho Calendar date "${raw}" lacks an explicit timezone offset.`);
    }
    return parseCalendarDate(raw).toISOString();
  };
  if (source.attendees !== undefined && !Array.isArray(source.attendees)) {
    throw new Error('Zoho Calendar attendees field is not an array.');
  }
  const attendees: unknown[] = source.attendees ?? [];
  const excludedDates = source.exdate;
  if (excludedDates !== undefined && !Array.isArray(excludedDates)) {
    throw new Error('Unsupported Zoho Calendar exdate shape; cannot verify recurrence exclusions.');
  }
  return {
    uid: text(source.uid), title: text(source.title),
    organizer: address(record(source.organizer) ? source.organizer.email : source.organizer),
    start: date(source.dateandtime.start), end: date(source.dateandtime.end), allDay,
    description: text(source.description), location: text(source.location),
    attendees: attendees.map((attendee) => {
      if (!record(attendee) || typeof attendee.email !== 'string') {
        throw new Error('Zoho Calendar attendee is missing its email.');
      }
      return address(attendee.email);
    }).sort(),
    recurrence: rules(source.rrule),
    recurrenceId: source.recurrenceid ? date(source.recurrenceid) : '',
    excludedDates: (excludedDates ?? []).map(date).sort(),
  };
}

export function calendarEventChecksum(value: ReturnType<typeof canonicalDownloadedEvent>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function createdStamp(value: string): string {
  const parts = /^(\d{4})-?(\d{2})-?(\d{2})[ T](\d{2}):?(\d{2}):?(\d{2})(?:Z)?$/.exec(value.trim());
  if (!parts) throw new Error(`Unrecognized C2C/ICS creation timestamp "${value}".`);
  return parts.slice(1).join('');
}

export function calendarArchiveName(name: string): string {
  return name.replace(/\//g, '_');
}

export class CalendarExportAssertions {
  expectC2CMatches(selected: SelectedCalendarEvent[], downloaded: ExportedCalendarEvent[]): void {
    exportLog('Calendar export', 'Verification 1/2', `C2C selected=${selected.length}, downloaded events=${downloaded.length}.`);
    const remaining = [...downloaded];
    const results = selected.map((selectedEvent) => {
      const index = remaining.findIndex(({ calendarName, event, raw }) => {
        const created = /^CREATED(?:;[^:]*)?:(.*)\r?$/mi.exec(raw)?.[1].trim();
        const organizerName = record(event.organizer) && record(event.organizer.params)
          ? text(event.organizer.params.CN) : '';
        return calendarName === calendarArchiveName(selectedEvent.calendarName) && text(event.summary) === selectedEvent.title
          && (organizerName === selectedEvent.organizer || address(event.organizer) === address(selectedEvent.organizer))
          && created !== undefined && createdStamp(created) === createdStamp(selectedEvent.created);
      });
      const match = index < 0 ? undefined : remaining.splice(index, 1)[0];
      return {
        Calendar: selectedEvent.calendarName, C2CTitle: selectedEvent.title,
        C2COrganizer: selectedEvent.organizer, C2CCreated: selectedEvent.created,
        DownloadTitle: match ? text(match.event.summary) : '(missing/changed)',
        DownloadPath: match?.path, DownloadUID: match?.event.uid, Matches: Boolean(match)
      };
    });
    console.table(results);
    if (remaining.length) console.table(remaining.map(({ path, event }) => ({
      Problem: 'Extra/changed downloaded event', Path: path, UID: event.uid, Title: text(event.summary),
    })));
    expect(results.every(({ Matches }) => Matches) && remaining.length === 0,
      'Calendar ZIP must contain exactly the selected C2C names, organizer and creation timestamps.').toBe(true);
  }

  expectZohoMatches(sources: CalendarSourceEvent[]): void {
    exportLog('Calendar export', 'Verification 2/2',
      'Canonical UID/title/organizer/start/end/all-day/description/location/attendee-email/recurrence SHA-256 versus live Zoho. Not a raw ICS or attachment checksum.');
    let failures = 0;
    for (const { downloaded: downloadedEvent, source } of sources) {
      const { event, calendarName, path } = downloadedEvent;
      const exported = canonicalDownloadedEvent(downloadedEvent);
      const original = canonicalSourceEvent(source);
      const exportHash = calendarEventChecksum(exported);
      const sourceHash = calendarEventChecksum(original);
      console.table([{
        Calendar: calendarName, UID: event.uid, Title: exported.title, Path: path,
        ExportStart: exported.start, ZohoStart: original.start, ExportEnd: exported.end, ZohoEnd: original.end,
        ExportSHA256: exportHash, ZohoSHA256: sourceHash, Matches: exportHash === sourceHash
      }]);
      if (exportHash !== sourceHash) {
        failures++;
        const fields = Object.keys(exported) as Array<keyof typeof exported>;
        console.table(fields.filter((field) => JSON.stringify(exported[field]) !== JSON.stringify(original[field]))
          .map((field) => ({
            UID: event.uid, DifferentField: field,
            Download: field === 'description' || field === 'location' ? '(redacted)' : JSON.stringify(exported[field]),
            Zoho: field === 'description' || field === 'location' ? '(redacted)' : JSON.stringify(original[field])
          })));
      }
    }
    exportLog('Calendar export', 'Checksum result', `Matched=${sources.length - failures}, failed=${failures}.`);
    expect(failures, 'Calendar downloaded event data differs from live Zoho; checksum mismatch is a failure.').toBe(0);
  }
}
