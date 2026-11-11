import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZohoWorkDriveApi } from '../../../pages/drive/api/zoho-workdrive.api';
import { OAuthPage } from '../../../pages/oauth.page';

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

test('creates a folder with a text file and PNG inside the selected Team Folder', async () => {
  let createFolderBody = '';
  const uploads: FormData[] = [];

  await withMockedWorkDrive((url, init) => {
    if (url.endsWith('/files') && init?.method === 'POST') {
      createFolderBody = String(init.body);
      return new Response(JSON.stringify({ data: { id: 'created-folder' } }), { status: 200 });
    }
    if (url.endsWith('/upload') && init?.method === 'POST') {
      if (!(init.body instanceof FormData)) {
        throw new Error('Expected file uploads to use multipart form data.');
      }
      uploads.push(init.body);
      return new Response(JSON.stringify({ data: { id: `created-file-${uploads.length}` } }), { status: 200 });
    }
    return undefined;
  }, async (tokenPath) => {
    const api = createApi(tokenPath, 'test-team');
    const fixture = await api.createTeamFolder('team-folder-id');

    expect(fixture.folderName).toMatch(/^test-\d+$/);
    expect(fixture.textFileName).toBe(`${fixture.folderName}.txt`);
    expect(fixture.imageFileName).toBe(`${fixture.folderName}.png`);
    expect(JSON.parse(createFolderBody)).toEqual({
      data: {
        attributes: { parent_id: 'team-folder-id', name: fixture.folderName },
        type: 'files',
      },
    });
    expect(uploads).toHaveLength(2);
    const textFile = uploads.find((form) => form.get('filename') === fixture.textFileName);
    const imageFile = uploads.find((form) => form.get('filename') === fixture.imageFileName);
    expect(textFile?.get('parent_id')).toBe('created-folder');
    expect(imageFile?.get('parent_id')).toBe('created-folder');
    const textContent = textFile?.get('content');
    const imageContent = imageFile?.get('content');
    if (!(textContent instanceof Blob) || !(imageContent instanceof Blob)) {
      throw new Error('Team Folder fixture uploads must include text and image blobs.');
    }
    expect(textContent.type).toBe('text/plain');
    expect(await textContent.text()).toContain('Team Folder backup test file');
    expect(imageContent.type).toBe('image/png');
    expect(imageContent.size).toBeGreaterThan(0);
    expect(new Uint8Array(await imageContent.arrayBuffer()).slice(0, 8)).toEqual(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    );
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

test('Drive export traverses only selected source folders, including nested descendants and later root pages', async () => {
  const requests: string[] = [];
  const folder = (id: string, name: string) => ({ id, attributes: { name, is_folder: true } });
  const file = (id: string, name: string) => ({ id, attributes: { name, is_folder: false } });
  await withMockedWorkDrive((url) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/oauth/user/info')) return Response.json({ ZUID: 123456789 });
    if (path.endsWith('/users/123456789/teams')) return Response.json({ data: [{ id: 'test-team' }] });
    if (path.endsWith('/teams/test-team/currentuser')) return Response.json({ data: { id: 'member' } });
    if (path.endsWith('/users/member/privatespace')) return Response.json({ data: [{ id: 'root' }] });
    const id = /\/files\/([^/]+)\/files$/.exec(path)?.[1];
    if (!id) return undefined;
    requests.push(id);
    if (id === 'root') {
      return Response.json({ data: new URL(url).searchParams.get('page[offset]') === '100'
        ? [folder('selected-b', 'Selected B'), file('single-file', 'single.txt')]
        : [folder('selected-a', 'Selected A'), ...Array.from({ length: 99 }, (_, i) => folder(`unselected-${i}`, `Other ${i}`))] });
    }
    if (id === 'selected-a') return Response.json({ data: [folder('nested', 'Nested'), file('a-file', 'a.txt')] });
    if (id === 'nested') return Response.json({ data: [file('nested-file', 'inside.txt')] });
    if (id === 'selected-b') return Response.json({ data: [] });
    throw new Error(`Unselected folder must not be scanned: ${id}`);
  }, async (tokenPath) => {
    const api = createApi(tokenPath, 'test-team');
    const entries = await api.listFilesAndFolders(['Selected A', 'Selected B', 'single.txt']);
    expect(requests).toEqual(['root', 'root', 'selected-a', 'nested', 'selected-b']);
    expect(entries.map(({ path }) => path)).toEqual([
      'Selected A', 'Selected A\\Nested', 'Selected A\\Nested\\inside.txt',
      'Selected A\\a.txt', 'Selected B', 'single.txt',
    ]);
    await expect(api.listFilesAndFolders(['Missing'])).rejects.toThrow('matches=0');
    await expect(api.listFilesAndFolders([])).rejects.toThrow('nonempty and unique');
    await expect(api.listFilesAndFolders(['Selected A', 'selected a'])).rejects.toThrow('nonempty and unique');
  });
});

test('Drive export rejects ambiguous source roots before descending into any folder', async () => {
  await withMockedWorkDrive((url) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/oauth/user/info')) return Response.json({ ZUID: 123456789 });
    if (path.endsWith('/users/123456789/teams')) return Response.json({ data: [{ id: 'test-team' }] });
    if (path.endsWith('/teams/test-team/currentuser')) return Response.json({ data: { id: 'member' } });
    if (path.endsWith('/users/member/privatespace')) return Response.json({ data: [{ id: 'root' }] });
    if (path.endsWith('/files/root/files')) {
      return Response.json({ data: [
        { id: 'one', attributes: { name: 'Selected', is_folder: true } },
        { id: 'two', attributes: { name: 'selected', is_folder: true } },
      ] });
    }
    throw new Error('Ambiguous source roots must not be traversed.');
  }, async (tokenPath) => {
    await expect(createApi(tokenPath, 'test-team').listFilesAndFolders(['Selected'])).rejects.toThrow('matches=2');
  });
});

test('lists all Team Folders across pages', async () => {
  const requestedOffsets: string[] = [];
  const firstPage = Array.from({ length: 50 }, (_, index) => ({
    id: `team-folder-${index}`,
    attributes: { name: `Team Folder ${index}`, status: index === 0 ? 'Active' : 'Inactive' },
  }));

  await withMockedWorkDrive((url) => {
    if (url.includes('/teams/test-team/teamfolders?')) {
      const requestUrl = new URL(url);
      const offset = requestUrl.searchParams.get('page[offset]') ?? '';
      requestedOffsets.push(offset);
      return new Response(JSON.stringify({
        data: offset === '0' ? firstPage : [{ id: 'team-folder-last', attributes: { name: 'Last Team', status: 'Active' } }],
      }), { status: 200 });
    }
    return undefined;
  }, async (tokenPath) => {
    const api = createApi(tokenPath, 'test-team');
    const folders = await api.listTeamFolders();

    expect(requestedOffsets).toEqual(['0', '50']);
    expect(folders).toHaveLength(51);
    expect(folders[0]).toEqual({ id: 'team-folder-0', name: 'Team Folder 0', status: 'Active' });
    expect(folders.at(-1)).toEqual({ id: 'team-folder-last', name: 'Last Team', status: 'Active' });
  });
});

test('lists Team Folder files and nested folders recursively', async () => {
  const requests: string[] = [];

  await withMockedWorkDrive((url) => {
    requests.push(url);
    if (url.includes('/teamfolders/team-folder-id/files?')) {
      return new Response(JSON.stringify({
        data: [
          { id: 'document-id', attributes: { name: 'document.txt', is_folder: false } },
          { id: 'nested-folder-id', attributes: { name: 'Nested', is_folder: true } },
        ],
      }), { status: 200 });
    }
    if (url.includes('/files/nested-folder-id/files?')) {
      return new Response(JSON.stringify({
        data: [{ id: 'nested-document-id', attributes: { name: 'inside.txt', is_folder: false } }],
      }), { status: 200 });
    }
    return undefined;
  }, async (tokenPath) => {
    const api = createApi(tokenPath, 'test-team');
    const entries = await api.listTeamFolderFiles('team-folder-id');

    expect(requests.map((url) => new URL(url).pathname)).toEqual([
      '/workdrive/api/v1/teamfolders/team-folder-id/files',
      '/workdrive/api/v1/files/nested-folder-id/files',
    ]);
    expect(entries.map(({ name, type, path }) => ({ name, type, path }))).toEqual([
      { name: 'document.txt', type: 'File', path: 'document.txt' },
      { name: 'Nested', type: 'Folder', path: 'Nested' },
      { name: 'inside.txt', type: 'File', path: 'Nested\\inside.txt' },
    ]);
  });
});

test('retries a reset Team Folder listing without duplicating the inventory', async () => {
  let attempts = 0;
  await withMockedWorkDrive((url) => {
    if (url.includes('/teams/test-team/teamfolders?')) {
      attempts++;
      if (attempts === 1) {
        throw new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });
      }
      return new Response(JSON.stringify({
        data: [{ id: 'folder', attributes: { name: 'Team', status: 'Active' } }],
      }));
    }
    return undefined;
  }, async (tokenPath) => {
    await expect(createApi(tokenPath, 'test-team').listTeamFolders()).resolves.toEqual([
      { id: 'folder', name: 'Team', status: 'Active' },
    ]);
    expect(attempts).toBe(2);
  });
});

