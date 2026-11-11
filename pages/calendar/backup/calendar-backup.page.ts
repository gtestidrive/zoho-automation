import { expect, type Locator, type Page } from '@playwright/test';
import {
  type ZohoCalendarApi,
  type ZohoCalendarEvent,
  type ZohoCalendarTestEvent,
} from '../api/zoho-calendar.api';
import { testSettings } from '../../../test-settings';
import { CalendarBackupAssertions } from './calendar-backup.assertions';
import { CalendarBackupLocators } from './calendar-backup.locators';
import { calendarBackupLabels, calendarBackupPatterns } from './calendar-backup.labels';

export type CalendarBackupUser = {
  name: string;
  email: string;
};

export type CalendarBackupState = {
  timestamp: string;
  status: string;
  totalCount: number;
};

export type CalendarSnapshotEvent = Pick<ZohoCalendarEvent, 'calendarName' | 'title' | 'organizer' | 'start'>;

export type CalendarSnapshot = {
  folderNames: string[];
  events: CalendarSnapshotEvent[];
};

type C2CCalendarFolder = {
  name: string;
  organizer: string;
  start: string;
  occurrence: number;
};

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

export class CalendarBackupPage {
  private readonly assertions = new CalendarBackupAssertions();
  private readonly locators: CalendarBackupLocators;
  private readonly usersTab: Locator;
  private readonly backupsTab: Locator;
  private readonly usersPanel: Locator;
  private readonly backupsPanel: Locator;
  private readonly usersTable: Locator;
  private readonly backupNowButton: Locator;
  private readonly notifications: Locator;

  constructor(private readonly page: Page) {
    this.locators = new CalendarBackupLocators(page);
    this.usersTab = this.locators.usersTab;
    this.backupsTab = this.locators.backupsTab;
    this.usersPanel = this.locators.usersPanel;
    this.backupsPanel = this.locators.backupsPanel;
    this.usersTable = this.locators.usersTable;
    this.backupNowButton = this.locators.backupNowButton;
    this.notifications = this.locators.notifications;
  }

  async createNativeTestEvent(calendarApi: ZohoCalendarApi): Promise<ZohoCalendarTestEvent> {
    return calendarApi.createTestEvent(testSettings.zohoCalendar.testAttendeeEmail);
  }

  async expectSnapshotMatchesNativeCalendar(
    calendarApi: ZohoCalendarApi,
    snapshot: CalendarSnapshot,
    testEvent: ZohoCalendarTestEvent,
  ): Promise<void> {
    await this.assertions.expectSnapshotMatchesNativeCalendar(
      calendarApi,
      snapshot,
      testEvent,
      testSettings.zohoCalendar.rangeStart,
      testSettings.zohoCalendar.rangeEnd,
    );
  }

  async selectUser(email: string): Promise<CalendarBackupUser> {
    const normalizedEmail = email.trim();
    await this.usersTab.click();
    const allUsers = this.usersPanel.getByRole('button', { name: calendarBackupLabels.allUsers });
    if (await allUsers.isVisible()) {
      await allUsers.click();
    }
    const search = this.usersPanel.getByRole('searchbox', { name: calendarBackupLabels.searchUsers });
    await search.fill(normalizedEmail);
    await expect(this.usersPanel.getByText(calendarBackupLabels.loading, { exact: true })).toBeHidden({ timeout: 30_000 });

    const row = this.usersTable.getByRole('row').nth(1);
    const cells = row.getByRole('cell');
    await expect(cells.nth(1)).toHaveText(normalizedEmail, { timeout: 30_000 });
    const name = (await cells.nth(0).innerText()).trim();
    if (!name) {
      throw new Error(`Calendar user ${normalizedEmail} has no display name.`);
    }
    await row.getByText(name, { exact: true }).click();
    await expect(this.backupNowButton).toBeVisible({ timeout: 30_000 });
    return { name, email: normalizedEmail };
  }

