# Zoho OAuth refresh-token recovery

## What happens when a refresh token stops working?

Before calling the WorkDrive API, the backup test exchanges the saved refresh token for a short-lived access token. If Zoho rejects the refresh token because it was revoked, expired, or otherwise invalid, the token refresh request fails and the backup test stops with an OAuth error.

The backup does not open the Zoho consent page automatically. This avoids unexpectedly prompting for consent or authorizing the wrong Zoho account during a backup run. No new WorkDrive folder is created if token refresh fails at the start of the run.

## Reauthorize

The OAuth setup test is an interactive, headed flow. It requires the same OAuth app's client ID and secret, which are stored in the local, git-ignored `.auth/zoho-workdrive-oauth.json` file. Run this PowerShell block from the project root to load those settings without printing them and start consent:

```powershell
$oauth = Get-Content .auth\zoho-workdrive-oauth.json -Raw | ConvertFrom-Json
$env:ZOHO_WORKDRIVE_CLIENT_ID = $oauth.clientId
$env:ZOHO_WORKDRIVE_CLIENT_SECRET = $oauth.clientSecret
$env:SETUP_ZOHO_WORKDRIVE_OAUTH = '1'
try {
    npx.cmd playwright test tests/zoho-native-auth.spec.ts --headed --workers=1
} finally {
    Remove-Item Env:SETUP_ZOHO_WORKDRIVE_OAUTH -ErrorAction SilentlyContinue
    Remove-Item Env:ZOHO_WORKDRIVE_CLIENT_ID -ErrorAction SilentlyContinue
    Remove-Item Env:ZOHO_WORKDRIVE_CLIENT_SECRET -ErrorAction SilentlyContinue
    $oauth = $null
}
```

In the browser, confirm you are signed in to the intended Zoho account and approve the requested WorkDrive permissions. On success, setup saves the new refresh token to `.auth/zoho-workdrive-oauth.json`. Then rerun the backup:

```powershell
npx.cmd playwright test tests/backupdrive.spec.ts --grep "creates and backs up a Zoho Native WorkDrive folder" --headed --workers=1
```

If the token file is missing or does not contain the OAuth client settings, set `ZOHO_WORKDRIVE_CLIENT_ID` and `ZOHO_WORKDRIVE_CLIENT_SECRET` from Zoho API Console before running setup. Never share or commit the `.auth/` files. If Zoho reports an authorization or redirect URI error, verify the selected account, OAuth app, regional Accounts URL, and the exact registered redirect URI (`http://localhost:43127/oauth/callback`).