test('reports the endpoint and preserves the cause after repeated connection resets', async () => {
  let attempts = 0;
  const failure = new TypeError('fetch failed', {
    cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
  });
  await withMockedWorkDrive((url) => {
    if (url.includes('/teams/test-team/teamfolders?')) {
      attempts++;
      throw failure;
    }
    return undefined;
  }, async (tokenPath) => {
    const request = createApi(tokenPath, 'test-team').listTeamFolders();
    await expect(request).rejects.toThrow(
      'GET https://www.zohoapis.in/workdrive/api/v1/teams/test-team/teamfolders failed after 3 attempt(s) (ECONNRESET)',
    );
    await expect(request).rejects.toHaveProperty('cause', failure);
    expect(attempts).toBe(3);
  });
});

test('does not retry HTTP authorization errors or invalid JSON', async () => {
  for (const invalidJson of [false, true]) {
    let attempts = 0;
    await withMockedWorkDrive((url) => {
      if (url.includes('/teams/test-team/teamfolders?')) {
        attempts++;
        return invalidJson
          ? new Response('invalid JSON')
          : new Response(JSON.stringify({ errors: [{ title: 'Unauthorized' }] }), { status: 401 });
      }
      return undefined;
    }, async (tokenPath) => {
      await expect(createApi(tokenPath, 'test-team').listTeamFolders()).rejects.toThrow(
        invalidJson ? 'SyntaxError' : 'HTTP 401',
      );
      expect(attempts).toBe(1);
    });
  }
});