  async startBackupAndWait(email: string): Promise<CalendarBackupState> {
    const user = await this.selectUser(email);
    const previous = await this.readLatestBackup(user);
    await this.selectUser(email);
    log(`[Zoho C2C Calendar] Starting backup for ${user.email}.`);
    await this.backupNowButton.click();
    await expect(this.notifications).toContainText(calendarBackupPatterns.backupInProgress, { timeout: 15_000 });

    let latest = previous;
    let lastStatus = '';
    await expect.poll(async () => {
      latest = await this.readLatestBackup(user);
      if (latest.status !== lastStatus) {
        log(`[Zoho C2C Calendar] Backup history status: ${latest.status || 'no entry yet'}.`);
        lastStatus = latest.status;
      }
      const isNewBackup = latest.timestamp !== previous.timestamp || latest.totalCount > previous.totalCount;
      if (isNewBackup && /fail|error/i.test(latest.status)) {
        throw new Error(`Calendar backup failed for ${user.email}: ${latest.status}.`);
      }
      return isNewBackup && latest.status === 'Completed';
    }, { timeout: 10 * 60_000, intervals: [5_000] }).toBe(true);

    log(`[Zoho C2C Calendar] Backup completed for ${user.email} at ${latest.timestamp}.`);
    return latest;
  }

  async readSnapshot(email: string): Promise<CalendarSnapshot> {
    await this.selectUser(email);
    const events: CalendarSnapshotEvent[] = [];
    const folders = await this.listCalendarFolders();
    log(`[Zoho C2C Calendar] Found ${folders.length} calendar folder(s) for ${email}.`);

    for (const folder of folders) {
      await this.returnToFirstCalendarPage();
      const row = await this.findCalendarFolderRow(folder);
      if (!row) {
        throw new Error(`Could not find C2C Calendar folder "${folder.name}" (occurrence ${folder.occurrence + 1}).`);
      }
      const table = this.usersPanel.getByRole('table').last();
      const nameColumn = await this.columnIndexFromTable(table, 'Name');
      const previousContents = await table.innerText();
      await row.getByRole('cell').nth(nameColumn).click();
      await expect.poll(async () => await table.innerText()).not.toBe(previousContents);
      log(`[Zoho C2C Calendar] Opened "${folder.name}"${folder.occurrence ? ` (${folder.occurrence + 1})` : ''}.`);

      const folderEvents = await this.readCurrentFolderEvents(folder.name);
      events.push(...folderEvents);
      log(`[Zoho C2C Calendar] "${folder.name}" contains ${folderEvents.length} event row(s).`);
      await this.returnToCalendarList(folder.name);
    }

    log(`[Zoho C2C Calendar] Snapshot contains ${events.length} event rows across ${folders.length} calendar folders.`);
    return {
      folderNames: folders.map((folder) => folder.name),
      events,
    };
  }

  private async listCalendarFolders(): Promise<C2CCalendarFolder[]> {
    const table = this.usersPanel.getByRole('table').last();
    const range = this.usersPanel.getByText(/\d+\s*[–-]\s*\d+\s+of\s+\d+/).last();
    const folders: C2CCalendarFolder[] = [];
    const occurrences = new Map<string, number>();

    for (;;) {
      await expect(table).toBeVisible();
      await expect(range).toBeVisible();
      await expect(this.usersPanel.getByText('Loading...', { exact: true })).toBeHidden({ timeout: 30_000 });
      const headers = (await table.getByRole('columnheader').allInnerTexts()).map((value) => value.trim());
      const nameColumn = this.columnIndex(headers, 'Name');
      const organizerColumn = this.columnIndex(headers, 'Organizer');
      const startColumn = this.columnIndex(headers, 'Start');
      const rows = table.getByRole('row');
      for (let index = 1; index < await rows.count(); index++) {
        const cells = await rows.nth(index).getByRole('cell').allInnerTexts();
        if (cells.length !== headers.length) {
          throw new Error(`C2C Calendar folder row has ${cells.length} cells for ${headers.length} columns.`);
        }
        const name = cells[nameColumn]?.trim() ?? '';
        if (!name || /no (?:calendar|folder)s? found/i.test(name)) {
          continue;
        }

        const organizer = cells[organizerColumn]?.trim() ?? '';
        const start = cells[startColumn]?.trim() ?? '';
        const signature = JSON.stringify([name.toLowerCase(), organizer.toLowerCase(), start]);
        const occurrence = occurrences.get(signature) ?? 0;
        occurrences.set(signature, occurrence + 1);
        folders.push({ name, organizer, start, occurrence });
      }

      const next = this.usersPanel.getByRole('button', { name: 'Next page', exact: true });
      if (await next.isDisabled()) {
        break;
      }
      const currentRange = await range.innerText();
      await next.click();
      await expect(range).not.toHaveText(currentRange);
    }
    return folders;
  }

