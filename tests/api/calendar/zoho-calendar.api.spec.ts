import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZohoCalendarApi } from '../../../pages/calendar/api/zoho-calendar.api';

test('requests Calendar event records without expanding recurring instances and uses UTC range values', async () => {
  const tokenDirectory = await mkdtemp(join(tmpdir(), 'zoho-calendar-api-'));
  const tokenPath = join(tokenDirectory, 'token.json');
  await writeFile(tokenPath, JSON.stringify({ refreshToken: 'test-refresh-token' }), 'utf8');

  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = input instanceof URL
      ? input
      : new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname === '/oauth/v2/token') {
      return Response.json({ access_token: 'test-access-token' });
    }
    requests.push(url);
    if (url.pathname === '/api/v1/calendars') {
      return Response.json({ calendars: [{ uid: 'calendar-uid', name: 'Ajay' }] });
    }
    return Response.json({
      events: [{
        uid: 'event-uid',
        title: 'Weekly event',
        start: '20261102T043000',
        dateandtime: {
          timezone: 'Asia/Calcutta',
          start: '20261102T100000+0530',
        },
      }],
    });
  };

  try {
    const api = new ZohoCalendarApi({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      accountUrl: 'https://accounts.zoho.in',
      apiUrl: 'https://calendar.zoho.in/api/v1',
      redirectUri: 'http://localhost:43132/oauth/callback',
      tokenPath,
    });
    const result = await api.listCalendarInventory(
      new Date('2026-11-02T00:00:00.000Z'),
      new Date('2026-11-02T23:59:59.000Z'),
    );

    expect(requests).toHaveLength(2);
    expect(requests[0].origin).toBe('https://calendar.zoho.in');
    expect(requests[0].pathname).toBe('/api/v1/calendars');
    expect(requests[0].searchParams.get('category')).toBe('all');
    expect(requests[0].searchParams.get('showhiddencal')).toBe('true');
    expect(requests[1].pathname).toBe('/api/v1/calendars/calendar-uid/events');
    expect(requests[1].searchParams.get('byinstance')).toBe('false');
    expect(JSON.parse(requests[1].searchParams.get('range') ?? '{}')).toEqual({
      start: '20261102T000000Z',
      end: '20261103T000000Z',
    });
    expect(result.events[0].start).toBe('20261102T100000+0530');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tokenDirectory, { recursive: true, force: true });
  }
});

test('includes events at window boundaries and at the requested end', async () => {
  const tokenDirectory = await mkdtemp(join(tmpdir(), 'zoho-calendar-boundary-'));
  const tokenPath = join(tokenDirectory, 'token.json');
  await writeFile(tokenPath, JSON.stringify({ refreshToken: 'test-refresh-token' }), 'utf8');
  const requests: Array<{ start: string; end: string }> = [];
  const events = [
    { uid: 'before', title: 'Before boundary', start: '20260131T095959Z' },
    { uid: 'boundary', title: 'At boundary', start: '20260131T100000Z' },
    { uid: 'end', title: 'At end', start: '20260131T100001Z' },
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname === '/oauth/v2/token') {
      return Response.json({ access_token: 'test-access-token' });
    }
    if (url.pathname === '/api/v1/calendars') {
      return Response.json({ calendars: [{ uid: 'calendar-uid', name: 'Test' }] });
    }
    const range = JSON.parse(url.searchParams.get('range') ?? '{}') as { start: string; end: string };
    requests.push(range);
    return Response.json({ events: events.filter((event) => event.start >= range.start && event.start < range.end) });
  };

  try {
    const api = new ZohoCalendarApi({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      accountUrl: 'https://accounts.zoho.in',
      apiUrl: 'https://calendar.zoho.in/api/v1',
      redirectUri: 'http://localhost:43132/oauth/callback',
      tokenPath,
    });
    const inventory = await api.listCalendarInventory(
      new Date('2026-01-01T10:00:00Z'),
      new Date('2026-01-31T10:00:01Z'),
    );
    expect(requests).toEqual([
      { start: '20260101T100000Z', end: '20260131T100000Z' },
      { start: '20260131T100000Z', end: '20260131T100002Z' },
    ]);
    expect(inventory.events.map((event) => event.uid)).toEqual(['before', 'boundary', 'end']);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tokenDirectory, { recursive: true, force: true });
  }
});

test('creates a uniquely named test event in the first native calendar', async () => {
  const tokenDirectory = await mkdtemp(join(tmpdir(), 'zoho-calendar-create-api-'));
  const tokenPath = join(tokenDirectory, 'token.json');
  await writeFile(tokenPath, JSON.stringify({ refreshToken: 'test-refresh-token' }), 'utf8');

  const originalFetch = globalThis.fetch;
  let createRequest: { url: URL; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof URL
      ? input
      : new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname === '/oauth/v2/token') {
      return Response.json({ access_token: 'test-access-token' });
    }
    if (url.pathname === '/api/v1/calendars') {
      return Response.json({ calendars: [{ uid: 'calendar-uid', name: 'Ajay' }] });
    }
    createRequest = { url, init };
    return Response.json({ status: { code: 200, description: 'success' } });
  };

  try {
    const api = new ZohoCalendarApi({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      accountUrl: 'https://accounts.zoho.in',
      apiUrl: 'https://calendar.zoho.in/api/v1',
      redirectUri: 'http://localhost:43132/oauth/callback',
      tokenPath,
    });
    const result = await api.createTestEvent('ajay@idriveedge.com');
    const eventData = createRequest?.url.searchParams.get('eventdata');
    expect(eventData).toBeTruthy();
    const requestBody = JSON.parse(eventData ?? '') as {
      title: string;
      dateandtime: { timezone: string; start: string; end: string };
      isallday: boolean;
      attendees: Array<{ email: string; permission: number }>;
      notify_attendee: number;
    };

    expect(createRequest?.url.pathname).toBe('/api/v1/calendars/calendar-uid/events');
    expect(createRequest?.init?.method).toBe('POST');
    expect(requestBody.title).toMatch(/^Zoho automation calendar backup test /);
    expect(requestBody.dateandtime.timezone).toBe('UTC');
    expect(requestBody.dateandtime.start).toBe(result.start);
    expect(requestBody.dateandtime.end).toBeTruthy();
    expect(requestBody.isallday).toBe(false);
    expect(requestBody.attendees).toEqual([{ email: 'ajay@idriveedge.com', permission: 1 }]);
    expect(requestBody.notify_attendee).toBe(1);
    expect(result.title).toBe(requestBody.title);
    expect(result.attendeeEmail).toBe('ajay@idriveedge.com');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tokenDirectory, { recursive: true, force: true });
  }
});
