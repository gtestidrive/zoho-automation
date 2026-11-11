import { expect, type Page } from '@playwright/test';
import { contactsBackupPatterns } from './contacts-backup.labels';
import { ContactsBackupLocators } from './contacts-backup.locators';

export type ContactsBackupState = {
  timestamp: string;
  status: string;
  totalCount: number;
};

export type ContactsRestoreUser = {
  name: string;
  email: string;
};

export type C2cSnapshotContact = { name: string; email: string; phone: string };

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

export class ContactsBackupPage {
  private readonly locators: ContactsBackupLocators;

  constructor(protected readonly page: Page) {
    this.locators = new ContactsBackupLocators(page);
  }

  async selectUser(email: string): Promise<ContactsRestoreUser> {
    await this.locators.usersTab.click();
    const rows = this.locators.tableRows(this.locators.usersTable);
    await expect(this.locators.firstUserRow(rows)).toContainText(contactsBackupPatterns.email, { timeout: 30_000 });

    for (let index = 1; index < await rows.count(); index++) {
      const row = this.locators.rowAt(rows, index);
      const cells = await this.locators.rowCells(row).allInnerTexts();
      if (cells[1]?.trim() === email) {
        const user = { name: cells[0]?.trim() ?? '', email };
        if (!user.name) {
          throw new Error(`Contacts user ${email} has no display name.`);
        }
        await row.click();
        await expect(this.locators.backupNowButton).toBeVisible();
        return user;
      }
    }

    throw new Error(`Could not find Contacts user ${email} in the users table.`);
  }

  async startBackupAndWait(user: ContactsRestoreUser): Promise<ContactsBackupState> {
    const previous = await this.readLatestBackup(user);
    await this.selectUser(user.email);
    log(`[Zoho C2C Contacts] Starting backup for ${user.email}.`);
    await this.locators.backupNowButton.click();
    await expect(this.locators.notifications).toContainText(contactsBackupPatterns.backupInProgress, {
      timeout: 15_000,
    });

    let latest: ContactsBackupState | undefined;
    await expect.poll(async () => {
      latest = await this.readLatestBackup(user);
      if (latest && latest.status !== 'Completed'
        && (latest.timestamp !== previous?.timestamp || latest.totalCount > (previous?.totalCount ?? 0))
        && /fail|error/i.test(latest.status)) {
        console.error(`[Zoho C2C Contacts] Backup failed for ${user.email} at ${latest.timestamp}.`);
        await this.printBackupFailureDetails(user, latest);
        throw new Error(
          `C2C Contacts backup failed for ${user.email} at ${latest.timestamp} `
          + `(status: ${latest.status}, history rows: ${latest.totalCount}). `
          + 'Check C2C Activity Logs for the failure reason; no successful snapshot was produced.',
        );
      }
      return latest !== undefined
        && latest.status === 'Completed'
        && (latest.timestamp !== previous?.timestamp || latest.totalCount > (previous?.totalCount ?? 0));
    }, { timeout: 10 * 60_000, intervals: [5_000] }).toBe(true);

    if (!latest) {
      throw new Error(`No completed Contacts backup was found for ${user.email}.`);
    }
    log(`[Zoho C2C Contacts] Backup completed for ${user.email} at ${latest.timestamp}.`);
    return latest;
  }

  async printBackupFailureDetails(user: ContactsRestoreUser, backup: ContactsBackupState): Promise<void> {
    await this.locators.activityLogsLink.click();
    await this.locators.allEventLogsTab.click();
    const match = /^(\d+)\/(\d+)\/(\d+),\s*(.*)$/.exec(backup.timestamp);
    if (!match) {
      throw new Error(`Could not match Contacts backup timestamp "${backup.timestamp}" to Activity Logs.`);
    }
    const eventTimestamp = `${match[2]}/${match[1]}/${match[3]}, ${match[4]}`;
    const row = this.locators.failedBackupEvent(this.page, user.email, eventTimestamp);
    await expect(row, 'The failed Contacts job must appear in Activity Logs.').toHaveCount(1);
    await this.locators.eventDetails(row).click();
    await expect(this.locators.jobDetailsDialog).toBeVisible();
    console.error(`[Zoho C2C Contacts] ${await this.locators.jobDetailsDialog.innerText()}`);
  }

