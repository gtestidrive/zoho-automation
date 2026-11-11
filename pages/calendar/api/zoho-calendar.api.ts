import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Page } from '@playwright/test';

export type ZohoCalendarSettings = {
  clientId: string;
  clientSecret: string;
  accountUrl: string;
  apiUrl: string;
  redirectUri: string;
  tokenPath: string;
};

type SavedToken = {
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
};

export type ZohoCalendar = {
  uid: string;
  name: string;
};

export type ZohoCalendarInventory = {
  calendars: ZohoCalendar[];
  events: ZohoCalendarEvent[];
};

export type ZohoCalendarEvent = {
  uid: string;
  calendarUid: string;
  calendarName: string;
  title: string;
  organizer: string;
  start: string;
};

export type CalendarDateRange = {
  start: Date;
  end: Date;
};

export type ZohoCalendarTestEvent = {
  title: string;
  start: string;
  attendeeEmail: string;
};

const calendarWindowMs = 30 * 24 * 60 * 60 * 1000;

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
}

function describeError(body: unknown): string {
  if (!isRecord(body)) {
    return 'The response did not contain an error description.';
  }
  if (typeof body.message === 'string') {
    return body.message;
  }
  if (typeof body.error === 'string') {
    return body.error;
  }
  return 'The response did not contain an error description.';
}

function recordsFrom(body: Record<string, unknown>, resource: string): Record<string, unknown>[] {
  const candidates = [body[resource], body.data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.every(isRecord)) {
      return candidate;
    }
    if (isRecord(candidate)) {
      const nested = candidate[resource];
      if (Array.isArray(nested) && nested.every(isRecord)) {
        return nested;
      }
      if (stringValue(candidate, ['uid', 'calendaruid', 'eventuid'])) {
        return [candidate];
      }
    }
  }
  throw new Error(
    `Zoho Calendar returned an invalid ${resource} response: ${describeError(body)} `
    + `(response keys: ${Object.keys(body).join(', ') || 'none'}).`,
  );
}

function nestedRecord(record: Record<string, unknown>, keys: string[]): Record<string, unknown> | undefined {
  for (const key of keys) {
    if (isRecord(record[key])) {
      return record[key] as Record<string, unknown>;
    }
  }
}

function parseCalendar(record: Record<string, unknown>): ZohoCalendar {
  const uid = stringValue(record, ['uid', 'calendaruid', 'calendarUid']);
  const name = stringValue(record, ['name', 'calendarname', 'calendarName', 'title']);
  if (!uid || !name) {
    throw new Error('Zoho Calendar returned a calendar without a UID or name.');
  }
  return { uid, name };
}

function parseEvent(record: Record<string, unknown>, calendar: ZohoCalendar): ZohoCalendarEvent {
  const dateAndTime = nestedRecord(record, ['dateandtime', 'dateAndTime', 'datetime']);
  const organizer = nestedRecord(record, ['organizer', 'organiser']);
  const uid = stringValue(record, ['uid', 'eventuid', 'eventUid', 'id']);
  const title = stringValue(record, ['title', 'eventtitle', 'eventTitle', 'name']);
  const start = (dateAndTime ? stringValue(dateAndTime, ['start', 'starttime', 'startTime']) : undefined)
    ?? stringValue(record, ['start', 'starttime', 'startTime']);
  const organizerName = organizer
    ? stringValue(organizer, ['email', 'emailid', 'emailId', 'name'])
    : stringValue(record, ['organizer', 'organiser']);
  if (!uid || !title || !start) {
    const dateTimeKeys = dateAndTime ? Object.keys(dateAndTime).join(', ') : 'none';
    const responseMessage = stringValue(record, ['message']) ?? 'none';
    throw new Error(
      `Zoho Calendar event fields were not recognized in calendar ${calendar.uid}. `
      + `Record keys: ${Object.keys(record).join(', ')}; date/time keys: ${dateTimeKeys}; message: ${responseMessage}.`,
    );
  }
  return {
    uid,
    calendarUid: calendar.uid,
    calendarName: calendar.name,
    title,
    organizer: organizerName ?? '',
    start,
  };
}

