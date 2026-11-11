# Playwright POM Automation

A starter end-to-end test framework using Playwright Test, TypeScript, and the Page Object Model.

## Requirements

- Node.js 22 or newer (includes npm; required by the Calendar iCalendar parser)

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

Add a page object under `pages/`, then import it into specs under `tests/`. Call `SignInPage.signInIfRequired()` after navigating to the app when a test needs authentication; it reuses an existing session or signs in with C2C credentials from environment variables.

Module responsibilities apply to every product and workflow:

- `*.page.ts`: UI actions, navigation, polling/waits, selection, history reads, ZIP/VCF/EML/iCalendar parsing, download handling and source-data orchestration. Readiness checks stay alongside the action they synchronize.
- `*.assertions.ts` (and pure `*.comparison.ts` helpers): verification of supplied data/locators, comparisons, canonicalization, checksums and mismatch diagnostics. They do not click controls, paginate, read files or fetch API data.
- `*.locators.ts`: named selector definitions only; no actions or data reads.
- `*.labels.ts`: UI text, paths and patterns.
- `api/*.api.ts`: HTTP/OAuth transport and response parsing, not browser navigation or test assertions. OAuth consent navigation uses the shared `OAuthPage.open` callback.
- `*_config.ts`: workflow setup/wiring, inside the matching backup, restore or export folder. Contacts restore setup is `pages/contacts/restore/contacts_restore_config.ts`.

Specs retain scenario intent and final expectations. `tests/module-responsibilities.spec.ts` guards the action/assertion/locator/API boundaries.

## Local test accounts

The sign-in helper reuses authentication already present in the current browser context. If the public sign-in form is displayed with a saved access token, it first opens protected Overview to validate the session. Credentials are submitted only when sign-in is still required. Separate Playwright test contexts do not automatically share an existing browser's login; no shared authentication setup or parallel execution is enabled by this behavior.

The C2C sign-in page uses email/password, configured through `C2C_ZOHO_EMAIL` (or `C2C_ZOHO_USERNAME`) and `C2C_ZOHO_PASSWORD`, or an optional local `.auth/c2c-credentials.json` file containing `{"email":"...","password":"..."}`. Environment variables override the local file. The `.auth/` folder is git-ignored; keep local credentials private and never commit or share them. `C2C_ZOHO_URL` can override the default URL. The WorkDrive account email used to select the matching C2C user is configured with `ZOHO_NATIVE_EMAIL` or `ZOHO_NATIVE_USERNAME`. WorkDrive API access uses Zoho OAuth and does not use a WorkDrive account password.

