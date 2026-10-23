import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZohoWorkDriveApi } from '../services/zoho-workdrive.api';

// These tests stub Zoho HTTP responses so API parsing, token use, and team selection are deterministic.
async function withMockedWorkDrive(
  handleRequest: (url: string, init?: RequestInit) => Response | undefined,
  run: (tokenPath: string, getCreateFolderBody: () => string, getRefreshRequest: () => URLSearchParams | undefined) => Promise<void>,
  savedToken: Record<string, unknown> = {
    refreshToken: 'test-refresh-token',
    clientId: 'saved-test-client-id',
    clientSecret: 'saved-test-client-secret',
  },
  tokenResponseBody: unknown = { access_token: 'test-access-token' },
): Promise<void> {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'zoho-workdrive-test-'));
  const tokenPath = join(tempDirectory, 'oauth.json');
  await writeFile(tokenPath, JSON.stringify(savedToken));

  const originalFetch = globalThis.fetch;
  let createFolderBody = '';
  let refreshRequest: URLSearchParams | undefined;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/oauth/v2/token')) {
      refreshRequest = new URLSearchParams(String(init?.body));
      return new Response(JSON.stringify(tokenResponseBody), { status: 200 });
    }
    const response = handleRequest(url, init);
    if (response) {
      if (url.endsWith('/files')) {
        createFolderBody = String(init?.body);
      }
      return response;
    }
    return new Response(JSON.stringify({ errors: [{ title: 'Unexpected request' }] }), { status: 404 });
  };

  try {
    await run(tokenPath, () => createFolderBody, () => refreshRequest);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function createApi(
  tokenPath: string,
  teamId: string,
  clientId = '',
  clientSecret = '',
  redirectUri = 'http://localhost:43127/oauth/callback',
): ZohoWorkDriveApi {
  return new ZohoWorkDriveApi({
    clientId,
    clientSecret,
    accountUrl: 'https://accounts.zoho.in',
    apiUrl: 'https://www.zohoapis.in/workdrive/api/v1',
    teamId,
    loginHint: '',
    redirectUri,
    tokenPath,
  });
}

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, 'localhost', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not determine an available OAuth callback port.');
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

// The standard flow resolves the selected team's My Folders ID and sends it as parent_id.
test('resolves the My Folders parent ID before creating a folder', async () => {
  await withMockedWorkDrive((url) => {
    if (url.endsWith('/oauth/user/info')) {
      return new Response(JSON.stringify({ First_Name: 'Test', Display_Name: 'Test User', ZUID: 123456789 }), { status: 200 });
    }
    if (url.endsWith('/users/123456789/teams')) {
      return new Response(JSON.stringify({ data: [{ id: 'test-team' }] }), { status: 200 });
    }
    if (url.endsWith('/teams/test-team/currentuser')) {
      return new Response(JSON.stringify({ data: { id: 'test-team-member' } }), { status: 200 });
    }
    if (url.endsWith('/users/test-team-member/privatespace')) {
      return new Response(JSON.stringify({ data: [{ id: 'test-my-folders-id' }] }), { status: 200 });
    }
    if (url.endsWith('/files')) {
      return new Response(JSON.stringify({ data: { id: 'created-folder-id', type: 'files' } }), { status: 200 });
    }
    return undefined;
  }, async (tokenPath, getCreateFolderBody, getRefreshRequest) => {
    const api = createApi(tokenPath, 'test-team');
    await expect(api.createFolder('test-folder')).resolves.toBe('created-folder-id');
    expect(getRefreshRequest()?.get('client_id')).toBe('saved-test-client-id');
    expect(getRefreshRequest()?.get('client_secret')).toBe('saved-test-client-secret');
    expect(JSON.parse(getCreateFolderBody())).toEqual({
      data: {
        attributes: { parent_id: 'test-my-folders-id', name: 'test-folder' },
        type: 'files',
      },
    });
  });
});

test('uses the configured team My Folders root when the account belongs to multiple teams', async () => {
  let selectedTeam: string | undefined;
  await withMockedWorkDrive((url) => {
    if (url.endsWith('/oauth/user/info')) {
      return new Response(JSON.stringify({ ZUID: 123456789 }), { status: 200 });
    }
    if (url.endsWith('/users/123456789/teams')) {
      return new Response(JSON.stringify({ data: [{ id: 'other-team' }, { id: 'visible-team' }] }), { status: 200 });
    }
    if (url.includes('/teams/')) {
      const match = url.match(/\/teams\/([^/]+)\/currentuser$/);
      selectedTeam = match?.[1];
      return new Response(JSON.stringify({ data: { id: 'visible-team-member' } }), { status: 200 });
    }
    if (url.endsWith('/users/visible-team-member/privatespace')) {
      return new Response(JSON.stringify({ data: [{ id: 'visible-team-my-folders' }] }), { status: 200 });
    }
    if (url.endsWith('/files')) {
      return new Response(JSON.stringify({ resourceId: 'created-folder-id' }), { status: 200 });
    }
    return undefined;
  }, async (tokenPath, getCreateFolderBody) => {
    const api = createApi(tokenPath, 'visible-team');
    await expect(api.createFolder('test-folder')).resolves.toBe('created-folder-id');
    expect(selectedTeam).toBe('visible-team');
    expect(JSON.parse(getCreateFolderBody()).data.attributes.parent_id).toBe('visible-team-my-folders');
  });
});

test('lists all files and folders recursively across pages', async () => {
  const rootFirstPage = [
    { id: 'nested-folder', attributes: { name: 'nested', type: 'folder', is_folder: true } },
    ...Array.from({ length: 99 }, (_, index) => ({
      id: `root-file-${index}`,
      attributes: { name: `root-${index}.txt`, type: 'file', is_folder: false },
    })),
  ];
  const rootOffsets: string[] = [];

  await withMockedWorkDrive((url) => {
    if (url.endsWith('/oauth/user/info')) {
      return new Response(JSON.stringify({ ZUID: 123456789 }), { status: 200 });
    }
    if (url.endsWith('/users/123456789/teams')) {
      return new Response(JSON.stringify({ data: [{ id: 'test-team' }] }), { status: 200 });
    }
    if (url.endsWith('/teams/test-team/currentuser')) {
      return new Response(JSON.stringify({ data: { id: 'test-team-member' } }), { status: 200 });
    }
    if (url.endsWith('/users/test-team-member/privatespace')) {
      return new Response(JSON.stringify({ data: [{ id: 'test-my-folders-id' }] }), { status: 200 });
    }
    if (url.includes('/files/test-my-folders-id/files')) {
      const requestUrl = new URL(url);
      const offset = requestUrl.searchParams.get('page[offset]') ?? '0';
      rootOffsets.push(offset);
      return new Response(JSON.stringify({
        data: offset === '0'
          ? rootFirstPage
          : [{ id: 'last-root-file', attributes: { name: 'last.txt', type: 'file', is_folder: false } }],
      }), { status: 200 });
    }
    if (url.includes('/files/nested-folder/files')) {
      return new Response(JSON.stringify({
        data: [{ id: 'nested-file', attributes: { name: 'inside.txt', type: 'file', is_folder: false } }],
      }), { status: 200 });
    }
    return undefined;
  }, async (tokenPath) => {
    const api = createApi(tokenPath, 'test-team');
    const entries = await api.listFilesAndFolders();

    expect(rootOffsets).toEqual(['0', '100']);
    expect(entries).toHaveLength(102);
    expect(entries.find((entry) => entry.id === 'nested-folder')).toEqual({
      id: 'nested-folder',
      name: 'nested',
      type: 'Folder',
      path: 'nested',
    });
    expect(entries.find((entry) => entry.id === 'nested-file')).toEqual({
      id: 'nested-file',
      name: 'inside.txt',
      type: 'File',
      path: 'nested\\inside.txt',
    });
    expect(entries.find((entry) => entry.id === 'last-root-file')?.path).toBe('last.txt');
  });
});

test('rejects an unavailable configured team instead of choosing a different team', async () => {
  await withMockedWorkDrive((url) => {
    if (url.endsWith('/oauth/user/info')) {
      return new Response(JSON.stringify({ ZUID: 123456789 }), { status: 200 });
    }
    if (url.endsWith('/users/123456789/teams')) {
      return new Response(JSON.stringify({ data: [{ id: 'available-team' }] }), { status: 200 });
    }
    return undefined;
  }, async (tokenPath) => {
    const api = createApi(tokenPath, 'unavailable-team');
    await expect(api.createFolder('test-folder')).rejects.toThrow(
      'Configured Zoho WorkDrive team ID "unavailable-team" is not available',
    );
  });
});

test('resolves My Folders directly when the authorized user has no listed teams', async () => {
  await withMockedWorkDrive((url) => {
    if (url.endsWith('/oauth/user/info')) {
      return new Response(JSON.stringify({ ZUID: 123456789 }), { status: 200 });
    }
    if (url.endsWith('/users/123456789/teams')) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    if (url.endsWith('/users/workdrive-account-id/privatespace')) {
      return new Response(JSON.stringify({ data: [{ id: 'private-space-id' }] }), { status: 200 });
    }
    if (url.endsWith('/files')) {
      return new Response(JSON.stringify({ resourceId: 'created-folder-id' }), { status: 200 });
    }
    return undefined;
  }, async (tokenPath, getCreateFolderBody) => {
    const api = createApi(tokenPath, 'workdrive-account-id');
    await expect(api.createFolder('test-folder')).resolves.toBe('created-folder-id');
    expect(JSON.parse(getCreateFolderBody()).data.attributes.parent_id).toBe('private-space-id');
  });
});

test('uses a saved, unexpired access token when Zoho did not issue a refresh token', async () => {
  await withMockedWorkDrive((url) => {
    if (url.endsWith('/oauth/user/info')) {
      return new Response(JSON.stringify({ ZUID: 123456789 }), { status: 200 });
    }
    if (url.endsWith('/users/123456789/teams')) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    if (url.endsWith('/users/workdrive-account-id/privatespace')) {
      return new Response(JSON.stringify({ data: [{ id: 'private-space-id' }] }), { status: 200 });
    }
    if (url.endsWith('/files')) {
      return new Response(JSON.stringify({ resourceId: 'created-folder-id' }), { status: 200 });
    }
    return undefined;
  }, async (tokenPath, _getCreateFolderBody, getRefreshRequest) => {
    const api = createApi(tokenPath, 'workdrive-account-id');
    await expect(api.createFolder('test-folder')).resolves.toBe('created-folder-id');
    expect(getRefreshRequest()).toBeUndefined();
  }, {
    accessToken: 'temporary-access-token',
    expiresAt: Date.now() + 60_000,
    clientId: 'saved-test-client-id',
    clientSecret: 'saved-test-client-secret',
  });
});

test('surfaces OAuth errors returned with a successful HTTP status', async () => {
  await withMockedWorkDrive(
    () => undefined,
    async (tokenPath) => {
      const api = createApi(tokenPath, 'workdrive-account-id');
      await expect(api.createFolder('test-folder')).rejects.toThrow(
        'Zoho OAuth token request failed: Authorization code has expired.',
      );
    },
    undefined,
    { error: 'invalid_code', error_description: 'Authorization code has expired.' },
  );
});

test('does not reuse the existing account token when OAuth returns no usable token', async ({ page }) => {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'zoho-workdrive-test-'));
  const tokenPath = join(tempDirectory, 'oauth.json');
  const previousToken = {
    refreshToken: 'previous-account-refresh-token',
    clientId: 'saved-test-client-id',
    clientSecret: 'saved-test-client-secret',
  };
  const port = await getAvailablePort();
  const redirectUri = `http://localhost:${port}/oauth/callback`;
  const authorizationUrlPattern = 'https://accounts.zoho.in/oauth/v2/auth**';
  const originalFetch = globalThis.fetch;

  await writeFile(tokenPath, JSON.stringify(previousToken));
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/oauth/v2/token')) {
      return new Response(JSON.stringify({}), { status: 200 });
    }
    return originalFetch(input, init);
  };

  try {
    await page.route(authorizationUrlPattern, async (route) => {
      const authorizeUrl = new URL(route.request().url());
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set('state', authorizeUrl.searchParams.get('state') ?? '');
      callbackUrl.searchParams.set('code', 'test-authorization-code');
      await originalFetch(callbackUrl);
      await route.fulfill({ status: 200, contentType: 'text/plain', body: 'OAuth test callback' });
    });

    const api = createApi(tokenPath, 'workdrive-account-id', 'test-client-id', 'test-client-secret', redirectUri);
    await expect(api.authorize(page)).rejects.toThrow(
      'Zoho OAuth token response contained neither a refresh token nor an expiring access token',
    );
    expect(JSON.parse(await readFile(tokenPath, 'utf8'))).toEqual(previousToken);
  } finally {
    globalThis.fetch = originalFetch;
    await page.unroute(authorizationUrlPattern);
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
