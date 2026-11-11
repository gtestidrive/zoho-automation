import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Page } from '@playwright/test';

export type ZohoMailSettings = {
  testRecipientEmail: string;
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

export type ZohoMailMessage = {
  from: string;
  to: string;
  subject: string;
  size: string;
};

export type ZohoMailFolder = {
  id: string;
  name: string;
  path: string;
  messages: ZohoMailMessage[];
};

export type ZohoMailAccount = {
  id: string;
  email: string;
};

const mailPageSize = 200;

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
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
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
  if (isRecord(body.status) && typeof body.status.description === 'string') {
    return body.status.description;
  }
  return 'The response did not contain an error description.';
}

function recordsFrom(body: Record<string, unknown>, resource: string): Record<string, unknown>[] {
  // Zoho responses may wrap collections in `data` or expose them at the top level.
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
      if (stringValue(candidate, ['accountId', 'folderId', 'messageId'])) {
        return [candidate];
      }
    }
  }
  throw new Error(`Zoho Mail returned an invalid ${resource} response.`);
}

function addressText(value: unknown): string {
  const values = Array.isArray(value) ? value : [value];
  const addresses = values.flatMap((item) => {
    if (typeof item === 'string') {
      const emails = item.match(/[^\s<,;]+@[^\s>,;]+/g);
      return emails?.map((address) => address.trim()) ?? item.split(/[;,]/).map((part) => part.trim()).filter(Boolean);
    }
    if (isRecord(item)) {
      const address = stringValue(item, ['emailAddress', 'email', 'address', 'mailId']);
      return address ? [address] : [];
    }
    return [];
  });
  return addresses.map((address) => address.toLowerCase()).sort().join(',');
}

export function normalizeMailSize(value: string): string {
  const match = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i.exec(value.trim());
  if (!match) {
    return value.trim().toLowerCase();
  }
  const units = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 } as const;
  const unit = (match[2]?.toUpperCase() ?? 'B') as keyof typeof units;
  const bytes = Number(match[1]) * units[unit];
  return `${(bytes / 1024).toFixed(1)}kb`;
}

function messageFrom(record: Record<string, unknown>): ZohoMailMessage {
  const from = addressText(record.fromAddress ?? record.from);
  const to = addressText(record.toAddress ?? record.to);
  const subject = stringValue(record, ['subject']) ?? '';
  const size = normalizeMailSize(stringValue(record, ['size', 'messageSize']) ?? '');
  if (!subject && !from && !to && !size) {
    throw new Error('Zoho Mail returned a message without readable metadata.');
  }
  return { from, to, subject, size };
}

function folderPaths(folders: Array<{ id: string; name: string; parentId?: string }>): Map<string, string> {
  // Build stable paths so nested folders can be compared independently of Zoho IDs.
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const paths = new Map<string, string>();
  const resolve = (id: string, visiting = new Set<string>()): string => {
    const cached = paths.get(id);
    if (cached) {
      return cached;
    }
    const folder = byId.get(id);
    if (!folder || visiting.has(id)) {
      throw new Error(`Zoho Mail returned an invalid or cyclic folder parent for ${id}.`);
    }
    visiting.add(id);
    const parent = folder.parentId && byId.has(folder.parentId)
      ? `${resolve(folder.parentId, visiting)}\\`
      : '';
    visiting.delete(id);
    const path = `${parent}${folder.name}`;
    paths.set(id, path);
    return path;
  };
  for (const folder of folders) {
    resolve(folder.id);
  }
  return paths;
}

export class ZohoMailApi {
  private accessToken: string | undefined;
  private readonly accounts = new Map<string, ZohoMailAccount>();

  constructor(private readonly settings: ZohoMailSettings) {}

