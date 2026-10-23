// This code is your Playwright test configuration for Zoho WorkDrive and IDrive C2C. 
// It tells your automation tests where to log in, which credentials to use, and how to connect to the Zoho WorkDrive API.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type LocalC2CCredentials = {
  email?: string;
  password?: string;
};

const localC2CCredentialsPath = resolve(process.cwd(), '.auth', 'c2c-credentials.json');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
 
// Keep credentials out of source control; environment variables take precedence below.
function readLocalC2CCredentials(): LocalC2CCredentials {
  if (!existsSync(localC2CCredentialsPath)) {
    return {};
  }

  const parsed: unknown = JSON.parse(readFileSync(localC2CCredentialsPath, 'utf8'));
  if (
    !isRecord(parsed) ||
    ('email' in parsed && typeof parsed.email !== 'string') ||
    ('password' in parsed && typeof parsed.password !== 'string')
  ) {
    throw new Error(`Local C2C credentials file must contain string email and password values: ${localC2CCredentialsPath}`);
  }

  return {
    ...(typeof parsed.email === 'string' ? { email: parsed.email } : {}),
    ...(typeof parsed.password === 'string' ? { password: parsed.password } : {}),
  };
}
const localC2CCredentials = readLocalC2CCredentials();

// This email identifies the WorkDrive account to back up; C2C admin login is configured separately.
const zohoNativeEmail =
  process.env.ZOHO_NATIVE_EMAIL ?? process.env.ZOHO_NATIVE_USERNAME ?? 'c2c@idrive.com';

export const testSettings = {
  c2cZoho: {
    url: process.env.C2C_ZOHO_URL ?? 'http://216.107.26.163/auth/sign-in',
    email: process.env.C2C_ZOHO_EMAIL
      ?? process.env.C2C_ZOHO_USERNAME
      ?? localC2CCredentials.email
      ?? '',
    password: process.env.C2C_ZOHO_PASSWORD
      ?? localC2CCredentials.password
      ?? '',
  },
  zohoNative: {
    email: zohoNativeEmail,
  },
  zohoWorkDrive: {
    clientId: process.env.ZOHO_WORKDRIVE_CLIENT_ID ?? '',
    clientSecret: process.env.ZOHO_WORKDRIVE_CLIENT_SECRET ?? '',
    accountUrl: process.env.ZOHO_WORKDRIVE_ACCOUNTS_URL ?? 'https://accounts.zoho.in',
    apiUrl: process.env.ZOHO_WORKDRIVE_API_URL ?? 'https://www.zohoapis.in/workdrive/api/v1',
    teamId: process.env.ZOHO_WORKDRIVE_TEAM_ID ?? '9tx48d0ef109324e24d5f987544830b2b48c1',
    loginHint: zohoNativeEmail,
    redirectUri: process.env.ZOHO_WORKDRIVE_REDIRECT_URI ?? 'http://localhost:43127/oauth/callback',
    tokenPath: resolve(process.cwd(), '.auth', 'zoho-workdrive-oauth.json'),
  },
};