test('retries a connection reset while reading a Team Folder response body', async () => {
  let attempts = 0;
  await withMockedWorkDrive((url) => {
    if (url.includes('/teamfolders/folder/files?')) {
      attempts++;
      if (attempts === 1) {
        return new Response(new ReadableStream({
          start(controller) {
            controller.error(new TypeError('terminated', {
              cause: Object.assign(new Error('socket closed'), { code: 'UND_ERR_SOCKET' }),
            }));
          },
        }));
      }
      return new Response(JSON.stringify({ data: [] }));
    }
    return undefined;
  }, async (tokenPath) => {
    await expect(createApi(tokenPath, 'test-team').listTeamFolderFiles('folder')).resolves.toEqual([]);
    expect(attempts).toBe(2);
  });
});

test('retries token refresh connection resets before listing Team Folders', async () => {
  await withMockedWorkDrive((url) => {
    if (url.includes('/teams/test-team/teamfolders?')) {
      return new Response(JSON.stringify({ data: [] }));
    }
    return undefined;
  }, async (tokenPath) => {
    const mockedFetch = globalThis.fetch;
    let refreshAttempts = 0;
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('/oauth/v2/token')) {
        refreshAttempts++;
        if (refreshAttempts === 1) {
          throw new TypeError('fetch failed', {
            cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
          });
        }
      }
      return mockedFetch(input, init);
    };
    try {
      await expect(createApi(tokenPath, 'test-team').listTeamFolders()).resolves.toEqual([]);
      expect(refreshAttempts).toBe(2);
    } finally {
      globalThis.fetch = mockedFetch;
    }
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
    await expect(api.authorize(new OAuthPage(page).open)).rejects.toThrow(
      'Zoho OAuth token response contained neither a refresh token nor an expiring access token',
    );
    expect(JSON.parse(await readFile(tokenPath, 'utf8'))).toEqual(previousToken);
  } finally {
    globalThis.fetch = originalFetch;
    await page.unroute(authorizationUrlPattern);
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
