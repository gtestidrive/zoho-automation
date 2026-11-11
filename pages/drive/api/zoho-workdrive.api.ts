import { createServer, type Server } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Page } from '@playwright/test';

type WorkDriveSettings = {
  clientId: string;
  clientSecret: string;
  accountUrl: string;
  apiUrl: string;
  teamId: string;
  loginHint: string;
  redirectUri: string;
  tokenPath: string;
};

type OAuthTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

type SavedOAuthToken = {
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number;
  clientId?: string;
  clientSecret?: string;
};

export type WorkDriveEntry = {
  id: string;
  name: string;
  type: 'Folder' | 'File';
  path: string;
};

export type WorkDriveTeamFolder = {
  id: string;
  name: string;
  status: string;
};

export type WorkDriveTeamFolderFixture = {
  folderName: string;
  textFileName: string;
  imageFileName: string;
};

const workDrivePageSize = 100;
const teamFolderPageSize = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSavedOAuthToken(value: unknown): value is SavedOAuthToken {
  return isRecord(value)
    && (value.refreshToken === undefined || typeof value.refreshToken === 'string')
    && (value.accessToken === undefined || typeof value.accessToken === 'string')
    && (value.expiresAt === undefined || typeof value.expiresAt === 'number')
    && (value.clientId === undefined || typeof value.clientId === 'string')
    && (value.clientSecret === undefined || typeof value.clientSecret === 'string');
}

function responseError(body: unknown): string {
  if (!isRecord(body)) {
    return 'The response did not contain an error description.';
  }

  if (typeof body.error_description === 'string') {
    return body.error_description;
  }
  if (typeof body.error === 'string') {
    return body.error;
  }
  if (Array.isArray(body.errors) && isRecord(body.errors[0])) {
    const firstError = body.errors[0];
    if (typeof firstError.title === 'string') {
      return firstError.title;
    }
    if (typeof firstError.detail === 'string') {
      return firstError.detail;
    }
  }

  return 'The response did not contain an error description.';
}

export class ZohoWorkDriveApi {
  private accessToken: string | undefined;
  private resolvedParentFolderId: string | undefined;

  constructor(private readonly settings: WorkDriveSettings) {}

