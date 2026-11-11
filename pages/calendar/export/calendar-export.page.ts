import { expect, type Locator, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { sync, type VEvent } from 'node-ical';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { ExportDownloadPage } from '../../export/export-download.page';
import { exportLog } from '../../export/export-log';
import type { ZohoCalendarApi } from '../api/zoho-calendar.api';
import { CalendarBackupPage } from '../backup/calendar-backup.page';
import { CalendarExportAssertions, calendarArchiveName } from './calendar-export.assertions';
import { calendarExportLabels as labels, calendarExportPatterns as patterns } from './calendar-export.labels';
import { CalendarExportLocators } from './calendar-export.locators';

type ExportHistory = { row: Locator; key: string; source: string; type: string; status: string; state: string };
type CalendarCandidate = { name: string; pageIndex: number; rowIndex: number };

export class CalendarExportPage {
  private readonly locators: CalendarExportLocators;
  private readonly backupPage: CalendarBackupPage;
  private readonly assertions = new CalendarExportAssertions();

  constructor(private readonly page: Page, private readonly api: ZohoCalendarApi) {
    this.locators = new CalendarExportLocators(page);
    this.backupPage = new CalendarBackupPage(page);
  }

  async exportRandomEventsAndVerify(email: string, directory: string) {
    const started = Date.now();
    exportLog('Calendar export', 'Start', `User=${email}, format=${labels.format}, directory="${directory}". No events or backups created.`);
    await this.openExports();
    const previous = await this.history();
    const user = await this.backupPage.selectUser(email);
    const selected = await this.selectRandomSnapshotEvents();
    console.table(selected);
    await this.locators.exportButton.click();
    await expect(this.locators.dialog).toBeVisible();
    await expect(this.locators.selectedItems).toBeChecked();
    await expect(this.locators.selectedItems).toHaveAccessibleName(new RegExp(`^Selected Items \\(${selected.length}\\)$`, 'i'));
    await this.locators.format.selectOption({ label: labels.format });
    await this.locators.confirm.click();
    await expect(this.locators.dialog).toBeHidden({ timeout: 30_000 });
    const submittedAt = Date.now();
    exportLog('Calendar export', 'Submitted', `User=${email}, calendar="${selected[0].calendarName}", selected events=${selected.length}.`);
    let completed: ExportHistory | undefined;
    let lastStatus = '';
    await expect.poll(async () => {
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.openExports();
      const seen = new Map<string, number>();
      const newRows = (await this.history()).filter((entry) => {
        const count = (seen.get(entry.key) ?? 0) + 1;
        seen.set(entry.key, count);
        return count > previous.filter(({ key }) => key === entry.key).length;
      });
      if (newRows.length > 1) throw new Error('Multiple new Calendar exports found; cannot identify this job uniquely.');
      const entry = newRows[0];
      if (!entry) return false;
      if (entry.source !== user.name || entry.type !== 'Selection') {
        throw new Error(`Unexpected new Calendar export: source="${entry.source}", type="${entry.type}".`);
      }
      const status = `${entry.key} | ${entry.status} | ${entry.state}`;
      if (status !== lastStatus) {
        exportLog('Calendar export', 'Export status',
          `History=${status}, elapsed=${((Date.now() - submittedAt) / 1000).toFixed(1)}s.`);
        lastStatus = status;
      }
      if (/fail|error/i.test(`${entry.status} ${entry.state}`)) {
        throw new Error(`Calendar export failed for ${email}: ${entry.status}, ${entry.state}.`);
      }
      if (/^completed$/i.test(entry.status) && /^active$/i.test(entry.state)) {
        completed = entry;
        return true;
      }
      return false;
    }, { timeout: 10 * 60_000, intervals: [2_000, 5_000], message: `Waiting for Calendar export for ${email}.` }).toBe(true);
    if (!completed) throw new Error('No completed Calendar export row found.');
    const action = this.locators.download(completed.row);
    await expect(action).toBeEnabled();
    const archivePath = await new ExportDownloadPage(this.page, 'Calendar export').downloadZip(action, directory);
    const downloaded = readCalendarExport(await readFile(archivePath));
    exportLog('Calendar export', 'Archive', `ZIP="${archivePath}", VEVENT records=${downloaded.length}.`);
    this.assertions.expectC2CMatches(selected, downloaded);
    this.assertions.expectZohoMatches(await readCalendarOriginals(downloaded, this.api));
    exportLog('Calendar export', 'PASS',
      `User=${email}, selected=${selected.length}, verified=${downloaded.length}, ZIP="${archivePath}", elapsed=${((Date.now() - started) / 1000).toFixed(1)}s.`);
    return { selectedEvents: selected, exportedEvents: downloaded.length, archivePath };
  }

  async selectRandomSnapshotEvents(): Promise<SelectedCalendarEvent[]> {
    const { locators } = this;
    await this.waitForSnapshot();
    await this.goToPage(0);
    const calendars: CalendarCandidate[] = [];
    for (let pageIndex = 0; ; pageIndex++) {
      const columns = await this.columns();
      const rows = this.locators.snapshotRows();
      for (let index = 1; index < await rows.count(); index++) {
        const cells = await this.locators.rowCellsAt(rows, index).allInnerTexts();
        if (cells.some((cell) => /no (?:calendar|folder)s? found/i.test(cell))) continue;
        if (!cells[columns.name]?.trim()) throw new Error('Calendar snapshot row has no name.');
        calendars.push({ name: cells[columns.name].trim(), pageIndex, rowIndex: index });
      }
      if (await locators.next.isDisabled()) break;
      await this.movePage(locators.next);
    }
    exportLog('Calendar export', 'Calendar inventory', `Found ${calendars.length} snapshot calendars; only the chosen event page will be read.`);
    while (calendars.length) {
      const calendar = calendars.splice(Math.floor(Math.random() * calendars.length), 1)[0];
      await this.goToPage(calendar.pageIndex);
      const columns = await this.columns();
      const cell = this.locators.calendarNameCell(calendar.rowIndex, columns.name);
      await expect(cell).toHaveText(calendar.name);
      await cell.click();
      await expect(this.locators.calendarsBack()).toBeVisible();
      await this.waitForSnapshot();
      const pagination = patterns.pagination.exec(await locators.range.innerText());
      if (!pagination) throw new Error('Cannot read Calendar event pagination.');
      const total = Number(pagination[3]);
      if (total === 0) {
        exportLog('Calendar export', 'Skip empty calendar', `Calendar="${calendar.name}" has no event rows.`);
        await this.locators.calendarsBack().click();
        await this.waitForSnapshot();
        continue;
      }
      const pageSize = Number(pagination[2]) - Number(pagination[1]) + 1;
      if (pageSize <= 0) throw new Error(`Invalid Calendar event pagination "${pagination[0]}".`);
      const pageIndex = Math.floor(Math.random() * Math.ceil(total / pageSize));
      await this.goToPage(pageIndex);
      const eventColumns = await this.columns();
      const rows = this.locators.snapshotRows();
      const candidates: Array<{ value: SelectedCalendarEvent; checkbox: Locator }> = [];
      for (let index = 1; index < await rows.count(); index++) {
        const row = this.locators.rowAt(rows, index);
        const cells = await this.locators.rowCells(row).allInnerTexts();
        const checkbox = this.locators.eventCheckbox(row);
        if (await checkbox.count() !== 1) throw new Error('Unexpected Calendar event checkbox count.');
        if (await checkbox.isEnabled()) {
          candidates.push({
            value: {
              calendarName: calendar.name, title: cells[eventColumns.name].trim(),
              organizer: cells[eventColumns.organizer].trim(), created: cells[eventColumns.start].trim(),
            }, checkbox
          });
        }
      }
      if (!candidates.length) throw new Error(`No selectable events on page ${pageIndex + 1} of "${calendar.name}".`);
      const count = 1 + Math.floor(Math.random() * Math.min(3, candidates.length));
      const selected: SelectedCalendarEvent[] = [];
      for (let index = 0; index < count; index++) {
        const candidate = candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0];
        await candidate.checkbox.check();
        await expect(candidate.checkbox).toBeChecked();
        selected.push(candidate.value);
      }
      exportLog('Calendar export', 'Selection',
        `Calendar="${calendar.name}", event total=${total}, page=${pageIndex + 1}, selected=${selected.length}. C2C Start is creation time.`);
      return selected;
    }
    throw new Error('No nonempty Calendar snapshot is available for a real selected-event export.');
  }

  private async waitForSnapshot(): Promise<void> {
    await expect(this.locators.table).toBeVisible();
    await expect(this.locators.loading).toBeHidden({ timeout: 30_000 });
    await expect(this.locators.range).toBeVisible();
  }

  private async movePage(button: Locator): Promise<void> {
    const before = await this.locators.range.innerText();
    await expect(button).toBeEnabled();
    await button.click();
    await expect(this.locators.range).not.toHaveText(before);
    await this.waitForSnapshot();
  }

  private async goToPage(index: number): Promise<void> {
    while (!await this.locators.previous.isDisabled()) await this.movePage(this.locators.previous);
    for (let current = 0; current < index; current++) await this.movePage(this.locators.next);
  }

  private async columns() {
    const headers = (await this.locators.snapshotHeaders().allInnerTexts()).map((value) => value.trim());
    const find = (name: string) => {
      const index = headers.indexOf(name);
      if (index < 0 || headers.lastIndexOf(name) !== index) throw new Error(`Expected one Calendar "${name}" column.`);
      return index;
    };
    return { name: find('Name'), organizer: find('Organizer'), start: find('Start') };
  }

  private async openExports(): Promise<void> {
    await this.locators.exportsTab.click();
    await expect(this.locators.exportsTab).toHaveAttribute('aria-selected', 'true');
    await expect(this.locators.exportsTable).toBeVisible();
    await expect(this.locators.historyLoading()).toBeHidden({ timeout: 60_000 });
  }

  private async history(): Promise<ExportHistory[]> {
    const table = this.locators.exportsTable;
    const headers = (await this.locators.historyHeaders(table).allInnerTexts()).map((value) => value.trim().replace(/\s+/g, ' '));
    const column = (name: string) => {
      const index = headers.indexOf(name);
      if (index < 0 || headers.lastIndexOf(name) !== index) throw new Error(`Expected one Calendar export "${name}" column.`);
      return index;
    };
    const identity = ['Source', 'Type', 'Destination', 'Started', 'Performed by'].map(column);
    const source = column('Source'), type = column('Type'), status = column('Status'), state = column('Export state');
    const result: ExportHistory[] = [];
    const rows = this.locators.historyRows(table);
    for (let index = 1; index < await rows.count(); index++) {
      const row = this.locators.rowAt(rows, index);
      const cells = (await this.locators.rowCells(row).allInnerTexts()).map((value) => value.trim());
      if (cells.length !== headers.length) {
        if (cells.length === 1 && /no .*exports|no records|no data/i.test(cells[0])) continue;
        throw new Error('Unexpected Calendar export history row shape.');
      }
      result.push({
        row, key: JSON.stringify(identity.map((index) => cells[index])),
        source: cells[source], type: cells[type], status: cells[status], state: cells[state]
      });
    }
    return result;
  }
}