  private async readCurrentFolderEvents(calendarName: string): Promise<CalendarSnapshotEvent[]> {
    const table = this.usersPanel.getByRole('table').last();
    const range = this.usersPanel.getByText(/\d+\s*[–-]\s*\d+\s+of\s+\d+/).last();
    const events: CalendarSnapshotEvent[] = [];
    for (;;) {
      await expect(table).toBeVisible();
      await expect(range).toBeVisible();
      await expect(this.usersPanel.getByText('Loading...', { exact: true })).toBeHidden({ timeout: 30_000 });
      const headers = (await table.getByRole('columnheader').allInnerTexts()).map((value) => value.trim());
      const nameColumn = this.columnIndex(headers, 'Name');
      const organizerColumn = this.columnIndex(headers, 'Organizer');
      const startColumn = this.columnIndex(headers, 'Start');
      const rows = table.getByRole('row');
      for (let index = 1; index < await rows.count(); index++) {
        const cells = await rows.nth(index).getByRole('cell').allInnerTexts();
        if (cells.some((cell) => /no events found/i.test(cell.trim()))) {
          continue;
        }
        if (cells.length !== headers.length) {
          throw new Error(`C2C Calendar event row has ${cells.length} cells for ${headers.length} columns.`);
        }
        const title = cells[nameColumn]?.trim() ?? '';
        const start = cells[startColumn]?.trim() ?? '';
        if (!title && !start && cells.every((cell) => !cell.trim())) {
          continue;
        }
        if (/no (?:calendar|event|folder)s? found/i.test(title)) {
          continue;
        }
        if (!title || !start) {
          throw new Error(`C2C Calendar event row is missing its name or start time: ${cells.join(' | ')}.`);
        }
        events.push({ calendarName, title, organizer: cells[organizerColumn]?.trim() ?? '', start });
      }
      const next = this.usersPanel.getByRole('button', { name: 'Next page', exact: true });
      if (await next.isDisabled()) {
        break;
      }
      const currentRange = await range.innerText();
      await next.click();
      await expect(range).not.toHaveText(currentRange);
    }
    return events;
  }

  private async findCalendarFolderRow(folder: C2CCalendarFolder): Promise<Locator | undefined> {
    const table = this.usersPanel.getByRole('table').last();
    const range = this.usersPanel.getByText(/\d+\s*[–-]\s*\d+\s+of\s+\d+/).last();
    const signature = JSON.stringify([folder.name.toLowerCase(), folder.organizer.toLowerCase(), folder.start]);
    let occurrence = 0;
    for (;;) {
      await expect(range).toBeVisible();
      await expect(this.usersPanel.getByText('Loading...', { exact: true })).toBeHidden({ timeout: 30_000 });
      const headers = (await table.getByRole('columnheader').allInnerTexts()).map((value) => value.trim());
      const nameColumn = this.columnIndex(headers, 'Name');
      const organizerColumn = this.columnIndex(headers, 'Organizer');
      const startColumn = this.columnIndex(headers, 'Start');
      const rows = table.getByRole('row');
      for (let index = 1; index < await rows.count(); index++) {
        const row = rows.nth(index);
        const cells = await row.getByRole('cell').allInnerTexts();
        const rowSignature = JSON.stringify([
          cells[nameColumn]?.trim().toLowerCase() ?? '',
          cells[organizerColumn]?.trim().toLowerCase() ?? '',
          cells[startColumn]?.trim() ?? '',
        ]);
        if (rowSignature === signature) {
          if (occurrence === folder.occurrence) {
            return row;
          }
          occurrence += 1;
        }
      }
      const next = this.usersPanel.getByRole('button', { name: 'Next page', exact: true });
      if (await next.isDisabled()) {
        return undefined;
      }
      const currentRange = await range.innerText();
      await next.click();
      await expect(range).not.toHaveText(currentRange);
    }
  }