  // One-time interactive consent: capture the local callback code, exchange it, and save credentials.
  async authorize(page: Page): Promise<void> {
    this.validateClientSettings(this.settings.clientId, this.settings.clientSecret);

    const redirectUrl = new URL(this.settings.redirectUri);
    const port = Number(redirectUrl.port);
    if (redirectUrl.hostname !== 'localhost' || !port || redirectUrl.pathname !== '/oauth/callback') {
      throw new Error('ZOHO_WORKDRIVE_REDIRECT_URI must use http://localhost:<port>/oauth/callback.');
    }

    const state = randomBytes(32).toString('hex');
    let resolveCode!: (code: string) => void;
    let rejectCode!: (error: Error) => void;
    const authorizationCode = new Promise<string>((resolve, reject) => {
      resolveCode = resolve;
      rejectCode = reject;
    });

    // The random state binds the browser redirect to this setup attempt and prevents forged callbacks.
    const server: Server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', this.settings.redirectUri);
      if (requestUrl.pathname !== redirectUrl.pathname) {
        response.writeHead(404).end('Not found');
        return;
      }

      if (requestUrl.searchParams.get('state') !== state) {
        response.writeHead(400).end('OAuth state did not match. You can close this tab.');
        rejectCode(new Error('Zoho OAuth callback state did not match.'));
        return;
      }

      const oauthError = requestUrl.searchParams.get('error');
      if (oauthError) {
        const description = requestUrl.searchParams.get('error_description');
        response.writeHead(400).end('Zoho authorization was not completed. You can close this tab.');
        rejectCode(new Error(`Zoho OAuth authorization failed: ${description ?? oauthError}`));
        return;
      }

      const code = requestUrl.searchParams.get('code');
      if (!code) {
        response.writeHead(400).end('Authorization code was missing. You can close this tab.');
        rejectCode(new Error('Zoho OAuth callback did not include an authorization code.'));
        return;
      }

      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
        .end('Zoho WorkDrive authorization received. Return to the Playwright test.');
      resolveCode(code);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, redirectUrl.hostname, resolve);
    });

    try {
      const authorizeUrl = new URL('/oauth/v2/auth', this.settings.accountUrl);
      const authorizationParameters: Record<string, string> = {
        client_id: this.settings.clientId,
        response_type: 'code',
        scope: 'WorkDrive.files.CREATE,WorkDrive.files.READ,WorkDrive.team.READ,WorkDrive.teamfolders.READ,AaaServer.profile.READ',
        redirect_uri: this.settings.redirectUri,
        access_type: 'offline',
        prompt: 'consent',
        state,
      };
      if (this.settings.loginHint) {
        authorizationParameters.login_hint = this.settings.loginHint;
      }
      authorizeUrl.search = new URLSearchParams(authorizationParameters).toString();

      console.log('[Zoho OAuth] Opening Zoho consent. Sign in and approve the requested WorkDrive file-creation access.');
      await page.goto(authorizeUrl.toString(), { waitUntil: 'domcontentloaded' });

      const timeout = setTimeout(() => {
        rejectCode(new Error('Zoho OAuth authorization timed out after 15 minutes.'));
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
      if (tokenResponse.refresh_token) {
        await this.saveToken({
          refreshToken: tokenResponse.refresh_token,
          clientId: this.settings.clientId,
          clientSecret: this.settings.clientSecret,
        });
        console.log(`[Zoho OAuth] Saved the refresh token to ${this.settings.tokenPath}.`);
      } else if (tokenResponse.access_token && tokenResponse.expires_in && tokenResponse.expires_in > 0) {
        const expiresAt = Date.now() + tokenResponse.expires_in * 1000;
        this.accessToken = tokenResponse.access_token;
        await this.saveToken({
          accessToken: tokenResponse.access_token,
          expiresAt,
          clientId: this.settings.clientId,
          clientSecret: this.settings.clientSecret,
        });
        console.warn('[Zoho OAuth] Zoho did not issue a refresh token. Saved a short-lived access token; rerun consent after it expires to get a refresh token.');
      } else {
        throw new Error(
          `Zoho OAuth token response contained neither a refresh token nor an expiring access token (${describeDataShape(tokenResponse)}). The existing local token was left unchanged; refusing to silently continue with a possibly different account.`,
        );
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  }

  // Create a folder in the configured team's My Folders root and return its WorkDrive resource ID.
  async createFolder(name: string): Promise<string> {
    const parentFolderId = await this.getParentFolderId();
    return this.createFolderUnderParent(parentFolderId, name);
  }

  async createTeamFolder(teamFolderId: string): Promise<WorkDriveTeamFolderFixture> {
    if (!teamFolderId.trim()) {
      throw new Error('A Zoho WorkDrive Team Folder ID is required to create a folder.');
    }

    const runStamp = new Date().toISOString().replace(/[-:T.Z]/g, '');
    const folderName = `test-${runStamp}`;
    const textFileName = `${folderName}.txt`;
    const imageFileName = `${folderName}.png`;
    const folderId = await this.createFolderUnderParent(teamFolderId, folderName);
    await this.uploadFile(
      folderId,
      textFileName,
      new Blob([`Team Folder backup test file created at ${new Date().toISOString()}.`], {
        type: 'text/plain',
      }),
    );
    await this.uploadFile(
      folderId,
      imageFileName,
      new Blob([Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      )], { type: 'image/png' }),
    );
    console.log(`[Zoho WorkDrive] Created folder "${folderName}" with ${textFileName} and ${imageFileName} in Team Folder ${teamFolderId}.`);
    return { folderName, textFileName, imageFileName };
  }

  private async uploadFile(parentFolderId: string, fileName: string, content: Blob): Promise<void> {
    const form = new FormData();
    form.set('parent_id', parentFolderId);
    form.set('filename', fileName);
    form.set('content', content, fileName);

    const response = await fetch(`${this.settings.apiUrl}/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${await this.getAccessToken()}`,
        Accept: 'application/vnd.api+json',
      },
      body: form,
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      throw new Error(`Zoho WorkDrive file upload failed for "${fileName}" (HTTP ${response.status}): ${responseError(body)}`);
    }
  }

  private async createFolderUnderParent(parentFolderId: string, name: string): Promise<string> {
    const response = await fetch(`${this.settings.apiUrl}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${await this.getAccessToken()}`,
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      },
      body: JSON.stringify({
        data: {
          attributes: {
            parent_id: parentFolderId,
            name,
          },
          type: 'files',
        },
      }),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      throw new Error(`Zoho WorkDrive folder creation failed (HTTP ${response.status}): ${responseError(body)}`);
    }
    const resourceId = firstResourceId(body);
    if (!resourceId) {
      if (isRecord(body) && Array.isArray(body.errors)) {
        throw new Error(`Zoho WorkDrive folder creation returned an API error: ${responseError(body)}.`);
      }
      throw new Error(`Zoho WorkDrive folder creation returned no resource ID (${describeDataShape(body)}).`);
    }

    return resourceId;
  }

  // List all descendants of the selected team's My Folders root, including nested folder contents.
  async listFilesAndFolders(): Promise<WorkDriveEntry[]> {
    const rootFolderId = await this.getParentFolderId();
    const entries: WorkDriveEntry[] = [];
    const visitedFolderIds = new Set([rootFolderId]);

    const visitFolder = async (folderId: string, parentPath: string): Promise<void> => {
      const items = await this.listFolderContents(folderId);
      for (const item of items) {
        const attributes = item.attributes;
        if (!isRecord(attributes)) {
          throw new Error(`Zoho WorkDrive item ${item.id} has no attributes (${describeDataShape(item)}).`);
        }

        const name = firstString(attributes, ['name']);
        if (!name) {
          throw new Error(`Zoho WorkDrive item ${item.id} has no name (${describeDataShape(attributes)}).`);
        }
        if (typeof attributes.is_folder !== 'boolean') {
          throw new Error(`Zoho WorkDrive item ${item.id} has no folder indicator (${describeDataShape(attributes)}).`);
        }

        const type = attributes.is_folder ? 'Folder' : 'File';
        const path = parentPath ? `${parentPath}\\${name}` : name;
        entries.push({ id: item.id, name, type, path });

        if (attributes.is_folder && !visitedFolderIds.has(item.id)) {
          visitedFolderIds.add(item.id);
          await visitFolder(item.id, path);
        }
      }
    };

    await visitFolder(rootFolderId, '');
    return entries;
  }

  async listTeamFolders(): Promise<WorkDriveTeamFolder[]> {
    const url = `${this.settings.apiUrl}/teams/${encodeURIComponent(this.settings.teamId)}/teamfolders`;
    const records: Array<Record<string, unknown> & { id: string }> = [];
    for (let offset = 0; ; offset += teamFolderPageSize) {
      const pageUrl = new URL(url);
      pageUrl.searchParams.set('page[limit]', String(teamFolderPageSize));
      pageUrl.searchParams.set('page[offset]', String(offset));
      const body = await this.getTeamFolderJson(pageUrl);
      const page = dataItems(body);
      records.push(...page);
      if (page.length < teamFolderPageSize) {
        break;
      }
    }

    return records.map((record) => {
      if (!isRecord(record.attributes)) {
        throw new Error(`Zoho WorkDrive Team Folder ${record.id} has no attributes (${describeDataShape(record)}).`);
      }
      const name = firstString(record.attributes, ['name']);
      const status = firstString(record.attributes, ['status']);
      if (!name || !status) {
        throw new Error(`Zoho WorkDrive Team Folder ${record.id} has no name or status (${describeDataShape(record.attributes)}).`);
      }
      return { id: record.id, name, status };
    });
  }

  async listTeamFolderFiles(teamFolderId: string): Promise<WorkDriveEntry[]> {
    const entries: WorkDriveEntry[] = [];
    const visitedFolderIds = new Set([teamFolderId]);

    const visitFolder = async (folderId: string, parentPath: string, isTeamFolderRoot: boolean): Promise<void> => {
      for (let offset = 0; ; offset += teamFolderPageSize) {
        const resourcePath = isTeamFolderRoot
          ? `/teamfolders/${encodeURIComponent(folderId)}/files`
          : `/files/${encodeURIComponent(folderId)}/files`;
        const url = new URL(`${this.settings.apiUrl}${resourcePath}`);
        url.searchParams.set('page[limit]', String(teamFolderPageSize));
        url.searchParams.set('page[offset]', String(offset));
        const page = dataItems(await this.getTeamFolderJson(url));

        for (const item of page) {
          if (!isRecord(item.attributes)) {
            throw new Error(`Zoho WorkDrive item ${item.id} has no attributes (${describeDataShape(item)}).`);
          }
          const name = firstString(item.attributes, ['name']);
          const isFolder = item.attributes.is_folder ?? item.attributes.isFolder;
          if (!name || typeof isFolder !== 'boolean') {
            throw new Error(`Zoho WorkDrive item ${item.id} has no name or folder indicator (${describeDataShape(item.attributes)}).`);
          }

          const path = parentPath ? `${parentPath}\\${name}` : name;
          entries.push({ id: item.id, name, type: isFolder ? 'Folder' : 'File', path });
          if (isFolder && !visitedFolderIds.has(item.id)) {
            visitedFolderIds.add(item.id);
            await visitFolder(item.id, path, false);
          }
        }

        if (page.length < teamFolderPageSize) {
          break;
        }
      }
    };

    await visitFolder(teamFolderId, '', true);
    return entries;
  }

  private async getTeamFolderJson(url: URL): Promise<Record<string, unknown>> {
    const accessToken = await this.getAccessToken();
    const { response, body } = await this.requestJson(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        Accept: 'application/vnd.api+json',
      },
    }, true);
    if (!response.ok) {
      throw new Error(`Zoho WorkDrive Team Folder request failed (HTTP ${response.status}): ${responseError(body)}`);
    }
    if (!isRecord(body)) {
      throw new Error('Zoho WorkDrive Team Folder request returned an invalid response.');
    }
    return body;
  }

  private async listFolderContents(folderId: string): Promise<Array<Record<string, unknown> & { id: string }>> {
    const accessToken = await this.getAccessToken();
    const headers = {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      Accept: 'application/vnd.api+json',
    };
    const items: Array<Record<string, unknown> & { id: string }> = [];

    for (let offset = 0; ; offset += workDrivePageSize) {
      const url = new URL(`${this.settings.apiUrl}/files/${encodeURIComponent(folderId)}/files`);
      url.searchParams.set('page[limit]', String(workDrivePageSize));
      url.searchParams.set('page[offset]', String(offset));

      const response = await fetch(url, { headers });
      const body: unknown = await response.json();
      if (!response.ok) {
        throw new Error(
          `Zoho WorkDrive folder listing failed (HTTP ${response.status}): ${responseError(body)}`,
        );
      }

      const page = dataItems(body);
      items.push(...page);
      if (page.length < workDrivePageSize) {
        return items;
      }
    }
  }

  private async getParentFolderId(): Promise<string> {
    if (this.resolvedParentFolderId) {
      return this.resolvedParentFolderId;
    }

    // Zoho IDs are distinct: resolve ZUID -> team -> team member -> My Folders before creating content.
    const accessToken = await this.getAccessToken();
    const headers = {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      Accept: 'application/vnd.api+json',
    };
    const userInfoResponse = await fetch(new URL('/oauth/user/info', this.settings.accountUrl), { headers });
    const userInfoBody: unknown = await userInfoResponse.json();
    if (!userInfoResponse.ok) {
      throw new Error(
        `Zoho account user lookup failed (HTTP ${userInfoResponse.status}): ${responseError(userInfoBody)}. Reauthorize with AaaServer.profile.READ scope.`,
      );
    }
    const userId = firstString(userInfoBody, ['ZUID', 'zuid']);
    if (!userId) {
      throw new Error(`Zoho account user lookup returned no ZUID (${describeDataShape(userInfoBody)}).`);
    }

    const teamsResponse = await fetch(
      `${this.settings.apiUrl}/users/${encodeURIComponent(userId)}/teams`,
      { headers },
    );
    const teamsBody: unknown = await teamsResponse.json();
    if (!teamsResponse.ok) {
      throw new Error(
        `Zoho WorkDrive team lookup failed (HTTP ${teamsResponse.status}): ${responseError(teamsBody)}. Reauthorize with WorkDrive.team.READ scope.`,
      );
    }
    const teams = dataItems(teamsBody);
    if (teams.length === 0) {
      // Some accounts have no listed teams; try the known account/team identifiers as a private-space fallback.
      const directUserIds = [...new Set([this.settings.teamId, userId].filter(Boolean))];
      const lookupFailures: string[] = [];
      for (const candidateId of directUserIds) {
        const privateSpaceResponse = await fetch(
          `${this.settings.apiUrl}/users/${encodeURIComponent(candidateId)}/privatespace`,
          { headers },
        );
        const privateSpaceBody: unknown = await privateSpaceResponse.json();
        if (privateSpaceResponse.ok) {
          const parentFolderId = firstDataId(privateSpaceBody);
          if (parentFolderId) {
            this.resolvedParentFolderId = parentFolderId;
            console.log('[Zoho WorkDrive] Resolved the My Folders parent ID from the account private space.');
            return parentFolderId;
          }
          lookupFailures.push(`candidate ID returned no folder ID (${describeDataShape(privateSpaceBody)})`);
        } else {
          lookupFailures.push(`candidate ID lookup failed (HTTP ${privateSpaceResponse.status}): ${responseError(privateSpaceBody)}`);
        }
      }
      throw new Error(
        `Zoho WorkDrive returned no teams for the authorized user, and direct My Folders lookup failed: ${lookupFailures.join('; ')}.`,
      );
    }

    // Never silently select a different team: this previously created folders outside the user's visible team.
    const preferredTeamId = this.settings.teamId && !/[<>]/.test(this.settings.teamId)
      ? this.settings.teamId
      : undefined;
    const preferredTeam = preferredTeamId
      ? teams.find((team) => team.id === preferredTeamId)
      : undefined;
    if (preferredTeamId && !preferredTeam) {
      throw new Error(
        `Configured Zoho WorkDrive team ID "${preferredTeamId}" is not available to the authorized user. Set ZOHO_WORKDRIVE_TEAM_ID to one of the user's team IDs; refusing to create content in another team.`,
      );
    }
    const teamsToResolve = preferredTeam ? [preferredTeam] : teams;
    for (const team of teamsToResolve) {
      const teamMemberResponse = await fetch(
        `${this.settings.apiUrl}/teams/${encodeURIComponent(team.id)}/currentuser`,
        { headers },
      );
      const teamMemberBody: unknown = await teamMemberResponse.json();
      if (!teamMemberResponse.ok) {
        continue;
      }
      const teamMemberId = firstDataId(teamMemberBody);
      if (!teamMemberId) {
        continue;
      }

      const privateSpaceResponse = await fetch(
        `${this.settings.apiUrl}/users/${encodeURIComponent(teamMemberId)}/privatespace`,
        { headers },
      );
      const privateSpaceBody: unknown = await privateSpaceResponse.json();
      if (!privateSpaceResponse.ok) {
        throw new Error(
          `Zoho WorkDrive My Folders lookup failed (HTTP ${privateSpaceResponse.status}): ${responseError(privateSpaceBody)}. Reauthorize with WorkDrive.files.READ scope.`,
        );
      }
      const parentFolderId = firstDataId(privateSpaceBody);
      if (!parentFolderId) {
        throw new Error(`Zoho WorkDrive My Folders lookup returned no folder ID (${describeDataShape(privateSpaceBody)}).`);
      }

      this.resolvedParentFolderId = parentFolderId;
      console.log(`[Zoho WorkDrive] Resolved My Folders for team ${team.id}.`);
      return parentFolderId;
    }

    throw new Error('Zoho WorkDrive found no current team member with a My Folders space for the authorized user.');
  }

  private validateClientSettings(clientId: string, clientSecret: string): void {
    if (!clientId || !clientSecret) {
      throw new Error('OAuth client settings are not available. Set ZOHO_WORKDRIVE_CLIENT_ID and ZOHO_WORKDRIVE_CLIENT_SECRET and rerun the OAuth setup once.');
    }
    const hasPlaceholder = (value: string) => /[<>]/.test(value) || /^your[-_ ]/i.test(value);
    if (hasPlaceholder(clientId) || hasPlaceholder(clientSecret)) {
      throw new Error('Replace the example values for ZOHO_WORKDRIVE_CLIENT_ID and ZOHO_WORKDRIVE_CLIENT_SECRET with the actual credentials from Zoho API Console.');
    }
  }

  private async saveToken(token: SavedOAuthToken): Promise<void> {
    await mkdir(dirname(this.settings.tokenPath), { recursive: true });
    await writeFile(this.settings.tokenPath, JSON.stringify(token), {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }

    let tokenContents: string;
    try {
      tokenContents = await readFile(this.settings.tokenPath, 'utf8');
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') {
        throw new Error(`Zoho OAuth token file is missing. Run the OAuth setup test to create ${this.settings.tokenPath}.`);
      }
      throw error;
    }

    let savedToken: unknown;
    try {
      savedToken = JSON.parse(tokenContents);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`OAuth token file is invalid: ${this.settings.tokenPath}. Run the Zoho OAuth setup test again.`);
      }
      throw error;
    }
    if (!isSavedOAuthToken(savedToken)) {
      throw new Error(`OAuth token file is invalid: ${this.settings.tokenPath}. Run the Zoho OAuth setup test again.`);
    }
    // Prefer reusable refresh tokens; only use a saved access token while its known expiry is still valid.
    if (!savedToken.refreshToken) {
      if (
        typeof savedToken.accessToken === 'string' &&
        typeof savedToken.expiresAt === 'number' &&
        savedToken.expiresAt > Date.now()
      ) {
        this.accessToken = savedToken.accessToken;
        return this.accessToken;
      }
      throw new Error(`OAuth token file has no valid refresh token or unexpired access token: ${this.settings.tokenPath}. Run the Zoho OAuth setup test again.`);
    }

    const clientId = this.settings.clientId || savedToken.clientId || '';
    const clientSecret = this.settings.clientSecret || savedToken.clientSecret || '';
    this.validateClientSettings(clientId, clientSecret);
    const tokenResponse = await this.requestToken({
      grant_type: 'refresh_token',
      refresh_token: savedToken.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });
    if (!tokenResponse.access_token) {
      throw new Error('Zoho OAuth token refresh succeeded without an access token.');
    }
    this.accessToken = tokenResponse.access_token;
    return this.accessToken;
  }

  private async requestToken(parameters: Record<string, string>): Promise<OAuthTokenResponse> {
    const { response, body } = await this.requestJson(new URL('/oauth/v2/token', this.settings.accountUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(parameters),
    }, parameters.grant_type === 'refresh_token');
    if (!response.ok) {
      throw new Error(`Zoho OAuth token request failed (HTTP ${response.status}): ${responseError(body)}`);
    }
    if (!isRecord(body)) {
      throw new Error('Zoho OAuth token request returned an invalid response.');
    }
    if (typeof body.error === 'string') {
      throw new Error(`Zoho OAuth token request failed: ${responseError(body)}`);
    }

    return {
      ...(typeof body.access_token === 'string' ? { access_token: body.access_token } : {}),
      ...(typeof body.refresh_token === 'string' ? { refresh_token: body.refresh_token } : {}),
      ...(typeof body.expires_in === 'number'
        ? { expires_in: body.expires_in }
        : typeof body.expires_in === 'string' && Number.isFinite(Number(body.expires_in))
          ? { expires_in: Number(body.expires_in) }
          : {}),
    };
  }

  private async requestJson(
    url: URL,
    init: RequestInit,
    retryTransportErrors: boolean,
  ): Promise<{ response: Response; body: unknown }> {
    const attempts = retryTransportErrors ? 3 : 1;
    const operation = `${init.method ?? 'GET'} ${url.origin}${url.pathname}`;
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
        const body: unknown = await response.json();
        return { response, body };
      } catch (error) {
        const cause = isRecord(error) && isRecord(error.cause) ? error.cause : error;
        const code = isRecord(cause) && typeof cause.code === 'string' ? cause.code : undefined;
        const transient = code !== undefined && [
          'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN',
          'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
          'UND_ERR_BODY_TIMEOUT',
        ].includes(code) || error instanceof Error && error.name === 'TimeoutError';
        if (!transient || attempt >= attempts) {
          throw new Error(
            `Zoho WorkDrive ${operation} failed after ${attempt} attempt(s)`
            + ` (${code ?? (error instanceof Error ? error.name : 'unknown error')}).`,
            { cause: error },
          );
        }
        console.warn(
          `[Zoho WorkDrive] ${operation} connection interrupted (${code ?? 'TimeoutError'}); `
          + `retrying (${attempt + 1}/${attempts}).`,
        );
        await delay(attempt * 1_000);
      }
    }
  }
}

