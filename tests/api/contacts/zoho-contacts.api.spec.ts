import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ZohoContactsApi,
  zohoContactsChecksum,
  isCurrentContactsRestoreFolder,
  printZohoContacts,
} from '../../../pages/contacts/api/zoho-contacts.api';
import { testSettings } from '../../../test-settings';

test('lists Zoho Contacts with the separate read-only Contacts token', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zoho-contacts-test-'));
  const tokenPath = join(directory, 'oauth.json');
  await writeFile(tokenPath, JSON.stringify({
    refreshToken: 'test-refresh-token',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  }));
  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/oauth/v2/token') {
      return new Response(JSON.stringify({ access_token: 'test-access-token', expires_in: 3600 }));
    }
    expect(new Headers(init?.headers).get('Authorization')).toBe('Zoho-oauthtoken test-access-token');
    if (url.searchParams.get('fields') === 'count') {
      return new Response(JSON.stringify({ contacts: { contacts: 2, account_id: 'account-1' } }));
    }
    requests.push(url);
    expect(url.searchParams.get('include')).toBe('emails,phones,address,urls,ims,categories');
    const page = url.searchParams.get('page');
    return new Response(JSON.stringify(page === '1' ? {
      contacts: [{ contact_id: 'contact-1', first_name: 'Alex', last_name: 'Example' }],
      has_more: true,
    } : {
      contacts: [{ contact_id: 'contact-2', first_name: 'Jamie', last_name: 'Sample' }],
      has_more: false,
    }));
  };

  try {
    const api = new ZohoContactsApi({
      clientId: '',
      clientSecret: '',
      accountUrl: 'https://accounts.zoho.in',
      apiUrl: 'https://contacts.zoho.in/api/v1',
      redirectUri: 'http://localhost:43129/oauth/callback',
      tokenPath,
    });

    await expect(api.listContacts()).resolves.toEqual([
      { contact_id: 'contact-1', first_name: 'Alex', last_name: 'Example' },
      { contact_id: 'contact-2', first_name: 'Jamie', last_name: 'Sample' },
    ]);
    expect(requests).toHaveLength(2);
    expect(requests.map((url) => url.searchParams.get('page'))).toEqual(['1', '2']);
    expect(requests.every((url) => url.searchParams.get('per_page') === '100')).toBe(true);
    await expect(api.expectAccountEmail('alex@example.com')).resolves.toBeUndefined();
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      return new Response(JSON.stringify({
        contacts: { account_id: url.pathname.includes('/self/') ? 'account-1' : 'account-2' },
      }));
    };
    await expect(api.expectAccountEmail('other@example.com')).rejects.toThrow('does not match');
    globalThis.fetch = async (input) => {
      expect(new URL(String(input)).searchParams.get('fields')).toBe('count');
      return new Response(JSON.stringify({ contacts: { contacts: 0 } }));
    };
    await expect(api.listContacts()).resolves.toEqual([]);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('lists restore categories across pages and surfaces API-level failures', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'zoho-categories-test-'));
      const tokenPath = join(directory, 'oauth.json');
      await writeFile(tokenPath, JSON.stringify({
        refreshToken: 'test-refresh-token',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
      }));
      const originalFetch = globalThis.fetch;
      const categories = [
        { category_id: 'restore-1', category_name: '(IDrive Restore 2026-10-06 09;28;43 UTC)_All Contacts', count: 0 },
        { category_id: 'restore-2', category_name: 'Restored Contacts 2026-10-29 05:10', count: 2 },
      ];
      let mode: 'categories' | 'failure' | 'invalid' | 'mismatch' = 'categories';
      const pages: string[] = [];
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === '/oauth/v2/token') {
          return new Response(JSON.stringify({ access_token: 'test-access-token' }));
        }
        expect(new Headers(init?.headers).get('Authorization')).toBe('Zoho-oauthtoken test-access-token');
        if (mode === 'failure') {
          return new Response(JSON.stringify({ status_code: 404, errors: [{ resource: 'contacts' }] }));
        }
        if (url.pathname.endsWith('/contacts')) {
          expect(url.searchParams.get('filter_categories')).toBe('restore-2');
          expect(url.searchParams.get('include')).toBe('emails,phones,address,urls,ims,categories');
          const first = url.searchParams.get('page') === '1';
          return new Response(JSON.stringify({
            contacts: [{ contact_id: first ? 'contact-1' : 'contact-2' }],
            has_more: mode === 'mismatch' ? false : first,
          }));
        }
        expect(url.pathname).toBe('/api/v1/accounts/self/categories');
        expect(url.searchParams.get('include')).toBe('contacts.total_count');
        expect(url.searchParams.get('per_page')).toBe('100');
        if (mode === 'invalid') {
          return new Response(JSON.stringify({ categories: [{ category_id: 'invalid' }] }));
        }
        const page = url.searchParams.get('page') ?? '';
        pages.push(page);
        return new Response(JSON.stringify({
          categories: [categories[page === '1' ? 0 : 1]],
          has_more: page === '1',
        }));
      };
      try {
        const api = new ZohoContactsApi({
          clientId: '',
          clientSecret: '',
          accountUrl: 'https://accounts.zoho.in',
          apiUrl: 'https://contacts.zoho.in/api/v1',
          redirectUri: 'http://localhost:43129/oauth/callback',
          tokenPath,
        });

        await expect(api.listCategories()).resolves.toEqual(categories);
        expect(pages).toEqual(['1', '2']);
        await expect(api.listFolders()).resolves.toEqual([
          { ...categories[0], contacts: [] },
          { ...categories[1], contacts: [{ contact_id: 'contact-1' }, { contact_id: 'contact-2' }] },
        ]);
        mode = 'mismatch';
        await expect(api.listFolders()).rejects.toThrow('reports 2 contacts but returned 1');
        mode = 'failure';
        await expect(api.listContacts()).rejects.toThrow('API status 404');
        mode = 'invalid';
        await expect(api.listCategories()).rejects.toThrow('invalid ID or name');
      } finally {
        globalThis.fetch = originalFetch;
        await rm(directory, { recursive: true, force: true });
      }
});