  async readLatestSnapshotContactCount(user: ContactsRestoreUser): Promise<number> {
    await this.selectUser(user.email);
    await expect(this.locators.snapshotLoading())
      .toBeHidden({ timeout: 30_000 });
    const lastBackup = this.locators.lastBackupCard(this.page);
    const date = (await lastBackup.innerText()).replace(/^Last Backup\s*/, '').trim();
    if (!date) {
      throw new Error('Contacts snapshot has no last-backup timestamp.');
    }
    await expect(this.locators.snapshotDate, 'The selected snapshot must be the latest backup.').toHaveText(date);
    const range = this.locators.snapshotRange();
    const match = (await range.innerText()).match(/of\s+(\d+)/);
    if (!match) {
      throw new Error('Could not read the Contacts snapshot contact count.');
    }
    return Number(match[1]);
  }

  async readLatestSnapshotContacts(user: ContactsRestoreUser): Promise<C2cSnapshotContact[]> {
    const expectedCount = await this.readLatestSnapshotContactCount(user);
    const panel = this.locators.usersPanel;
    const contacts: C2cSnapshotContact[] = [];
    const table = this.locators.snapshotTable(panel);
    const headers = (await this.locators.columnHeaders(table).allInnerTexts()).map((header) => header.trim());
    const columns = ['Name', 'Email', 'Phone'].map((name) => {
      const index = headers.indexOf(name);
      if (index < 0 || headers.lastIndexOf(name) !== index) {
        throw new Error(`Expected one "${name}" column in the C2C Contacts snapshot.`);
      }
      return index;
    });
    for (; ;) {
      await expect(this.locators.panelLoading(panel)).toBeHidden({ timeout: 30_000 });
      const rows = this.locators.tableRows(table);
      for (let index = 1; index < await rows.count(); index++) {
        const cells = await this.locators.rowCellsAt(rows, index).allInnerTexts();
        if (cells.length !== headers.length) {
          throw new Error(`C2C Contacts snapshot row has ${cells.length} cells for ${headers.length} columns.`);
        }
        contacts.push({
          name: cells[columns[0]].trim(),
          email: cells[columns[1]].trim(),
          phone: cells[columns[2]].trim(),
        });
      }
      const next = this.locators.snapshotNext(panel);
      if (await next.isDisabled()) {
        break;
      }
      const range = this.locators.panelRange(panel);
      const previousRange = await range.innerText();
      await next.click();
      await expect(range).not.toHaveText(previousRange);
    }
    if (contacts.length !== expectedCount) {
      throw new Error(`C2C snapshot reports ${expectedCount} contacts but returned ${contacts.length} rows.`);
    }
    return contacts;
  }

  private async readLatestBackup(user: ContactsRestoreUser): Promise<ContactsBackupState | undefined> {
    await this.locators.backupsTab.click();
    const panel = this.locators.backupsPanel;
    const selector = this.locators.historyUserSelector(panel);
    const selectedUser = this.locators.historyUser(panel, user.name);
    if (!(await selectedUser.isVisible())) {
      await selector.click();
      await this.locators.userOption(this.page, user.name).click();
    }

    await this.locators.historySearch(panel).click();
    await expect(this.locators.panelLoading(panel)).toBeHidden({ timeout: 30_000 });
    const rows = this.locators.tableRows(this.locators.backupsTable);
    const range = this.locators.panelRange(panel);
    const countMatch = (await range.innerText()).match(/of\s+(\d+)/);
    if (!countMatch) {
      throw new Error('Could not read the Contacts backup history result count.');
    }
    for (let index = 1; index < await rows.count(); index++) {
      const cells = await this.locators.rowCells(this.locators.rowAt(rows, index)).allInnerTexts();
      if (cells[1]?.trim() === user.email) {
        return {
          timestamp: cells[0]?.trim() ?? '',
          status: cells[2]?.trim() ?? '',
          totalCount: Number(countMatch[1]),
        };
      }
    }
    return undefined;
  }
}