export function parseCalendarDate(value: string): Date {
  const compact = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z|[+-]\d{4}))?$/.exec(value.trim());
  if (compact) {
    const offset = compact[7] === 'Z'
      ? 'Z'
      : compact[7]
        ? `${compact[7].slice(0, 3)}:${compact[7].slice(3)}`
        : 'Z';
    const isoValue = `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4] ?? '00'}:${compact[5] ?? '00'}:${compact[6] ?? '00'}${offset}`;
    const parsed = new Date(isoValue);
    if (!Number.isFinite(parsed.getTime())) {
      throw new Error(`Could not parse Calendar date value "${value}".`);
    }
    return parsed;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Could not parse Calendar date value "${value}".`);
  }
  return parsed;
}

function apiDate(value: Date): string {
  return `${value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').replace(/Z$/, '')}Z`;
}

export class ZohoCalendarApi {
  private accessToken: string | undefined;

  constructor(private readonly settings: ZohoCalendarSettings) {}

  async authorize(page: Page, loginHint: string): Promise<void> {
    if (!this.settings.clientId || !this.settings.clientSecret) {
      throw new Error('Set ZOHO_CALENDAR_CLIENT_ID and ZOHO_CALENDAR_CLIENT_SECRET before setting up Calendar OAuth.');
    }
    const redirectUrl = new URL(this.settings.redirectUri);
    const port = Number(redirectUrl.port);
    if (redirectUrl.hostname !== 'localhost' || !port || redirectUrl.pathname !== '/oauth/callback') {
      throw new Error('ZOHO_CALENDAR_REDIRECT_URI must use http://localhost:<port>/oauth/callback.');
    }

    const state = randomBytes(32).toString('hex');
    let resolveCode!: (code: string) => void;
    let rejectCode!: (error: Error) => void;
    const authorizationCode = new Promise<string>((resolve, reject) => {
      resolveCode = resolve;
      rejectCode = reject;
    });
    const server: Server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', this.settings.redirectUri);
      if (requestUrl.pathname !== redirectUrl.pathname) {
        response.writeHead(404).end('Not found');
        return;
      }
      if (requestUrl.searchParams.get('state') !== state) {
        response.writeHead(400).end('OAuth state did not match. You can close this tab.');
        rejectCode(new Error('Zoho Calendar OAuth callback state did not match.'));
        return;
      }
      const oauthError = requestUrl.searchParams.get('error');
      if (oauthError) {
        response.writeHead(400).end('Zoho authorization was not completed. You can close this tab.');
        rejectCode(new Error(`Zoho Calendar OAuth authorization failed: ${oauthError}`));
        return;
      }
      const code = requestUrl.searchParams.get('code');
      if (!code) {
        response.writeHead(400).end('Authorization code was missing. You can close this tab.');
        rejectCode(new Error('Zoho Calendar OAuth callback did not include an authorization code.'));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
        .end('Zoho Calendar authorization received. Return to the Playwright test.');
      resolveCode(code);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, redirectUrl.hostname, resolve);
    });
    try {
      const authorizeUrl = new URL('/oauth/v2/auth', this.settings.accountUrl);
      authorizeUrl.search = new URLSearchParams({
        client_id: this.settings.clientId,
        response_type: 'code',
        scope: 'ZohoCalendar.calendar.READ,ZohoCalendar.event.READ,ZohoCalendar.event.CREATE',
        redirect_uri: this.settings.redirectUri,
        access_type: 'offline',
        prompt: 'consent',
        state,
        ...(loginHint ? { login_hint: loginHint } : {}),
      }).toString();
      log('[Zoho Calendar OAuth] Approve calendar and event read/create access in the browser.');
      await page.goto(authorizeUrl.toString(), { waitUntil: 'domcontentloaded' });

      const timeout = setTimeout(() => rejectCode(new Error('Zoho Calendar OAuth authorization timed out after 15 minutes.')), 15 * 60_000);
      let code: string;
      try {
        code = await authorizationCode;
      } finally {
        clearTimeout(timeout);
      }
      const tokenResponse = await this.requestToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.settings.redirectUri,
        client_id: this.settings.clientId,
        client_secret: this.settings.clientSecret,
      });
      if (typeof tokenResponse.refresh_token !== 'string') {
        throw new Error('Zoho Calendar OAuth did not return a refresh token; the existing token file was left unchanged.');
      }
      await mkdir(dirname(this.settings.tokenPath), { recursive: true });
      await writeFile(this.settings.tokenPath, `${JSON.stringify({
        refreshToken: tokenResponse.refresh_token,
        clientId: this.settings.clientId,
        clientSecret: this.settings.clientSecret,
      }, null, 2)}\n`, { mode: 0o600 });
      log(`[Zoho Calendar OAuth] Saved a refresh token to ${this.settings.tokenPath}.`);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  }

  async createTestEvent(attendeeEmail: string): Promise<ZohoCalendarTestEvent> {
    const normalizedAttendeeEmail = attendeeEmail.trim();
    if (!normalizedAttendeeEmail) {
      throw new Error('A Calendar test event attendee email is required.');
    }
    const calendars = await this.listCalendars();
    const calendar = calendars[0];
    if (!calendar) {
      throw new Error('Zoho Calendar did not return a calendar where a test event can be created.');
    }

    const startDate = new Date(Date.now() + 60 * 60_000);
    startDate.setUTCSeconds(0, 0);
    const endDate = new Date(startDate.getTime() + 30 * 60_000);
    const start = apiDate(startDate);
    const end = apiDate(endDate);
    const title = `Zoho automation calendar backup test ${new Date().toISOString()} ${randomBytes(4).toString('hex')}`;
    const url = new URL(
      `calendars/${encodeURIComponent(calendar.uid)}/events`,
      `${this.settings.apiUrl.replace(/\/+$/, '')}/`,
    );
    const eventData = {
      title,
      dateandtime: { timezone: 'UTC', start, end },
      isallday: false,
      attendees: [{ email: normalizedAttendeeEmail, permission: 1 }],
      notify_attendee: 1,
    };
    url.searchParams.set('eventdata', JSON.stringify(eventData));
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${await this.getAccessToken()}`,
      },
    });
    const body: unknown = await response.json();
    const statusCode = isRecord(body) && isRecord(body.status) ? Number(body.status.code) : 0;
    if (!response.ok || statusCode >= 400 || (isRecord(body) && typeof body.error === 'string')) {
      const scopeHint = response.status === 401
        ? ' Reauthorize Zoho Calendar and approve ZohoCalendar.event.CREATE, then retry.'
        : '';
      throw new Error(
        `Zoho Calendar test event creation failed (HTTP ${response.status}): ${describeError(body)}${scopeHint}`,
      );
    }
    if (!isRecord(body)) {
      throw new Error('Zoho Calendar returned an invalid response when creating the test event.');
    }

    log(`[Zoho Calendar API] Created test event "${title}" in "${calendar.name}" and invited ${normalizedAttendeeEmail}.`);
    return { title, start, attendeeEmail: normalizedAttendeeEmail };
  }

  async listCalendarInventory(start: Date, end: Date): Promise<ZohoCalendarInventory> {
    if (start.getTime() > end.getTime()) {
      throw new Error('Calendar scan start must be on or before its end.');
    }
    const calendars = await this.listCalendars();
    const eventsByKey = new Map<string, ZohoCalendarEvent>();
    log(`[Zoho Calendar API] Scanning ${calendars.length} calendars from ${start.toISOString()} through ${end.toISOString()}.`);

    for (const calendar of calendars) {
      for (let windowStart = start.getTime(); windowStart <= end.getTime(); windowStart += calendarWindowMs) {
        const windowEnd = Math.min(windowStart + calendarWindowMs, end.getTime() + 1000);
        const url = new URL(`calendars/${encodeURIComponent(calendar.uid)}/events`, `${this.settings.apiUrl.replace(/\/+$/, '')}/`);
        url.searchParams.set('range', JSON.stringify({
          start: apiDate(new Date(windowStart)),
          end: apiDate(new Date(windowEnd)),
        }));
        url.searchParams.set('byinstance', 'false');
        url.searchParams.set('timezone', 'UTC');
        const body = await this.getJson(url);
        const responseRecords = recordsFrom(body, 'events');
        const noEvents = (typeof body.message === 'string' && /no events found/i.test(body.message))
          || (responseRecords.length === 1
            && Object.keys(responseRecords[0]).every((key) => key === 'message')
            && /no events found/i.test(stringValue(responseRecords[0], ['message']) ?? ''));
        const records = noEvents ? [] : responseRecords;
        for (const record of records) {
          const event = parseEvent(record, calendar);
          eventsByKey.set(`${event.calendarUid}|${event.uid}|${event.start}`, event);
        }
        log(`[Zoho Calendar API] Calendar ${calendar.name}: ${records.length} events in window ${new Date(windowStart).toISOString().slice(0, 10)} to ${new Date(windowEnd).toISOString().slice(0, 10)}.`);
      }
    }

    const events = [...eventsByKey.values()];
    log(`[Zoho Calendar API] Source inventory contains ${events.length} event records across ${calendars.length} calendars (recurring events are not expanded into instances).`);
    return { calendars, events };
  }

  private async listCalendars(): Promise<ZohoCalendar[]> {
    const url = new URL('/api/v1/calendars', this.settings.apiUrl);
    url.searchParams.set('category', 'all');
    url.searchParams.set('showhiddencal', 'true');
    const records = recordsFrom(await this.getJson(url), 'calendars');
    return records.map(parseCalendar);
  }

  private async getJson(url: URL): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${await this.getAccessToken()}` },
    });
    const body: unknown = await response.json();
    if (!response.ok || (isRecord(body) && typeof body.error === 'string')) {
      throw new Error(`Zoho Calendar request failed (HTTP ${response.status}): ${describeError(body)}`);
    }
    if (!isRecord(body)) {
      throw new Error('Zoho Calendar returned an invalid response.');
    }
    return body;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }
    let token: SavedToken;
    try {
      const parsed: unknown = JSON.parse(await readFile(this.settings.tokenPath, 'utf8'));
      if (!isRecord(parsed)
        || (parsed.refreshToken !== undefined && typeof parsed.refreshToken !== 'string')
        || (parsed.clientId !== undefined && typeof parsed.clientId !== 'string')
        || (parsed.clientSecret !== undefined && typeof parsed.clientSecret !== 'string')) {
        throw new Error('Zoho Calendar token file has an invalid shape.');
      }
      token = parsed;
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') {
        throw new Error(`Zoho Calendar OAuth token not found at ${this.settings.tokenPath}. Run the Calendar OAuth setup test first.`);
      }
      throw error;
    }
    if (!token.refreshToken) {
      throw new Error(`Zoho Calendar token file at ${this.settings.tokenPath} does not contain a refresh token. Reauthorize Calendar access.`);
    }
    const clientId = token.clientId ?? this.settings.clientId;
    const clientSecret = token.clientSecret ?? this.settings.clientSecret;
    if (!clientId || !clientSecret) {
      throw new Error('Zoho Calendar OAuth client settings are missing; set ZOHO_CALENDAR_CLIENT_ID and ZOHO_CALENDAR_CLIENT_SECRET.');
    }
    const response = await this.requestToken({
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });
    if (typeof response.access_token !== 'string') {
      throw new Error('Zoho Calendar token refresh returned no access token.');
    }
    this.accessToken = response.access_token;
    return this.accessToken;
  }

  private async requestToken(parameters: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await fetch(new URL('/oauth/v2/token', this.settings.accountUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(parameters),
    });
    const body: unknown = await response.json();
    if (!response.ok || !isRecord(body) || typeof body.error === 'string') {
      throw new Error(`Zoho Calendar OAuth token request failed (HTTP ${response.status}): ${describeError(body)}`);
    }
    return body;
  }
}