function firstDataId(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const data = value.data;
  const firstItem = Array.isArray(data) ? data[0] : data;
  if (!isRecord(firstItem)) {
    return undefined;
  }
  const id = firstItem.id;
  return typeof id === 'string' && id ? id : undefined;
}

function firstResourceId(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const data = value.data;
  const candidates = [value.resourceId, value.resource_id, value.id];
  if (isRecord(data)) {
    candidates.push(data.resourceId, data.resource_id, data.id);
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate) {
      return candidate;
    }
    if (typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate > 0) {
      return String(candidate);
    }
  }
  return undefined;
}

function dataItems(value: unknown): Array<Record<string, unknown> & { id: string }> {
  if (!isRecord(value)) {
    return [];
  }
  const data = value.data;
  const items = Array.isArray(data) ? data : isRecord(data) ? [data] : [];
  return items.filter((item): item is Record<string, unknown> & { id: string } =>
    isRecord(item) && typeof item.id === 'string' && item.id.length > 0,
  );
}

function firstString(value: unknown, keys: string[]): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate) {
      return candidate;
    }
    if (typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate > 0) {
      return String(candidate);
    }
  }
  return undefined;
}

function describeDataShape(value: unknown): string {
  if (!isRecord(value)) {
    return `response is ${value === null ? 'null' : typeof value}`;
  }
  if (!('data' in value)) {
    return `response keys: ${Object.keys(value).join(', ') || 'none'}`;
  }
  const data = value.data;
  if (Array.isArray(data)) {
    const firstItem = data[0];
    return `data is an array${isRecord(firstItem) ? ` with item keys: ${Object.keys(firstItem).join(', ') || 'none'}` : ''}`;
  }
  return `data is ${data === null ? 'null' : typeof data}${isRecord(data) ? ` with keys: ${Object.keys(data).join(', ') || 'none'}` : ''}`;
}
