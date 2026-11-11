import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZohoMailApi } from '../../../pages/mail/api/zoho-mail.api';

async function withMockedMailApi(
  handleRequest: (url: string, init?: RequestInit) => Response | undefined,
  run: (api: ZohoMailApi) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'zoho-mail-api-test-'));
  const tokenPath = join(directory, 'oauth.json');
  await writeFile(tokenPath, JSON.stringify({
    refreshToken: 'test-refresh-token',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/oauth/v2/token')) {
      return new Response(JSON.stringify({ access_token: 'test-access-token' }), { status: 200 });
    }
    const response = handleRequest(url, init);
    if (response) {
      return response;
    }
    return new Response(JSON.stringify({ message: 'Unexpected mocked Zoho Mail request.' }), { status: 404 });
  };

  try {
    await run(new ZohoMailApi({
      testRecipientEmail: 'ajay@idriveedge.com',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      accountUrl: 'https://accounts.zoho.in',
      apiUrl: 'https://mail.zoho.in',
      redirectUri: 'http://localhost:43129/oauth/callback',
      tokenPath,
    }));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
}

test('sends a uniquely named plain-text message from the native Zoho account to the configured recipient', async () => {
  let sendBody: Record<string, unknown> | undefined;
  await withMockedMailApi((url, init) => {
    if (url.endsWith('/api/accounts')) {
      return new Response(JSON.stringify({
        data: [{ accountId: 'native-account-id', primaryEmailAddress: 'native@example.com' }],
      }), { status: 200 });
    }
    if (url.endsWith('/api/accounts/native-account-id/messages') && init?.method === 'POST') {
      sendBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        status: { code: 200, description: 'success' },
        data: { messageId: 'sent-message-id' },
      }), { status: 200 });
    }
    return undefined;
  }, async (api) => {
    const result = await api.sendTestMessageTo('native@example.com', 'ajay@idriveedge.com');

    expect(result.subject).toMatch(/^Zoho automation backup test /);
    expect(sendBody).toMatchObject({
      fromAddress: 'native@example.com',
      toAddress: 'ajay@idriveedge.com',
      content: 'Automated Zoho Mail backup test sent to ajay@idriveedge.com.',
      mailFormat: 'plaintext',
      isSchedule: false,
    });
    expect(sendBody?.subject).toBe(result.subject);
  });
});

test('surfaces Zoho Mail send errors returned in a successful HTTP response', async () => {
  await withMockedMailApi((url, init) => {
    if (url.endsWith('/api/accounts')) {
      return new Response(JSON.stringify({
        data: [{ accountId: 'native-account-id', primaryEmailAddress: 'native@example.com' }],
      }), { status: 200 });
    }
    if (url.endsWith('/api/accounts/native-account-id/messages') && init?.method === 'POST') {
      return new Response(JSON.stringify({
        status: { code: 500, description: 'Mailbox unavailable.' },
      }), { status: 200 });
    }
    return undefined;
  }, async (api) => {
    await expect(api.sendTestMessageTo('native@example.com', 'ajay@idriveedge.com'))
      .rejects.toThrow('Zoho Mail test message send failed (HTTP 200): Mailbox unavailable.');
  });
});

test('explains that a rejected send may need ZohoMail.messages.CREATE authorization', async () => {
  await withMockedMailApi((url, init) => {
    if (url.endsWith('/api/accounts')) {
      return new Response(JSON.stringify({
        data: [{ accountId: 'native-account-id', primaryEmailAddress: 'native@example.com' }],
      }), { status: 200 });
    }
    if (url.endsWith('/api/accounts/native-account-id/messages') && init?.method === 'POST') {
      return new Response(JSON.stringify({}), { status: 401 });
    }
    return undefined;
  }, async (api) => {
    await expect(api.sendTestMessageTo('native@example.com', 'ajay@idriveedge.com'))
      .rejects.toThrow('Reauthorize Zoho Mail and approve ZohoMail.messages.CREATE, then retry.');
  });
});