  async authorize(page: Page): Promise<void> {
    if (!this.settings.clientId || !this.settings.clientSecret) {
      throw new Error('Set ZOHO_MAIL_CLIENT_ID and ZOHO_MAIL_CLIENT_SECRET before setting up Zoho Mail OAuth.');
    }
    const redirectUrl = new URL(this.settings.redirectUri);
    const port = Number(redirectUrl.port);
    if (redirectUrl.hostname !== 'localhost' || !port || redirectUrl.pathname !== '/oauth/callback') {
      throw new Error('ZOHO_MAIL_REDIRECT_URI must use http://localhost:<port>/oauth/callback.');
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
        rejectCode(new Error('Zoho Mail OAuth callback state did not match.'));
        return;
      }
      const oauthError = requestUrl.searchParams.get('error');
      if (oauthError) {
        response.writeHead(400).end('Zoho authorization was not completed. You can close this tab.');
        rejectCode(new Error(`Zoho Mail OAuth authorization failed: ${oauthError}`));
        return;
      }
      const code = requestUrl.searchParams.get('code');
      if (!code) {
        response.writeHead(400).end('Authorization code was missing. You can close this tab.');
        rejectCode(new Error('Zoho Mail OAuth callback did not include an authorization code.'));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
        .end('Zoho Mail authorization received. Return to the Playwright test.');
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
        scope: 'ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.READ,ZohoMail.messages.CREATE',
        redirect_uri: this.settings.redirectUri,
        access_type: 'offline',
        prompt: 'consent',
        state,
      }).toString();
      console.log('[Zoho Mail OAuth] Approve account, folder, message read, and message create access in the browser.');
      await page.goto(authorizeUrl.toString(), { waitUntil: 'domcontentloaded' });

      const timeout = setTimeout(() => {
        rejectCode(new Error('Zoho Mail OAuth authorization timed out after 15 minutes.'));
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
        throw new Error('Zoho Mail OAuth did not return a refresh token; the existing token file was left unchanged.');
      }
      await mkdir(dirname(this.settings.tokenPath), { recursive: true });
      await writeFile(this.settings.tokenPath, `${JSON.stringify({
        refreshToken: tokenResponse.refresh_token,
        clientId: this.settings.clientId,
        clientSecret: this.settings.clientSecret,
      }, null, 2)}\n`, { mode: 0o600 });
      console.log(`[Zoho Mail OAuth] Saved a refresh token to ${this.settings.tokenPath}.`);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  }

  async getAccount(email: string): Promise<ZohoMailAccount> {
    const cached = this.accounts.get(email.toLowerCase());
    if (cached) {
      return cached;
    }
    const body = await this.getJson(new URL('/api/accounts', this.settings.apiUrl));
    const accounts = recordsFrom(body, 'data');
    const account = accounts.find((item) =>
      stringValue(item, ['primaryEmailAddress', 'emailAddress', 'email'])?.toLowerCase() === email.toLowerCase());
    if (!account) {
      throw new Error(`Zoho Mail OAuth account does not contain ${email}.`);
    }
    const id = stringValue(account, ['accountId', 'accountid', 'id']);
    const address = stringValue(account, ['primaryEmailAddress', 'emailAddress', 'email']);
    if (!id || !address) {
      throw new Error('Zoho Mail returned an account without an ID or email address.');
    }
    const result = { id, email: address };
    this.accounts.set(email.toLowerCase(), result);
    return result;
  }

  async sendTestMessageTo(email: string, recipientEmail: string): Promise<{ subject: string }> {
    const account = await this.getAccount(email);
    const subject = `Zoho automation backup test ${new Date().toISOString()} ${randomBytes(4).toString('hex')}`;
    const response = await fetch(this.accountUrl(account.id, 'messages'), {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${await this.getAccessToken()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        fromAddress: account.email,
        toAddress: recipientEmail,
        subject,
        content: `Automated Zoho Mail backup test sent to ${recipientEmail}.`,
        mailFormat: 'plaintext',
        isSchedule: false,
      }),
    });
    const body: unknown = await response.json();
    const statusCode = isRecord(body) && isRecord(body.status) ? Number(body.status.code) : 0;
    if (!response.ok || statusCode >= 400) {
      const scopeHint = response.status === 401
        ? ' Reauthorize Zoho Mail and approve ZohoMail.messages.CREATE, then retry.'
        : '';
      throw new Error(
        `Zoho Mail test message send failed (HTTP ${response.status}): ${describeError(body)}${scopeHint}`,
      );
    }
    if (!isRecord(body)) {
      throw new Error('Zoho Mail returned an invalid response when sending the test message.');
    }

