import { expect, type Page } from '@playwright/test';
import { ContactsBackupPage, type ContactsRestoreUser } from '../backup/contacts-backup.page';
import { ContactsRestoreLocators } from './contacts-restore.locators';

export type ContactsRestoreResult = {
  startedAt: string;
  itemCount: number;
  status: string;
};

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

export class ContactsRestorePage extends ContactsBackupPage {
  private readonly restoreLocators: ContactsRestoreLocators;

  constructor(page: Page) {
    super(page);
    this.restoreLocators = new ContactsRestoreLocators(page);
  }

  async restoreToNewFolder(user: ContactsRestoreUser): Promise<ContactsRestoreResult> {
    const restoreHistory = await this.readRestoreHistory();
    const startedAt = await this.startC2cNewFolderRestore(user);

    let result: ContactsRestoreResult | undefined;
    await expect.poll(async () => {
      result = await this.findNewCompletedRestore(user, restoreHistory);
      return result !== undefined;
    }, { timeout: 10 * 60_000, intervals: [5_000] }).toBe(true);

    if (!result) {
      throw new Error(`No completed new-folder Contacts restore was recorded for ${user.email}.`);
    }
    log(`[Zoho C2C Contacts] Restore completed for ${user.email}: ${result.itemCount} items.`);
    return { ...result, startedAt };
  }

  async startC2cNewFolderRestore(user: ContactsRestoreUser): Promise<string> {
    await this.selectUser(user.email);
    const dialog = this.restoreLocators.dialog;
    await this.restoreLocators.restoreButton(this.page).click();
    await expect(dialog).toBeVisible();
    await this.restoreLocators.snapshotRadio(dialog).check();
    await this.restoreLocators.newFolderRadio(dialog).check();
    await expect(this.restoreLocators.newFolderRadio(dialog)).toBeChecked();
    await this.restoreLocators.destination(dialog).selectOption({ label: user.name });

    const startedAt = new Date().toISOString();
    log(`[Zoho C2C Contacts] Restoring the latest snapshot for ${user.email} to a new folder.`);
    await this.restoreLocators.submitRestore(dialog).click();
    const confirmation = this.restoreLocators.confirmation(this.page);
    await expect.poll(async () => {
      if (await confirmation.isVisible()) {
        await this.restoreLocators.confirmRestore(confirmation).click();
      }
      return !(await dialog.isVisible());
    }, { timeout: 30_000 }).toBe(true);
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    return startedAt;
  }

  private async readRestoreHistory(): Promise<{ rows: string[]; totalCount: number }> {
    await this.restoreLocators.restoresTab.click();
    await expect(this.restoreLocators.historyTable()).toBeVisible();
    await expect(this.restoreLocators.historyLoading())
      .toBeHidden({ timeout: 30_000 });
    const rows = this.restoreLocators.tableRows(this.restoreLocators.restoresTable);
    const range = this.restoreLocators.historyRange();
    const countMatch = (await range.innerText()).match(/of\s+(\d+)/);
    if (!countMatch) {
      throw new Error('Could not read the Contacts restore history result count.');
    }
    return { rows: (await rows.allInnerTexts()).slice(1), totalCount: Number(countMatch[1]) };
  }

  private async findNewCompletedRestore(
    user: ContactsRestoreUser,
    previousHistory: { rows: string[]; totalCount: number },
  ): Promise<ContactsRestoreResult | undefined> {
    await this.restoreLocators.restoresTab.click();
    await expect(this.restoreLocators.historyLoading())
      .toBeHidden({ timeout: 30_000 });
    const range = this.restoreLocators.historyRange();
    const countMatch = (await range.innerText()).match(/of\s+(\d+)/);
    if (!countMatch) {
      throw new Error('Could not read the Contacts restore history result count.');
    }
    const totalCount = Number(countMatch[1]);
    const rows = this.restoreLocators.tableRows(this.restoreLocators.restoresTable);
    for (let index = 1; index < await rows.count(); index++) {
      const row = this.restoreLocators.rowAt(rows, index);
      const rowText = (await row.innerText()).trim();
      const newFirstRow = index === 1 && totalCount > previousHistory.totalCount;
      if (previousHistory.rows.includes(rowText) && !newFirstRow) {
        continue;
      }
      const cells = await this.restoreLocators.rowCells(row).allInnerTexts();
      if (cells[0]?.trim() !== user.name) {
        continue;
      }
      if (/fail|error/i.test(cells.at(-1) ?? '')) {
        throw new Error(`Contacts restore failed for ${user.email}: ${cells.at(-1)}.`);
      }
      if (!/completed/i.test(cells.at(-1) ?? '')) {
        continue;
      }

      const itemCount = Number(cells[3]?.trim());
      if (!Number.isInteger(itemCount) || itemCount < 0) {
        throw new Error(`Could not read the Contacts restore item count from row "${rowText}".`);
      }
      return {
        startedAt: cells[5]?.trim() ?? '',
        itemCount,
        status: cells.at(-1)?.trim() ?? '',
      };
    }
    return undefined;
  }
}