export type SelectedCalendarEvent = { calendarName: string; title: string; organizer: string; created: string };

export type ExportedCalendarEvent = { path: string; calendarName: string; event: VEvent; raw: string };
export type CalendarSourceEvent = { downloaded: ExportedCalendarEvent; source: Record<string, unknown> };

export function readCalendarExport(bytes: Uint8Array): ExportedCalendarEvent[] {
  const events: ExportedCalendarEvent[] = [];
  for (const [path, content] of Object.entries(unzipSync(bytes))) {
    if (path.endsWith('/')) continue;
    if (!/\.(?:ics|ical)$/i.test(path)) throw new Error(`Unexpected Calendar ZIP payload "${path}".`);
    const data = new TextDecoder('utf-8', { fatal: true }).decode(content).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
    if (!/^BEGIN:VCALENDAR\r?$/m.test(data) || !/^END:VCALENDAR\r?$/m.test(data)) {
      throw new Error(`Invalid iCalendar document "${path}".`);
    }
    const blocks = [...data.matchAll(/^BEGIN:VEVENT\r?\n[\s\S]*?^END:VEVENT\r?$/gm)];
    if (blocks.length !== (data.match(/^BEGIN:VEVENT\r?$/gm) ?? []).length
      || blocks.length !== (data.match(/^END:VEVENT\r?$/gm) ?? []).length) {
      throw new Error(`Malformed VEVENT boundaries in "${path}".`);
    }
    const timezones = [...data.matchAll(/^BEGIN:VTIMEZONE\r?\n[\s\S]*?^END:VTIMEZONE\r?$/gm)]
      .map(([block]) => block).join('\n');
    for (const [raw] of blocks) {
      const parsed = sync.parseICS(`BEGIN:VCALENDAR\nVERSION:2.0\n${timezones}\n${raw}\nEND:VCALENDAR`);
      const found = Object.values(parsed).filter((entry): entry is VEvent => entry?.type === 'VEVENT');
      const summary = found[0]?.summary;
      if (found.length !== 1 || !found[0].uid || !(typeof summary === 'string' ? summary : summary?.val)) {
        throw new Error(`Expected one event with UID and summary in "${path}".`);
      }
      events.push({ path, calendarName: basename(path).replace(/\.(?:ics|ical)$/i, ''), event: found[0], raw });
    }
  }
  if (!events.length) throw new Error('Calendar export ZIP contains no VEVENT records.');
  return events;
}

