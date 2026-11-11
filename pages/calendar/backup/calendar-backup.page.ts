import { expect, type Locator, type Page } from '@playwright/test';
import { testSettings } from '../../../test-settings';
import {
  type ZohoCalendarApi,
  type ZohoCalendarEvent,
  type ZohoCalendarTestEvent,
} from '../api/zoho-calendar.api';
import { CalendarBackupAssertions, calendarComparisonRange } from './calendar-backup.assertions';
import { calendarBackupPatterns } from './calendar-backup.labels';
import { CalendarBackupLocators } from './calendar-backup.locators';

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
  private readonly backupNowButton: Locator;
  private readonly notifications: Locator;

  constructor(private readonly page: Page) {
    this.locators = new CalendarBackupLocators(page);
    this.usersTab = this.locators.usersTab;
    this.backupsTab = this.locators.backupsTab;
    this.backupNowButton = this.locators.backupNowButton;
    this.notifications = this.locators.notifications;
  }

  async createNativeTestEvent(calendarApi: ZohoCalendarApi): Promise<ZohoCalendarTestEvent> {
    return calendarApi.createTestEvent(testSettings.zohoCalendar.testAttendeeEmail);
  }

  async compareSnapshotWithNativeCalendar(
    calendarApi: ZohoCalendarApi,
    snapshot: CalendarSnapshot,
    testEvent: ZohoCalendarTestEvent,
  ): Promise<void> {
    const range = calendarComparisonRange(
      [...snapshot.events.map((event) => event.start), testEvent.start],
      testSettings.zohoCalendar.rangeStart,
      testSettings.zohoCalendar.rangeEnd,
    );
    const inventory = await calendarApi.listCalendarInventory(range.start, range.end);
    this.assertions.expectSnapshotMatchesNativeCalendar(inventory, snapshot, testEvent);
  }

  async selectUser(email: string): Promise<CalendarBackupUser> {
    const normalizedEmail = email.trim();
    await this.usersTab.click();
    const allUsers = this.locators.allUsers();
    if (await allUsers.isVisible()) {
      await allUsers.click();
    }
    const search = this.locators.userSearch();
    await search.fill(normalizedEmail);
    await expect(this.locators.snapshotLoading()).toBeHidden({ timeout: 30_000 });

    const row = this.locators.firstUserRow();
    const cells = this.locators.rowCells(row);
    await expect(this.locators.userEmailCell(cells)).toHaveText(normalizedEmail, { timeout: 30_000 });
    const name = (await this.locators.userNameCell(cells).innerText()).trim();
    if (!name) {
      throw new Error(`Calendar user ${normalizedEmail} has no display name.`);
    }
    await this.locators.userName(row, name).click();
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
      const table = this.locators.snapshotTable();
      const nameColumn = await this.columnIndexFromTable(table, 'Name');
      const previousContents = await table.innerText();
      await this.locators.rowCell(row, nameColumn).click();
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
    const table = this.locators.snapshotTable();
    const range = this.locators.snapshotRange();
    const folders: C2CCalendarFolder[] = [];
    const occurrences = new Map<string, number>();

    for (; ;) {
      await expect(table).toBeVisible();
      await expect(range).toBeVisible();
      await expect(this.locators.snapshotLoading()).toBeHidden({ timeout: 30_000 });
      const headers = (await this.locators.columnHeaders(table).allInnerTexts()).map((value) => value.trim());
      const nameColumn = this.columnIndex(headers, 'Name');
      const organizerColumn = this.columnIndex(headers, 'Organizer');
      const startColumn = this.columnIndex(headers, 'Start');
      const rows = this.locators.tableRows(table);
      for (let index = 1; index < await rows.count(); index++) {
        const cells = await this.locators.rowCellsAt(rows, index).allInnerTexts();
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

      const next = this.locators.snapshotNext();
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
    const table = this.locators.snapshotTable();
    const range = this.locators.snapshotRange();
    const events: CalendarSnapshotEvent[] = [];
    for (; ;) {
      await expect(table).toBeVisible();
      await expect(range).toBeVisible();
      await expect(this.locators.snapshotLoading()).toBeHidden({ timeout: 30_000 });
      const headers = (await this.locators.columnHeaders(table).allInnerTexts()).map((value) => value.trim());
      const nameColumn = this.columnIndex(headers, 'Name');
      const organizerColumn = this.columnIndex(headers, 'Organizer');
      const startColumn = this.columnIndex(headers, 'Start');
      const rows = this.locators.tableRows(table);
      for (let index = 1; index < await rows.count(); index++) {
        const cells = await this.locators.rowCellsAt(rows, index).allInnerTexts();
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
      const next = this.locators.snapshotNext();
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
    const table = this.locators.snapshotTable();
    const range = this.locators.snapshotRange();
    const signature = JSON.stringify([folder.name.toLowerCase(), folder.organizer.toLowerCase(), folder.start]);
    let occurrence = 0;
    for (; ;) {
      await expect(range).toBeVisible();
      await expect(this.locators.snapshotLoading()).toBeHidden({ timeout: 30_000 });
      const headers = (await this.locators.columnHeaders(table).allInnerTexts()).map((value) => value.trim());
      const nameColumn = this.columnIndex(headers, 'Name');
      const organizerColumn = this.columnIndex(headers, 'Organizer');
      const startColumn = this.columnIndex(headers, 'Start');
      const rows = this.locators.tableRows(table);
      for (let index = 1; index < await rows.count(); index++) {
        const row = this.locators.rowAt(rows, index);
        const cells = await this.locators.rowCells(row).allInnerTexts();
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
      const next = this.locators.snapshotNext();
      if (await next.isDisabled()) {
        return undefined;
      }
      const currentRange = await range.innerText();
      await next.click();
      await expect(range).not.toHaveText(currentRange);
    }
  }

  private async returnToFirstCalendarPage(): Promise<void> {
    const range = this.locators.snapshotRange();
    const previous = this.locators.snapshotPrevious();
    while (!(await previous.isDisabled())) {
      const currentRange = await range.innerText();
      await previous.click();
      await expect(range).not.toHaveText(currentRange);
      await expect(this.locators.snapshotLoading()).toBeHidden({ timeout: 30_000 });
    }
  }

  private async returnToCalendarList(folderName: string): Promise<void> {
    const backButton = this.locators.calendarsBack();
    if (await backButton.isVisible()) {
      await backButton.click();
    } else {
      const breadcrumbs = this.locators.breadcrumbs();
      const parentButton = this.locators.breadcrumbButton(breadcrumbs, folderName);
      if (!(await parentButton.isVisible())) {
        throw new Error(`Could not return from C2C Calendar folder "${folderName}" to its calendar list.`);
      }
      await parentButton.click();
    }
    await expect(this.locators.snapshotLoading()).toBeHidden({ timeout: 30_000 });
    await expect(this.locators.snapshotTable()).toBeVisible();
  }

  private async columnIndexFromTable(table: Locator, name: string): Promise<number> {
    const headers = (await this.locators.columnHeaders(table).allInnerTexts()).map((value) => value.trim());
    return this.columnIndex(headers, name);
  }

  private async readLatestBackup(user: CalendarBackupUser): Promise<CalendarBackupState> {
    await this.backupsTab.click();
    const selectedUser = this.locators.historyUser(user.name);
    if (!(await selectedUser.isVisible())) {
      await this.locators.historyUserSelector().click();
      await this.locators.userOption(this.page, user.name).click();
    }
    await this.locators.historySearch().click();
    await expect(this.locators.historyLoading()).toBeHidden({ timeout: 30_000 });

    const rows = this.locators.historyRows();
    const range = this.locators.historyRange();
    const total = Number((await range.innerText()).match(/of\s+(\d+)/)?.[1]);
    if (!Number.isSafeInteger(total)) {
      throw new Error('Could not read the Calendar backup history row count.');
    }
    for (let index = 1; index < await rows.count(); index++) {
      const cells = await this.locators.rowCellsAt(rows, index).allInnerTexts();
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