    log(`[Zoho Mail API] Sent test message "${subject}" from ${account.email} to ${recipientEmail}.`);
    return { subject };
  }

  async listFoldersAndMessages(email: string): Promise<ZohoMailFolder[]> {
    const account = await this.getAccount(email);
    log('[Zoho Mail API] Listing folders and message metadata.');
    const foldersBody = await this.getJson(this.accountUrl(account.id, 'folders'));
    const folderRecords = recordsFrom(foldersBody, 'data').map((record) => {
      const id = stringValue(record, ['folderId', 'folderid', 'id']);
      const name = stringValue(record, ['folderName', 'foldername', 'name']);
      if (!id || !name) {
        throw new Error('Zoho Mail returned a folder without an ID or name.');
      }
      return {
        id,
        name,
        parentId: stringValue(record, ['parentFolderId', 'parentfolderid', 'parentId']),
      };
    });
    const paths = folderPaths(folderRecords);
    const folders: ZohoMailFolder[] = [];
    for (const [index, folder] of folderRecords.entries()) {
      const messages = await this.listMessages(account.id, folder.id);
      folders.push({
        id: folder.id,
        name: folder.name,
        path: paths.get(folder.id)!,
        messages,
      });
      log(`[Zoho Mail API] Read folder ${index + 1}/${folderRecords.length}: ${messages.length} message records.`);
    }
    log(`[Zoho Mail API] Source inventory contains ${folders.length} folders and ${folders.reduce((count, folder) => count + folder.messages.length, 0)} messages.`);
    return folders;
  }

  private async listMessages(accountId: string, folderId: string): Promise<ZohoMailMessage[]> {
    const messages: ZohoMailMessage[] = [];
    // Zoho Mail uses a 1-based start index and accepts at most 200 records per page.
    for (let start = 1; ; start += mailPageSize) {
      const url = this.accountUrl(accountId, 'messages/view');
      url.searchParams.set('folderId', folderId);
      url.searchParams.set('start', String(start));
      url.searchParams.set('limit', String(mailPageSize));
      url.searchParams.set('status', 'all');
      url.searchParams.set('includeto', 'true');
      const body = await this.getJson(url);
      const page = recordsFrom(body, 'data').map(messageFrom);
      messages.push(...page);
      log(`[Zoho Mail API] Read ${page.length} message records from page starting at ${start}.`);
      if (page.length < mailPageSize) {
        return messages;
      }
      if (page.length === 0) {
        throw new Error(`Zoho Mail returned an empty message page for folder ${folderId}.`);
      }
    }
  }

  private accountUrl(accountId: string, resource: string): URL {
    return new URL(`/api/accounts/${encodeURIComponent(accountId)}/${resource}`, this.settings.apiUrl);
  }

  private async getJson(url: URL): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${await this.getAccessToken()}` },
    });
    const body: unknown = await response.json();
    const statusCode = isRecord(body) && isRecord(body.status) ? Number(body.status.code) : 0;
    if (!response.ok || statusCode >= 400) {
      throw new Error(`Zoho Mail request failed (HTTP ${response.status}): ${describeError(body)}`);
    }
    if (!isRecord(body)) {
      throw new Error('Zoho Mail returned an invalid response.');
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
        throw new Error('Zoho Mail token file has an invalid shape.');
      }
      token = parsed;
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') {
        throw new Error(`Zoho Mail OAuth token not found at ${this.settings.tokenPath}. Run the Mail OAuth setup test first.`);
      }
      throw error;
    }
    if (!token.refreshToken) {
      throw new Error(`Zoho Mail token file at ${this.settings.tokenPath} does not contain a refresh token. Reauthorize Mail access.`);
    }
    const clientId = token.clientId ?? this.settings.clientId;
    const clientSecret = token.clientSecret ?? this.settings.clientSecret;
    if (!clientId || !clientSecret) {
      throw new Error('Zoho Mail OAuth client settings are missing; set ZOHO_MAIL_CLIENT_ID and ZOHO_MAIL_CLIENT_SECRET.');
    }
    const response = await this.requestToken({
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });
    if (typeof response.access_token !== 'string') {
      throw new Error('Zoho Mail token refresh returned no access token.');
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
      throw new Error(`Zoho Mail OAuth token request failed (HTTP ${response.status}): ${describeError(body)}`);
    }
    return body;
  }
}
