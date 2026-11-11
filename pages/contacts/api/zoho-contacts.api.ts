import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Page } from '@playwright/test';

type ZohoContactsSettings = {
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

export type ZohoContact = Record<string, unknown>;

export type ZohoContactCategory = {
  category_id: string;
  category_name: string;
  count: number;
};

export type ZohoContactFolder = ZohoContactCategory & { contacts: ZohoContact[] };

const contactsPageSize = 100;
const contactContentFields = [
  'first_name', 'middle_name', 'last_name', 'gender', 'notes',
  'birth_day', 'birth_month', 'birth_year', 'company', 'job_title', 'designation',
  'emails', 'phones', 'address', 'urls', 'ims',
];

function normalizeContent(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeContent).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort()
      .filter((key) => !['id', 'contact_id', 'category_id'].includes(key))
      .map((key) => [key, normalizeContent(value[key])])
      .filter(([, item]) => item !== undefined && item !== null && item !== ''));
  }
  return value;
}

export function zohoContactsChecksum(contacts: ZohoContact[]): string {
  const records = contacts.map((contact) => JSON.stringify(normalizeContent(
    Object.fromEntries(contactContentFields.map((key) => [key, contact[key]])),
  ))).sort();
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
}

export function zohoContactSummary(contact: ZohoContact): { name: string; email: string; phone: string } {
  const nestedText = (value: unknown, key: string): string => {
    if (!Array.isArray(value) || !value.every(isRecord)) {
      return '';
    }
    const primary = value.find((item) => item.is_primary === true) ?? value[0];
    return typeof primary?.[key] === 'string' ? primary[key] : '';
  };
  return {
    name: ['first_name', 'middle_name', 'last_name']
      .map((key) => typeof contact[key] === 'string' ? contact[key] : '').filter(Boolean).join(' '),
    email: nestedText(contact.emails, 'email_id'),
    phone: nestedText(contact.phones, 'number'),
  };
}