test('compares restored contact content without generated IDs, timestamps, or category membership', () => {
          const source = [{
            contact_id: 'source', first_name: 'Alex', last_name: 'Example',
            emails: [{ email_id: 'alex@example.com', is_primary: true }],
            phones: [{ number: '123', type: 'mobile' }, { number: '456', type: 'work' }],
            notes: 'Keep these notes',
            categories: [{ category_id: 'old' }], created_time: 1,
          }];
          const restored = [{
            ...source[0], contact_id: 'new', created_time: 2,
            categories: [{ category_id: 'restored' }],
            phones: [...source[0].phones].reverse(),
          }];
          expect(zohoContactsChecksum(restored)).toBe(zohoContactsChecksum(source));
          expect(zohoContactsChecksum([{ ...restored[0], notes: 'Changed' }])).not.toBe(zohoContactsChecksum(source));
          expect(zohoContactsChecksum([{ ...restored[0], emails: [] }])).not.toBe(zohoContactsChecksum(source));
          expect(zohoContactsChecksum([...restored, ...restored])).not.toBe(zohoContactsChecksum(source));
        });

        test('requires a restore folder timestamp in the current UTC restore window', () => {
          const start = Date.parse('2026-10-29T05:10:45Z');
          const end = Date.parse('2026-10-29T05:12:30Z');
          expect(isCurrentContactsRestoreFolder('Restored Contacts 2026-10-29 05:10', start, end)).toBe(true);
          expect(isCurrentContactsRestoreFolder('Restored Contacts 2026-10-29 05:12', start, end)).toBe(true);
          expect(isCurrentContactsRestoreFolder('Restored Contacts 2026-10-29 05:09', start, end)).toBe(false);
          expect(isCurrentContactsRestoreFolder('Restored Contacts 2026-10-29 05:13', start, end)).toBe(false);
          expect(isCurrentContactsRestoreFolder('(IDrive Restore 2026-10-29 05;10;00 UTC)_My Contacts', start, end)).toBe(false);
          expect(isCurrentContactsRestoreFolder('Restored Contacts invalid', start, end)).toBe(false);
        });

test('prints contacts from the authorized Zoho Contacts account', { tag: '@zoho' }, async () => {
  test.skip(
    process.env.LIST_ZOHO_CONTACTS !== '1',
    'Opt in by setting LIST_ZOHO_CONTACTS=1 before listing live Zoho Contacts.',
  );

  const api = new ZohoContactsApi(testSettings.zohoContacts);
  const folders = await api.listFolders();
  console.log(`[Zoho Contacts] Found ${folders.length} folders using OAuth.`);
  console.table(folders.map((folder) => ({
    Folder: folder.category_name,
    Count: folder.count,
    ID: folder.category_id,
  })));
  for (const folder of folders) {
    printZohoContacts(folder.contacts, folder.category_name);
  }
  const contacts = await api.listContacts();
  printZohoContacts(contacts);
});

test('prints contact names, email addresses, phone numbers, and IDs', () => {
  const originalLog = console.log;
  const originalTable = console.table;
  const messages: unknown[][] = [];
  const tables: unknown[] = [];
  console.log = (...args: unknown[]) => { messages.push(args); };
  console.table = (data: unknown) => { tables.push(data); };
  try {
    printZohoContacts([
      {
        first_name: 'Alex',
        last_name: 'Example',
        emails: [{ email_id: 'alex@example.com' }],
        phones: [{ number: '1234567890' }],
        contact_id: 'contact-1',
      },
      { display_name: 'Jamie Example', email: 'jamie@example.com', phone_number: 123, id: 2 },
    ]);
    printZohoContacts([], 'Empty folder');

    expect(messages).toEqual([
      ['[Zoho Contacts] My Contacts: 2 contacts'],
      ['[Zoho Contacts] Empty folder: 0 contacts'],
    ]);
    expect(tables).toEqual([[
      { Folder: 'My Contacts', Name: 'Alex Example', Email: 'alex@example.com', Phone: '1234567890', ID: 'contact-1' },
      { Folder: 'My Contacts', Name: 'Jamie Example', Email: 'jamie@example.com', Phone: '123', ID: '2' },
    ], []]);
  } finally {
    console.log = originalLog;
    console.table = originalTable;
  }
});
