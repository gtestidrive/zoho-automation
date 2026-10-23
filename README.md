# Playwright POM Automation

A starter end-to-end test framework using Playwright Test, TypeScript, and the Page Object Model.

## Requirements

- Node.js 20 or newer (includes npm)

## Setup

```powershell
npm install
npx playwright install
```

## Run tests

```powershell
npm test
npm run test:headed
npm run test:ui
```

Open the latest HTML report with:

```powershell
npm run report
```

## Structure

```text
pages/                 Page object classes and UI actions
tests/                 Test specs
playwright.config.ts   Browser, reporter, and test-runner configuration
```

Add a page object under `pages/`, then import it into specs under `tests/`. Call `SignInPage.signInIfRequired()` after navigating to the app when a test needs authentication; it reuses an existing session or signs in with C2C credentials from environment variables. Keep user-facing locators and page actions in page objects; keep scenario assertions and test intent in the specs.

## Local test accounts

The C2C sign-in page uses email/password, configured through `C2C_ZOHO_EMAIL` (or `C2C_ZOHO_USERNAME`) and `C2C_ZOHO_PASSWORD`, or an optional local `.auth/c2c-credentials.json` file containing `{"email":"...","password":"..."}`. Environment variables override the local file. The `.auth/` folder is git-ignored; keep local credentials private and never commit or share them. `C2C_ZOHO_URL` can override the default URL. The WorkDrive account email used to select the matching C2C user is configured with `ZOHO_NATIVE_EMAIL` or `ZOHO_NATIVE_USERNAME`. WorkDrive API access uses Zoho OAuth and does not use a WorkDrive account password.

The Zoho Native backup test uses OAuth to find the My Folders root from the authenticated user's ZUID, create a new WorkDrive folder, and upload a uniquely named text document into it. It then signs in to C2C at `http://216.107.26.163/auth/sign-in`, backs up the matching native user, and verifies that folder appears in the completed snapshot. OAuth setup requires a Zoho **Server-based** application with this authorized redirect URI: `http://localhost:43127/oauth/callback`. The requested scopes are `WorkDrive.files.CREATE`, `WorkDrive.files.READ`, `WorkDrive.team.READ`, and `AaaServer.profile.READ`. `ZOHO_WORKDRIVE_TEAM_ID` must identify the WorkDrive team whose My Folders root you want to use; by default, this is the team shown in the supplied WorkDrive URL. If the configured team is not available to the authorized account, the test stops instead of silently creating content in another team. The test resolves the My Folders ID through Zoho's [documented API flow](https://www.zoho.com/workdrive/developer/docs/api/v1/getting-started-fetching-ids.html).

### Backup flow by file

1. `test-settings.ts` loads regional URLs, the selected WorkDrive account/team, OAuth client settings, and C2C sign-in credentials. Secrets can come from environment variables or ignored files under `.auth/`.
2. `tests/zoho-native-auth.spec.ts` is an opt-in, headed setup step. `services/zoho-workdrive.api.ts` receives the OAuth callback, exchanges its one-time code, and saves the refresh token locally. Normal backups do not open this consent flow.
3. `tests/backupdrive.spec.ts` contains the C2C Drive backup, the Zoho Native fixture backup, the WorkDrive/C2C comparison, and the opt-in WorkDrive inventory listing.
4. `pages/sign-in.page.ts` handles the optional C2C login, `pages/recovery.page.ts` navigates to Drive recovery, and the Drive backup module separates startup/authentication (`backup.fixture.ts`), actions/workflows (`backup.page.ts`), history/snapshot/storage checks (`backup.assertions.ts`), selectors (`backup.locators.ts`), and visible labels/patterns (`backup.labels.ts`). The fixture supplies a signed-in page already opened to Drive recovery.
5. `tests/zoho-workdrive.api.spec.ts` tests token handling, folder-root resolution, team selection, and OAuth error cases with mocked HTTP responses; it does not contact Zoho.

To print all files and folders recursively from the selected team's **My Folders** tree without creating or changing anything, run:

```powershell
npx.cmd playwright test tests/backupdrive.spec.ts --grep "prints files and folders" --workers=1
```

The listing uses Zoho's paginated WorkDrive file-list API and prints each entry's type, path, and resource ID. It covers the selected account's My Folders tree, not other team members' private folders or separately shared content.

To run the Zoho Native fixture backup test (it creates a new folder/file, starts the C2C backup, and verifies the folder in the snapshot):

```powershell
npx.cmd playwright test tests/backupdrive.spec.ts --grep "creates and backs up a Zoho Native WorkDrive folder" --headed --workers=1
```

To compare the current WorkDrive tree with the selected user's existing C2C snapshot (without starting a backup), run:

```powershell
$env:COMPARE_ZOHO_WORKDRIVE_C2C = '1'
try {
    npx.cmd playwright test tests/backupdrive.spec.ts --grep "compares WorkDrive files" --headed --workers=1
} finally {
    Remove-Item Env:COMPARE_ZOHO_WORKDRIVE_C2C -ErrorAction SilentlyContinue
}
```

The comparison reports WorkDrive paths missing from the current C2C snapshot and paths present only in C2C. It compares relative paths and file/folder types, and the test fails if any current WorkDrive entries are missing. If the latest snapshot is old, run the separate backup test first.

Set the OAuth app's real client ID, client secret, and team ID in the current PowerShell session. The team ID is the first segment of the WorkDrive URL (for example, the segment before `/privatespace`); replace every example with the actual value and do not type the example text literally. Then run the one-time consent flow. Sign in to Zoho and approve the requested access in the opened browser:

```powershell
$env:ZOHO_WORKDRIVE_CLIENT_ID = '<Zoho client ID>'
$env:ZOHO_WORKDRIVE_CLIENT_SECRET = '<Zoho client secret>'
$env:SETUP_ZOHO_WORKDRIVE_OAUTH = '1'
npx.cmd playwright test tests/zoho-native-auth.spec.ts --headed --workers=1
Remove-Item Env:SETUP_ZOHO_WORKDRIVE_OAUTH
```

Complete consent using the Zoho account whose email matches `ZOHO_NATIVE_EMAIL`; OAuth sends this as a login hint to make account switching easier, but confirm the correct account in the browser before approving. The refresh token and OAuth client settings are stored locally in `.auth/zoho-workdrive-oauth.json` (git-ignored) so later Playwright invocations can refresh the token without environment variables. Keep this file private and never commit or share it. If Zoho does not return a refresh token but returns an expiring access token, setup saves that token for immediate use; rerun consent after it expires to obtain a refresh token. To switch accounts, set `ZOHO_NATIVE_EMAIL` to the new account and rerun OAuth setup; do not delete the existing token file until setup succeeds. If Zoho returns neither a refresh token nor an expiring access token, setup fails and leaves the existing token untouched rather than silently reusing credentials for the previous account; inspect any OAuth error reported, and confirm the selected account, Server-based client, redirect URI, and regional Accounts URL. Subsequent backup runs resolve the parent ID without opening WorkDrive's sign-in page. For accounts outside Zoho's India data center, set `ZOHO_WORKDRIVE_ACCOUNTS_URL` and `ZOHO_WORKDRIVE_API_URL` to the appropriate regional endpoints.

Run the cross-account test in PowerShell:

```powershell
npx.cmd playwright test tests/backupdrive.spec.ts --grep "backs up a Zoho Native WorkDrive folder" --headed --workers=1
```

This runs the complete folder-to-C2C flow: create a unique folder and upload a fresh document with the WorkDrive API, start the matching user's C2C backup, wait for completion, and check the snapshot for the folder.