export function isCurrentContactsRestoreFolder(name: string, startedAt: number, completedAt: number): boolean {
  const match = /^Restored Contacts (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(name);
  if (!match) {
    return false;
  }
  const timestamp = Date.parse(`${match[1]}T${match[2]}:00Z`);
  return Number.isFinite(timestamp)
    && timestamp >= Math.floor(startedAt / 60_000) * 60_000
    && timestamp <= completedAt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function printZohoContacts(contacts: ZohoContact[], folder = 'My Contacts'): void {
  const text = (value: unknown): string =>
    typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const firstNestedText = (value: unknown, key: string): string => {
    if (!Array.isArray(value)) {
      return '';
    }
    for (const item of value) {
      if (isRecord(item)) {
        const result = text(item[key]);
        if (result) {
          return result;
        }
      }
    }
    return '';
  };

  console.log(`[Zoho Contacts] ${folder}: ${contacts.length} contacts`);
  console.table(contacts.map((contact) => ({
    Folder: folder,
    Name: [
      text(contact.first_name ?? contact.firstName),
      text(contact.last_name ?? contact.lastName),
    ].filter(Boolean).join(' ') || text(contact.full_name ?? contact.display_name ?? contact.name),
    Email: text(contact.email ?? contact.email_id) || firstNestedText(contact.emails, 'email_id'),
    Phone: text(contact.phone ?? contact.phone_number) || firstNestedText(contact.phones, 'number'),
    ID: text(contact.contact_id ?? contact.contactId ?? contact.id),
  })));
}

function isSavedToken(value: unknown): value is SavedToken {
  return isRecord(value)
    && (value.refreshToken === undefined || typeof value.refreshToken === 'string')
    && (value.clientId === undefined || typeof value.clientId === 'string')
    && (value.clientSecret === undefined || typeof value.clientSecret === 'string');
}

function describeError(body: unknown): string {
  if (isRecord(body)) {
    if (typeof body.message === 'string') {
      return body.message;
    }
    if (typeof body.error === 'string') {
      return body.error;
    }
    if (Array.isArray(body.errors) && isRecord(body.errors[0])) {
      const firstError = body.errors[0];
      if (typeof firstError.message === 'string') {
        return firstError.message;
      }
      if (typeof firstError.error === 'string') {
        return firstError.error;
      }
      if (typeof firstError.code === 'string') {
        return firstError.code;
      }
    }
    if (Array.isArray(body.contacts) && isRecord(body.contacts[0])) {
      const firstContact = body.contacts[0];
      const code = typeof firstContact.code === 'string' ? firstContact.code : '';
      const message = typeof firstContact.message === 'string' ? firstContact.message : '';
      if (code || message) {
        return [code, message].filter(Boolean).join(': ');
      }
    }
    if (typeof body.status_code === 'number') {
      return `API status ${body.status_code}.`;
    }
  }
  return 'The response did not contain an error description.';
}

export class ZohoContactsApi {
  private accessToken: string | undefined;

  constructor(private readonly settings: ZohoContactsSettings) {}

  async authorize(page: Page): Promise<void> {
    if (!this.settings.clientId || !this.settings.clientSecret) {
      throw new Error('Set ZOHO_CONTACTS_CLIENT_ID and ZOHO_CONTACTS_CLIENT_SECRET before setting up Zoho Contacts OAuth.');
    }

    const redirectUrl = new URL(this.settings.redirectUri);
    const port = Number(redirectUrl.port);
    if (redirectUrl.hostname !== 'localhost' || !port || redirectUrl.pathname !== '/oauth/callback') {
      throw new Error('ZOHO_CONTACTS_REDIRECT_URI must use http://localhost:<port>/oauth/callback.');
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
        rejectCode(new Error('Zoho Contacts OAuth callback state did not match.'));
        return;
      }
      const oauthError = requestUrl.searchParams.get('error');
      if (oauthError) {
        response.writeHead(400).end('Zoho authorization was not completed. You can close this tab.');
        rejectCode(new Error(`Zoho Contacts OAuth authorization failed: ${oauthError}`));
        return;
      }
      const code = requestUrl.searchParams.get('code');
      if (!code) {
        response.writeHead(400).end('Authorization code was missing. You can close this tab.');
        rejectCode(new Error('Zoho Contacts OAuth callback did not include an authorization code.'));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
        .end('Zoho Contacts authorization received. Return to the Playwright test.');
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
        scope: 'zohocontacts.contactapi.READ',
        redirect_uri: this.settings.redirectUri,
        access_type: 'offline',
        prompt: 'consent',
        state,
      }).toString();
      console.log('[Zoho Contacts OAuth] Sign in and approve Contacts read and create access in the browser.');
      await page.goto(authorizeUrl.toString(), { waitUntil: 'domcontentloaded' });

      const timeout = setTimeout(() => {
        rejectCode(new Error('Zoho Contacts OAuth authorization timed out after 15 minutes.'));
      }, 15 * 60_000);
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
        throw new Error('Zoho Contacts OAuth did not return a refresh token; the existing token file was left unchanged.');
      }
      await mkdir(dirname(this.settings.tokenPath), { recursive: true });
      await writeFile(this.settings.tokenPath, `${JSON.stringify({
        refreshToken: tokenResponse.refresh_token,
        clientId: this.settings.clientId,
        clientSecret: this.settings.clientSecret,
      }, null, 2)}\n`, { mode: 0o600 });
      console.log(`[Zoho Contacts OAuth] Saved a refresh token to ${this.settings.tokenPath}.`);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  }

  async listContacts(): Promise<ZohoContact[]> {
    const url = new URL('accounts/self/contacts', `${this.settings.apiUrl.replace(/\/+$/, '')}/`);
    url.searchParams.set('fields', 'count');
    const body = await this.getJson(url);
    if (!isRecord(body.contacts) || typeof body.contacts.contacts !== 'number'
      || !Number.isSafeInteger(body.contacts.contacts) || body.contacts.contacts < 0) {
      throw new Error('Zoho Contacts returned an invalid contact count.');
    }
    if (body.contacts.contacts === 0) {
      return [];
    }
    return this.listRecords('contacts');
  }

  async expectAccountEmail(email: string): Promise<void> {
    const accounts = [];
    for (const account of ['self', encodeURIComponent(email)]) {
      const url = new URL(`accounts/${account}/contacts`, `${this.settings.apiUrl.replace(/\/+$/, '')}/`);
      url.searchParams.set('fields', 'count');
      const body = await this.getJson(url);
      if (!isRecord(body.contacts) || typeof body.contacts.account_id !== 'string'
        || !body.contacts.account_id) {
        throw new Error(`Zoho Contacts could not verify the account for ${email}.`);
      }
      accounts.push(body.contacts.account_id);
    }
    if (accounts[0] !== accounts[1]) {
      throw new Error(`Zoho Contacts OAuth account does not match the C2C user ${email}. Reauthorize with the correct account.`);
    }
  }

  async listCategories(): Promise<ZohoContactCategory[]> {
    const categories = await this.listRecords('categories', { include: 'contacts.total_count' });
    return categories.map((category) => {
      if (typeof category.category_id !== 'string' || !category.category_id
        || typeof category.category_name !== 'string' || !category.category_name) {
        throw new Error('Zoho Contacts returned a category with an invalid ID or name.');
      }
      const count = category.count ?? category.contacts_count;
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
        throw new Error(`Zoho Contacts returned an invalid count for category ${category.category_name}.`);
      }
      return { category_id: category.category_id, category_name: category.category_name, count };
    });
  }

  async listFolders(): Promise<ZohoContactFolder[]> {
    const folders: ZohoContactFolder[] = [];
    for (const category of await this.listCategories()) {
      const contacts = await this.listCategoryContacts(category);
      if (contacts.length !== category.count) {
        throw new Error(`Zoho Contacts category "${category.category_name}" reports ${category.count} contacts but returned ${contacts.length}. Retry if contacts changed during listing.`);
      }
      folders.push({ ...category, contacts });
    }
    return folders;
  }

  async listCategoryContacts(category: ZohoContactCategory): Promise<ZohoContact[]> {
    if (category.count === 0) {
      return [];
    }
    return this.listRecords('contacts', { filter_categories: category.category_id });
  }

  private async getJson(url: URL): Promise<Record<string, unknown>> {
    const accessToken = await this.getAccessToken();
    const response = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    const body: unknown = await response.json();
    if (!response.ok || (isRecord(body) && (
      (typeof body.status_code === 'number' && body.status_code >= 400)
      || (Array.isArray(body.errors) && body.errors.length > 0)
    ))) {
      throw new Error(`Zoho Contacts request failed (HTTP ${response.status}): ${describeError(body)}`);
    }
    if (!isRecord(body)) {
      throw new Error('Zoho Contacts returned an invalid response.');
    }
    return body;
  }

  private async listRecords(
    resource: 'contacts' | 'categories',
    parameters: Record<string, string> = {},
  ): Promise<Record<string, unknown>[]> {
    const url = new URL(`accounts/self/${resource}`, `${this.settings.apiUrl.replace(/\/+$/, '')}/`);
    if (resource === 'contacts') {
      url.searchParams.set('include', 'emails,phones,address,urls,ims,categories');
    }
    for (const [key, value] of Object.entries(parameters)) {
      url.searchParams.set(key, value);
    }
    const contacts: ZohoContact[] = [];
    let page = 1;

    for (;;) {
      const pageUrl = new URL(url);
      pageUrl.searchParams.set('per_page', String(contactsPageSize));
      pageUrl.searchParams.set('page', String(page));

      const body = await this.getJson(pageUrl);
      const records = body[resource];
      if (!Array.isArray(records) || !records.every(isRecord)) {
        throw new Error(`Zoho Contacts returned an invalid ${resource} response.`);
      }
      if (body.has_more !== undefined && typeof body.has_more !== 'boolean') {
        throw new Error('Zoho Contacts returned an invalid has_more value.');
      }

      contacts.push(...records);
      if (body.has_more !== true) {
        return contacts;
      }
      if (records.length === 0) {
        throw new Error(`Zoho Contacts reports more records after an empty page (${page}).`);
      }
      page += 1;
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }

    let token: SavedToken;
    try {
      const parsed: unknown = JSON.parse(await readFile(this.settings.tokenPath, 'utf8'));
      if (!isSavedToken(parsed)) {
        throw new Error('Zoho Contacts token file has an invalid shape.');
      }
      token = parsed;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error(`Zoho Contacts OAuth token not found at ${this.settings.tokenPath}. Run the Zoho Contacts OAuth setup test first.`);
      }
      throw error;
    }
    if (!token.refreshToken) {
      throw new Error(`Zoho Contacts token file at ${this.settings.tokenPath} does not contain a refresh token. Reauthorize the Contacts integration.`);
    }

    const clientId = token.clientId ?? this.settings.clientId;
    const clientSecret = token.clientSecret ?? this.settings.clientSecret;
    if (!clientId || !clientSecret) {
      throw new Error('Zoho Contacts OAuth client settings are missing; set ZOHO_CONTACTS_CLIENT_ID and ZOHO_CONTACTS_CLIENT_SECRET.');
    }
    const response = await this.requestToken({
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });
    if (typeof response.access_token !== 'string') {
      throw new Error(`Zoho Contacts token refresh returned no access token (${Object.keys(response).join(', ')}).`);
    }
    this.accessToken = response.access_token;
    return response.access_token;
  }

  private async requestToken(parameters: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await fetch(new URL('/oauth/v2/token', this.settings.accountUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(parameters),
    });
    const body: unknown = await response.json();
    if (!response.ok || !isRecord(body) || typeof body.error === 'string') {
      throw new Error(`Zoho Contacts OAuth token request failed (HTTP ${response.status}): ${describeError(body)}`);
    }
    return body;
  }
}
