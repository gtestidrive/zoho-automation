import type { Page } from '@playwright/test';
import { openMailRecovery, signInToMailC2C } from '../backup/mail_backup_config';
import { MailExportPage } from './mail-export.page';

export async function setupMailExport(page: Page) {
  const { email, mailApi } = await signInToMailC2C(page);
  await openMailRecovery(page);
  return { email, exportPage: new MailExportPage(page, mailApi) };
}