The Zoho Native backup test uses OAuth to find the My Folders root from the authenticated user's ZUID and create a uniquely named folder. It then signs in to C2C at `http://217.68.147.125/auth/sign-in`, backs up the matching native user, and verifies that folder appears in the completed snapshot. OAuth setup requires a Zoho **Server-based** application with this authorized redirect URI: `http://localhost:43127/oauth/callback`. The requested scopes are `WorkDrive.files.CREATE`, `WorkDrive.files.READ`, `WorkDrive.team.READ`, `WorkDrive.teamfolders.READ`, and `AaaServer.profile.READ`. `ZOHO_WORKDRIVE_TEAM_ID` must identify the WorkDrive team whose My Folders root and Team Folders you want to use; by default, this is the team shown in the supplied WorkDrive URL. If the configured team is not available to the authorized account, the test stops instead of silently creating content in another team. The test resolves the My Folders ID through Zoho's [documented API flow](https://www.zoho.com/workdrive/developer/docs/api/v1/getting-started-fetching-ids.html).

### Backup flow by file

1. `test-settings.ts` loads regional URLs, the selected WorkDrive account/team, OAuth client settings, and C2C sign-in credentials. Secrets can come from environment variables or ignored files under `.auth/`.
2. `tests/api/drive/zoho-native-auth.spec.ts` is an opt-in, headed setup step. API implementations live under `pages/<product>/api/`; their tests live under `tests/api/<product>/`. `pages/drive/api/zoho-workdrive.api.ts` receives the OAuth callback, exchanges its one-time code, and saves the refresh token locally. Normal backups do not open this consent flow.
3. `tests/test_backup.spec.ts` contains the serial Drive, Contacts, Calendar, Team Folder, and Mail backup-and-comparison suite. `tests/test_Export.spec.ts` contains export tests, and `tests/test_Restore.spec.ts` contains live Contacts restore workflows.
4. Product modules are grouped under `pages/<product>/`: Zoho clients and their setup specs live in `api/`, workflow setup helpers are TypeScript files inside their workflow folders (for example `backup/drive_backup_config.ts` and `restore/contacts_restore_config.ts`), and implemented workflows live in `backup/`, `restore/`, or `export/`. Each backup workflow has one page, assertions (including comparison helpers), locators, labels, and config module. Workflow specs live under `tests/`. `pages/sign-in.page.ts` and `pages/recovery.page.ts` provide shared C2C navigation.
5. `tests/api/drive/zoho-workdrive.api.spec.ts` tests token handling, folder-root resolution, team selection, and OAuth error cases with mocked HTTP responses; it does not contact Zoho.

### Zoho Contacts backup and new-folder restore

The Contacts POM is in `pages/contacts/restore/`. The opt-in backup-and-restore test in `tests/test_Restore.spec.ts` uses the Contacts OAuth setup below, not CRM. It verifies that the OAuth account matches `ZOHO_NATIVE_EMAIL` (or `ZOHO_NATIVE_USERNAME`), captures the native contacts and existing category IDs, triggers a C2C Contacts backup, waits for completion, checks that source content did not change during backup, and verifies the latest C2C snapshot count matches the captured source. `restoreToNewFolder()` calls the separate `startC2cNewFolderRestore()` method to select the user, whole snapshot, destination, and **New folder** mode and submit the restore. The wrapper then waits for a completed C2C restore-history entry. Native OAuth checks remain separate from the C2C UI action.

Verification requires a newly created category ID named `Restored Contacts YYYY-MM-DD HH:mm`, with its UTC minute timestamp inside the restore execution window. Its count and contact-content checksum must match the captured source. Names, emails, phones, addresses, URLs, IMs, notes, birthdays, and company/job details are compared; generated IDs/timestamps and category membership are excluded. The test stops before backup if the account is empty, fails on concurrent/ambiguous restores, and polls OAuth for eventual consistency. It never creates or deletes source contacts as fixtures.

The consolidated live backup-and-comparison suite captures the existing native Zoho Contacts before signing in to C2C, prints their names, email addresses, phone numbers, and IDs to the test output, runs one Contacts backup, verifies the source did not change during backup, and compares visible contact fields in the snapshot. Test output contains personal contact data; keep it private. The test does not create or modify Zoho Contacts. The Contacts OAuth token needs `zohocontacts.contactapi.READ` access:

If a Contacts backup fails, the automation opens the matching Activity Logs job and prints its job details, including the backend error message, to the console before failing the test.

```powershell
$env:RUN_ZOHO_BACKUP_SUITE = '1'
try {
    npx.cmd playwright test tests/test_backup.spec.ts --grep "Contacts:" --headed --workers=1
} finally {
    Remove-Item Env:RUN_ZOHO_BACKUP_SUITE -ErrorAction SilentlyContinue
}
```

To run the separate live backup-and-restore case, set `RUN_ZOHO_CONTACTS_RESTORE=1` and run:

```powershell
$env:RUN_ZOHO_CONTACTS_RESTORE = '1'
try {
    npx.cmd playwright test tests/test_Restore.spec.ts --grep "backs up Zoho Contacts" --headed --workers=1
} finally {
    Remove-Item Env:RUN_ZOHO_CONTACTS_RESTORE -ErrorAction SilentlyContinue
}
```

The Team Folder flow uses the configured Zoho WorkDrive team and lists its Team Folders with `WorkDrive.teamfolders.READ`. For each active Team Folder, the live test creates a uniquely named folder containing one `.txt` file and one `.png` image using `WorkDrive.files.CREATE`, starts the C2C backup, and compares the complete Zoho and C2C inventories, including the created folder and files. These test items remain in Zoho. The standard OAuth scopes listed above include both permissions; rerun the existing WorkDrive OAuth setup test once to refresh `.auth/zoho-workdrive-oauth.json` if the token lacks them.

Team Folder API reads and WorkDrive token refresh retry transient connection resets/timeouts up to three attempts, with a 30-second timeout per attempt and logged 1- and 2-second retry delays. Persistent failures report the endpoint and retain the original error cause. HTTP errors and invalid JSON are not retried; folder creation, uploads, and OAuth authorization-code exchange are not automatically retried.

```powershell
$env:SETUP_ZOHO_WORKDRIVE_OAUTH = '1'
try {
    npx.cmd playwright test tests/api/drive/zoho-native-auth.spec.ts --headed --workers=1
} finally {
    Remove-Item Env:SETUP_ZOHO_WORKDRIVE_OAUTH -ErrorAction SilentlyContinue
}
```

The consolidated live suite runs the all-team backup and comparison:

```powershell
$env:RUN_ZOHO_BACKUP_SUITE = '1'
try {
    npx.cmd playwright test tests/test_backup.spec.ts --grep "Team Folders:" --headed --workers=1
} finally {
    Remove-Item Env:RUN_ZOHO_BACKUP_SUITE -ErrorAction SilentlyContinue
}
```

The live test is disabled by default because C2C creates a backup and writes restored contacts to the selected Zoho Contacts account. OAuth is read-only and used only to capture and verify data; C2C performs the restore. Existing folders are retained.

### Restore only from the existing C2C Contacts snapshot

The restore-only case in `tests/test_Restore.spec.ts` does not start a backup or compare against the current native Zoho contact list. It reads every page of the latest existing C2C snapshot, calls `restoreToNewFolder()` (which uses `startC2cNewFolderRestore()`), selects whole-snapshot and New folder mode, handles a restore confirmation if shown, and waits for completion. It verifies a new UTC-timestamped Zoho category through OAuth and compares its contact count and Name/Email/Phone values against C2C, preserving duplicate rows. This checks only the fields exposed by the C2C snapshot table, not a full native-field checksum. Extra or missing contacts fail verification. It leaves existing data and restore folders intact.

```powershell
$env:RUN_ZOHO_CONTACTS_RESTORE_ONLY = '1'
try {
    npx.cmd playwright test tests/test_Restore.spec.ts --grep "restores the existing C2C Contacts snapshot" --headed --workers=1
} finally {
    Remove-Item Env:RUN_ZOHO_CONTACTS_RESTORE_ONLY -ErrorAction SilentlyContinue
}
```

The snapshot reader maps Name, Email, and Phone by column header, ignoring the selection-checkbox column, and reads all pages.

### Zoho Contacts app list

The Contacts app shown in Zoho Workplace is separate from Zoho CRM. Authorize the Zoho Contacts API with the `zohocontacts.contactapi.READ` scope. Add `http://localhost:43129/oauth/callback` to the server-based OAuth client's authorized redirect URIs, keeping any existing WorkDrive redirect URIs.

The Contacts setup saves a separate token to `.auth/zoho-contacts-oauth.json`; it does not overwrite the WorkDrive or CRM tokens. Reuse the OAuth client credentials from the WorkDrive token file locally, then approve Contacts read access in the opened browser:

```powershell
$wd = Get-Content -Raw '.auth\zoho-workdrive-oauth.json' | ConvertFrom-Json
$env:ZOHO_CONTACTS_CLIENT_ID = $wd.clientId
$env:ZOHO_CONTACTS_CLIENT_SECRET = $wd.clientSecret
$env:SETUP_ZOHO_CONTACTS_OAUTH = '1'
try {
    npx.cmd playwright test tests/api/contacts/zoho-contacts-auth.spec.ts --headed --workers=1
} finally {
    Remove-Item Env:SETUP_ZOHO_CONTACTS_OAUTH, Env:ZOHO_CONTACTS_CLIENT_ID, Env:ZOHO_CONTACTS_CLIENT_SECRET -ErrorAction SilentlyContinue
}
```

After authorization, list contacts with:

```powershell
$env:LIST_ZOHO_CONTACTS = '1'
try {
    npx.cmd playwright test tests/api/contacts/zoho-contacts.api.spec.ts --workers=1
} finally {
    Remove-Item Env:LIST_ZOHO_CONTACTS -ErrorAction SilentlyContinue
}
```

This uses OAuth with the Zoho Contacts API (`contacts.zoho.in` by default), not CRM or browser-session cookies. The test prints all category names, IDs, and counts, including empty IDrive Restore and Restored Contacts categories, followed by each folder's contacts and the full personal contacts list. It uses `/accounts/self/categories?include=contacts.total_count` and `/accounts/self/contacts?filter_categories=<category_id>&include=emails,phones,categories`, requesting 100 records per page and following `has_more`. A contact can appear in multiple categories. Folder membership totals must match the reported category counts; concurrent changes cause an explicit error. The personal listing checks `/accounts/self/contacts?fields=count` first, since an empty account can return API status 404 for the list endpoint. Only an explicit zero count is treated as empty; API errors still fail the test. See the [contact parameters](https://www.zoho.com/contacts/api/parameters.html) and [category counts](https://www.zoho.com/contacts/api/get-all-categories.html).

To run only the Drive backup and comparison:

```powershell
$env:RUN_ZOHO_BACKUP_SUITE = '1'
try {
    npx.cmd playwright test tests/test_backup.spec.ts --grep "Drive:" --headed --workers=1
} finally {
    Remove-Item Env:RUN_ZOHO_BACKUP_SUITE -ErrorAction SilentlyContinue
}
```

The Drive case creates a uniquely named folder and file, starts the C2C backup, and compares the resulting snapshot with WorkDrive.

To run all five product exports in order, continuing with the next product if any test fails:

```powershell
$env:RUN_ZOHO_EXPORT_SUITE = '1'
try {
    npx.cmd playwright test test_Export.spec.ts --grep "Zoho export suite" --headed --workers=1 --max-failures=0 --output ".\test-results-all-exports"
} finally {
    Remove-Item Env:RUN_ZOHO_EXPORT_SUITE -ErrorAction SilentlyContinue
}
```

Each product test has an independent browser context. Failures (including checksum mismatches) remain failures and give the overall run a failing exit code, but do not skip later product tests. Team Folder also attempts the remaining teams before reporting its collected failures.

To export a random count of one to three distinct real folders (limited by availability) from all root-level pages of the latest C2C Drive snapshot, then wait for the export job to reach **Active** (a **Failed** job fails the test), run:

```powershell
$env:RUN_ZOHO_EXPORT_SUITE = '1'
try {
    npx.cmd playwright test tests/test_Export.spec.ts --grep "Drive export:" --headed --workers=1
} finally {
    Remove-Item Env:RUN_ZOHO_EXPORT_SUITE -ErrorAction SilentlyContinue
}
```

The export case uses the existing snapshot for the configured native user and does not start a new backup. After the job is **Active** it downloads the ZIP from the Exports tab to `~/Downloads/ZohoDriveExportInspection`, checks that every selected item is in the ZIP, then downloads the matching files from WorkDrive and compares byte lengths and SHA-256 checksums. The console reports both checksums for each verified file. Selected folders are compared recursively; missing, extra and different files are listed in a table and fail the test. The ZIP's top-level prefix is tolerated, since its layout is not fixed.

WorkDrive folder listings and original-file downloads retry transient transport failures up to three attempts, including interrupted response bodies, with one- and two-second delays. HTTP errors are not retried. Exhausted retries fail verification explicitly; a failed original download never counts as a checksum match.

Verification logs have two stages: **1/2** lists each selected C2C item and its descendants with matching downloaded name/path/type; **2/2** reports downloaded versus Zoho byte lengths and SHA-256 checksums. Missing or mismatched C2C items fail before checksum verification; folder entries may be inferred from ZIP descendant paths.

Drive and Team Folder snapshot inventories read DOM text content rather than rendered text so repeated spaces in file and folder names are preserved. Path comparisons do not collapse whitespace, and actual renamed files still fail.

The export collects root-level candidates across pages, but scans C2C descendants only inside the selected folders, not every folder in the snapshot. Live Zoho Drive verification also lists the root only to resolve the selected names, then recursively reads only those selected folders and downloads their originals. Unselected folders are not traversed. Missing or ambiguous source roots fail explicitly. Full Drive inventory scans remain available for backup comparisons.

In headed Chromium, the Drive export also checks Chrome's Downloads page and clicks **Keep** if the new ZIP is blocked as an insecure download. Existing downloads and other warning types are not accepted automatically. Browser security settings are not disabled. The shared downloader checks the C2C download-link API response and fails immediately if it returns an HTTP error, unsuccessful response, or a URL without a ZIP object path (for example a bucket-only URL), even when export history says ACTIVE. Signed download URLs are not logged.

### Team Folder exports

The [Team Folder export POM](pages/team-folder/export/team-folder-export.page.ts) has its own page, locators, labels, assertions and setup configuration. It reuses the WorkDrive export workflow for download handling and content verification.

The live test matches all C2C teams with Zoho, then visits every team and exports a random count of one to three distinct folders from its root snapshot pages. Only selected folders are scanned recursively. Each downloaded ZIP is checked against C2C names/paths/types and against that team's Zoho inventory and original-file sizes/SHA-256 checksums. No backup or fixture creation is performed.

Archives are saved under `~/Downloads/ZohoTeamFolderExportInspection/team-<Zoho team folder ID>`. Teams without selectable folders are explicitly reported as skipped. Other failures are recorded while remaining teams are attempted, then fail the test. A run with no verified exports also fails.

```powershell
$env:RUN_ZOHO_EXPORT_SUITE = '1'
try {
    npx.cmd playwright test test_Export.spec.ts --grep "Team Folder export:" --headed --workers=1 --output ".\test-results-team-folder-export"
} finally {
    Remove-Item Env:RUN_ZOHO_EXPORT_SUITE -ErrorAction SilentlyContinue
}
```

### Contacts exports

The [Contacts export POM](pages/contacts/export/contacts-export.page.ts) has separate page, locators, labels, assertions and setup modules. It selects one to three distinct real contacts from a random snapshot page, exports **Selected Items** as **VCF (vCard)**, waits for the new job to be **COMPLETED / ACTIVE**, and saves its ZIP under `~/Downloads/ZohoContactsExportInspection`. It does not create contacts or start a backup.

Verification **1/2** checks the downloaded count and each selected C2C contact's name, email and phone, consuming matching records individually so duplicate contacts cannot hide missing records. Verification **2/2** compares SHA-256 checksums of canonical name, all email addresses and all phone numbers against the authenticated Zoho account, consuming one matching source record per downloaded contact. Identical source contacts are allowed, but each can only satisfy one downloaded record; same-name contacts with different fields cannot satisfy a checksum match. This is a checksum of those contact fields, not of the raw VCF or of unexported metadata. `NA` UI placeholders are treated as empty and email casing/order is normalized; names and phone values must otherwise match. Extra/missing records, unreadable exports and field/checksum mismatches fail the test.

The Contacts, Drive and Team Folder workflows share ZIP download handling, including optional Chrome **Keep** for a newly blocked insecure ZIP. Existing Contacts exports were used to validate the VCF parser; no synthetic contact fixtures are used by the live test.

```powershell
$env:RUN_ZOHO_EXPORT_SUITE = '1'
try {
    npx.cmd playwright test test_Export.spec.ts --grep "Contacts export:" --headed --workers=1 --output ".\test-results-contacts-export"
} finally {
    Remove-Item Env:RUN_ZOHO_EXPORT_SUITE -ErrorAction SilentlyContinue
}
```

### Calendar exports

The [Calendar export POM](pages/calendar/export/calendar-export.page.ts) has separate page, locators, labels, assertions and setup modules. It selects a random nonempty calendar from the latest C2C snapshot, chooses a random event page, and exports one to three real events without creating events or starting a backup. Only calendar-list pages and the selected event page are read, not the full event inventory.

The new Selection job must reach COMPLETED/ACTIVE. Its ZIP is saved to `~/Downloads/ZohoCalendarExportInspection`, using the shared optional Chrome Keep handling. `.ics` and `.ical` documents are parsed with timezone, folded-line, all-day and recurrence support.

Verification **1/2** checks exact selected/downloaded counts, calendar name, title, organizer and creation timestamp, preserving duplicate rows. C2C's **Start** column is compared to ICS **CREATED**, not the event's scheduled DTSTART. Verification **2/2** fetches only the corresponding live Zoho event UIDs and compares canonical SHA-256 values for UID, title, organizer email, scheduled start/end, all-day flag, description, location, attendee emails, recurrence rule, recurrence ID and exclusion dates. This is a field-data checksum, not a byte-for-byte ICS checksum; generated DTSTAMP, alarms, attendee response states, attachments and other metadata are outside its scope. Missing originals, ambiguous calendar identities, unsupported field formats and any checksum mismatch fail explicitly.

Calendar names containing `/` appear with `_` in archive filenames. Verification accounts for this filename transformation when matching C2C and live Zoho calendars; ambiguous source matches still fail rather than guessing.

Logs include selected calendar/page/events, export status transitions, elapsed times, ZIP path/size, C2C comparisons, source UIDs, scheduled times, both checksums and differing field names. Description and location contents are redacted from mismatch logs; authentication tokens and attachment contents are never logged. Existing Calendar OAuth read access is required.

```powershell
$env:RUN_ZOHO_EXPORT_SUITE = '1'
try {
    npx.cmd playwright test test_Export.spec.ts --grep "Calendar export:" --headed --workers=1 --output ".\test-results-calendar-export"
} finally {
    Remove-Item Env:RUN_ZOHO_EXPORT_SUITE -ErrorAction SilentlyContinue
}
```

### WorkDrive OAuth setup

All export workflows print timestamped stage logs for the user/team, selection, export-history status changes, local ZIP path/byte count, verification counts and final duration. Detailed comparison tables show expected/downloaded fields and SHA-256 results. Mail logs additionally show exported and candidate Zoho Message-IDs, dates and MIME byte lengths to distinguish missing messages from changed bytes. Contacts checksum failures show same-name source candidates. Message bodies, attachment contents and authentication tokens are not logged. Status changes are logged rather than repeating every poll; a mismatch remains a test failure.

Set the OAuth app's real client ID, client secret, and team ID in the current PowerShell session. The team ID is the first segment of the WorkDrive URL (for example, the segment before `/privatespace`); replace every example with the actual value and do not type the example text literally. Then run the one-time consent flow. Sign in to Zoho and approve the requested access in the opened browser:

```powershell
$env:ZOHO_WORKDRIVE_CLIENT_ID = '<Zoho client ID>'
$env:ZOHO_WORKDRIVE_CLIENT_SECRET = '<Zoho client secret>'
$env:SETUP_ZOHO_WORKDRIVE_OAUTH = '1'
npx.cmd playwright test tests/api/drive/zoho-native-auth.spec.ts --headed --workers=1
Remove-Item Env:SETUP_ZOHO_WORKDRIVE_OAUTH
```

Complete consent using the Zoho account whose email matches `ZOHO_NATIVE_EMAIL`; OAuth sends this as a login hint to make account switching easier, but confirm the correct account in the browser before approving. The refresh token and OAuth client settings are stored locally in `.auth/zoho-workdrive-oauth.json` (git-ignored) so later Playwright invocations can refresh the token without environment variables. Keep this file private and never commit or share it. If Zoho does not return a refresh token but returns an expiring access token, setup saves that token for immediate use; rerun consent after it expires to obtain a refresh token. To switch accounts, set `ZOHO_NATIVE_EMAIL` to the new account and rerun OAuth setup; do not delete the existing token file until setup succeeds. If Zoho returns neither a refresh token nor an expiring access token, setup fails and leaves the existing token untouched rather than silently reusing credentials for the previous account; inspect any OAuth error reported, and confirm the selected account, Server-based client, redirect URI, and regional Accounts URL. Subsequent backup runs resolve the parent ID without opening WorkDrive's sign-in page. For accounts outside Zoho's India data center, set `ZOHO_WORKDRIVE_ACCOUNTS_URL` and `ZOHO_WORKDRIVE_API_URL` to the appropriate regional endpoints.

### Zoho Mail backup and C2C comparison

Mail uses a separate OAuth token at `.auth/zoho-mail-oauth.json`. Configure a Zoho Server-based OAuth client with the existing Contacts callback URI `http://localhost:43129/oauth/callback` and the scopes `ZohoMail.accounts.READ`, `ZohoMail.folders.READ`, `ZohoMail.messages.READ`, and `ZohoMail.messages.CREATE`. The live backup test sends one uniquely named plain-text test email from the configured native Zoho Mail account (default `c2c@idrive.com`) to `ajay@idriveedge.com` before signing into C2C. Override the destination with `ZOHO_MAIL_TEST_RECIPIENT` if needed. Set `ZOHO_MAIL_CLIENT_ID` and `ZOHO_MAIL_CLIENT_SECRET`, or reuse the Contacts client values through `ZOHO_CONTACTS_CLIENT_ID` and `ZOHO_CONTACTS_CLIENT_SECRET`. Set `ZOHO_MAIL_REDIRECT_URI` or `ZOHO_MAIL_API_URL` only when using a different callback or Zoho data center.

Run the one-time headed consent flow, sign in to the Zoho account matching `ZOHO_NATIVE_EMAIL`, and approve the requested account, folder, and message read/create access. Existing read-only tokens must be reauthorized before the send step can run:

```powershell
$env:SETUP_ZOHO_MAIL_OAUTH = '1'
try {
    npx.cmd playwright test tests/api/mail/zoho-mail-auth.spec.ts --headed --workers=1
} finally {
    Remove-Item Env:SETUP_ZOHO_MAIL_OAUTH -ErrorAction SilentlyContinue
}
```

To run only the Mail backup and comparison:

```powershell
$env:RUN_ZOHO_BACKUP_SUITE = '1'
try {
    npx.cmd playwright test tests/test_backup.spec.ts --grep "Mail:" --headed --workers=1
} finally {
    Remove-Item Env:RUN_ZOHO_BACKUP_SUITE -ErrorAction SilentlyContinue
}
```

The comparison checks all folder paths and message sender, recipient, subject, and rounded-size metadata against Zoho Mail. It does not retrieve or compare message bodies because the C2C snapshot table exposes metadata only. The test intentionally sends one uniquely tagged test email to the configured native account; it does not otherwise modify Zoho Mail.

To select one to three real messages from a random C2C Inbox snapshot page, export the selected items as **ZIP Archive**, download after **COMPLETED / ACTIVE**, and verify the EML files against C2C and Zoho, run:

```powershell
$env:RUN_ZOHO_EXPORT_SUITE = '1'
try {
    npx.cmd playwright test tests/test_Export.spec.ts --grep "Mail export:" --headed --workers=1
} finally {
    Remove-Item Env:RUN_ZOHO_EXPORT_SUITE -ErrorAction SilentlyContinue
}
```

The [Mail export POM](pages/mail/export/mail-export.page.ts) has its own page, labels, locators, assertions and setup configuration. It uses the existing snapshot and does not send messages or start a backup. Verification **1/2** checks exact selected/downloaded counts and duplicate-aware From/To/Subject matches against C2C. Verification **2/2** retrieves candidate original MIME messages using Zoho's `originalmessage` API and compares raw EML SHA-256, covering headers, body and encoded attachments. Each matching Zoho record is consumed once, so duplicate headers are allowed without reusing one original for multiple exported messages. Missing messages or any checksum mismatch fail. Raw checksum verification is strict: even byte-level MIME serialization differences fail rather than being silently normalized. Downloads are saved under `~/Downloads/ZohoMailExportInspection`, with shared optional Chrome **Keep** handling.

### Zoho Calendar backup and C2C comparison

Calendar uses its own OAuth token at `.auth/zoho-calendar-oauth.json`. Configure a Zoho Server-based OAuth client with `http://localhost:43132/oauth/callback` and the scopes `ZohoCalendar.calendar.READ`, `ZohoCalendar.event.READ`, and `ZohoCalendar.event.CREATE`. The live backup test creates one uniquely named event in the first native calendar, invites `ajay@idriveedge.com` by default (override with `ZOHO_CALENDAR_TEST_ATTENDEE`), and requests attendee notification before signing in to C2C; it then backs up Calendar and compares the event inventory. Reauthorize existing read-only tokens to grant event creation. Set `ZOHO_CALENDAR_CLIENT_ID` and `ZOHO_CALENDAR_CLIENT_SECRET`, or reuse client credentials saved in `.auth/zoho-contacts-oauth.json`.

Run the one-time headed consent flow for the account matching `ZOHO_NATIVE_EMAIL`:

```powershell
$env:SETUP_ZOHO_CALENDAR_OAUTH = '1'
try {
    npx.cmd playwright test tests/api/calendar/zoho-calendar-auth.spec.ts --headed --workers=1
} finally {
    Remove-Item Env:SETUP_ZOHO_CALENDAR_OAUTH -ErrorAction SilentlyContinue
}
```

To run only the Calendar backup and comparison:

```powershell
$env:RUN_ZOHO_BACKUP_SUITE = '1'
try {
    npx.cmd playwright test tests/test_backup.spec.ts --grep "Calendar:" --headed --workers=1
} finally {
    Remove-Item Env:RUN_ZOHO_BACKUP_SUITE -ErrorAction SilentlyContinue
}
```

After selecting the C2C user, the comparison opens each calendar folder and reads all event pages inside it, including empty folders and folders with duplicate names. Zoho Calendar's API separately lists the user's calendars and reads events from each calendar. The report pairs folders and API calendars by normalized name, then compares title and start time only within that pair; it also reports folders or API calendars with no matching name. Organizer is reported but is not used as a key because C2C displays a person name while the API may return an email address. The API requests calendars across all categories, including hidden calendars, and keeps recurring events as their event records (`byinstance=false`) rather than expanding each recurrence into separate instances. Zoho limits each event-list request to a 31-day range, so it requests events in consecutive 30-day windows across the snapshot's earliest-to-latest start dates. Zoho excludes each request's end boundary, so consecutive windows meet at that boundary and the final request extends one second beyond the inclusive comparison end. UTC range boundaries include the required `Z` suffix, and event start values prefer Zoho's timezone-qualified `dateandtime.start`. To audit a wider date span, set both `ZOHO_CALENDAR_RANGE_START` and `ZOHO_CALENDAR_RANGE_END` (ISO date or datetime values). The comparison reads metadata only and does not modify Calendar data.

### Consolidated live backup and comparison suite

Run the Drive, Contacts, Calendar, Team Folder, and Mail backup-and-comparison workflows in order from one spec. Each product backup completes before its snapshot is compared with the corresponding Zoho API inventory. The suite is serial and opt-in because it starts live C2C backup jobs; Drive also creates a uniquely named test folder and file in WorkDrive.

```powershell
$env:RUN_ZOHO_BACKUP_SUITE = '1'
try {
    npx.cmd playwright test tests/test_backup.spec.ts --headed --workers=1
} finally {
    Remove-Item Env:RUN_ZOHO_BACKUP_SUITE -ErrorAction SilentlyContinue
}
```