export async function readCalendarOriginals(
  downloaded: ExportedCalendarEvent[], api: Pick<ZohoCalendarApi, 'listCalendars' | 'getEventDetails'>,
): Promise<CalendarSourceEvent[]> {
  const sources: CalendarSourceEvent[] = [];
  const calendars = await api.listCalendars();
  const consumed = new Set<string>();
  for (const downloadedEvent of downloaded) {
    const { event, calendarName, path, raw } = downloadedEvent;
    const matches = calendars.filter((calendar) => calendarArchiveName(calendar.name) === calendarName);
    if (matches.length !== 1) {
      throw new Error(`Cannot uniquely identify Zoho calendar "${calendarName}" (matches=${matches.length}); no source calendar guessed.`);
    }
    const calendar = matches[0];
    const recurrenceId = /^RECURRENCE-ID(?:;[^:]*)?:(.*)\r?$/mi.exec(raw)?.[1].trim();
    const key = `${calendar.uid}|${event.uid}|${recurrenceId ?? ''}`;
    if (consumed.has(key)) throw new Error(`Duplicate downloaded event has no unused Zoho original: ${key}.`);
    consumed.add(key);
    exportLog('Calendar export', 'Zoho event', `Calendar="${calendarName}", calendar UID=${calendar.uid}, event UID=${event.uid}.`);
    let source: Record<string, unknown>;
    try {
      source = await api.getEventDetails(calendar.uid, event.uid, recurrenceId);
    } catch (error) {
      console.error(`[Calendar export] FAIL: live original unavailable for "${path}", UID=${event.uid}.`, error);
      throw error;
    }
    sources.push({ downloaded: downloadedEvent, source });
  }
  return sources;
}