  private async returnToFirstCalendarPage(): Promise<void> {
    const range = this.usersPanel.getByText(/\d+\s*[–-]\s*\d+\s+of\s+\d+/).last();
    const previous = this.usersPanel.getByRole('button', { name: 'Previous page', exact: true });
    while (!(await previous.isDisabled())) {
      const currentRange = await range.innerText();
      await previous.click();
      await expect(range).not.toHaveText(currentRange);
      await expect(this.usersPanel.getByText('Loading...', { exact: true })).toBeHidden({ timeout: 30_000 });
    }
  }

  private async returnToCalendarList(folderName: string): Promise<void> {
    const backButton = this.usersPanel.getByRole('button', { name: /^(?:←\s*)?calendars$/i });
    if (await backButton.isVisible()) {
      await backButton.click();
    } else {
      const breadcrumbs = this.usersPanel.getByRole('navigation').last();
      const parentButton = breadcrumbs.getByRole('button', { name: folderName, exact: true });
      if (!(await parentButton.isVisible())) {
        throw new Error(`Could not return from C2C Calendar folder "${folderName}" to its calendar list.`);
      }
      await parentButton.click();
    }
    await expect(this.usersPanel.getByText('Loading...', { exact: true })).toBeHidden({ timeout: 30_000 });
    await expect(this.usersPanel.getByRole('table').last()).toBeVisible();
  }

  private async columnIndexFromTable(table: Locator, name: string): Promise<number> {
    const headers = (await table.getByRole('columnheader').allInnerTexts()).map((value) => value.trim());
    return this.columnIndex(headers, name);
  }

  private async readLatestBackup(user: CalendarBackupUser): Promise<CalendarBackupState> {
    await this.backupsTab.click();
    const selectedUser = this.backupsPanel.getByRole('button', { name: user.name, exact: true });
    if (!(await selectedUser.isVisible())) {
      await this.backupsPanel.getByRole('button', { name: 'Select User', exact: true }).click();
      await this.page.getByRole('option', { name: user.name, exact: true }).click();
    }
    await this.backupsPanel.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(this.backupsPanel.getByText('Loading...', { exact: true })).toBeHidden({ timeout: 30_000 });

    const rows = this.backupsPanel.getByRole('table').first().getByRole('row');
    const range = this.backupsPanel.getByText(/\d+\s*[–-]\s*\d+\s+of\s+\d+/);
    const total = Number((await range.innerText()).match(/of\s+(\d+)/)?.[1]);
    if (!Number.isSafeInteger(total)) {
      throw new Error('Could not read the Calendar backup history row count.');
    }
    for (let index = 1; index < await rows.count(); index++) {
      const cells = await rows.nth(index).getByRole('cell').allInnerTexts();
      if (cells[1]?.trim().toLowerCase() === user.email.toLowerCase()) {
        return { timestamp: cells[0]?.trim() ?? '', status: cells[2]?.trim() ?? '', totalCount: total };
      }
    }
    return { timestamp: '', status: '', totalCount: total };
  }

  private columnIndex(headers: string[], name: string): number {
    const index = headers.findIndex((header) => header.toLowerCase() === name.toLowerCase());
    if (index < 0 || headers.lastIndexOf(headers[index]) !== index) {
      throw new Error(`Expected exactly one "${name}" column in the C2C Calendar snapshot.`);
    }
    return index;
  }
}