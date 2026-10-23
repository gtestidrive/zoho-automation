import { expect, type Page } from '@playwright/test';

export const recoveryTabs = ['Mail', 'Contacts', 'Drive', 'Calendar', 'Team folder'] as const;

export type RecoveryTab = (typeof recoveryTabs)[number];

const recoveryPages: Record<RecoveryTab, { path: string; heading: string }> = {
  Mail: { path: '/zoho/recovery/mail', heading: 'Mail' },
  Contacts: { path: '/zoho/recovery/contacts', heading: 'Contacts' },
  Drive: { path: '/zoho/recovery/drive', heading: 'Drive' },
  Calendar: { path: '/zoho/recovery/calendars', heading: 'Calendar' },
  'Team folder': { path: '/zoho/recovery/team-folder', heading: 'Team Folder' },
};

export class RecoveryPage {
  constructor(private readonly page: Page) {}

  // Expand the app navigation if needed, then open and verify the requested recovery section.
  async openTab(tab: RecoveryTab): Promise<void> {
    const navigationToggle = this.page.getByRole('button', { name: 'Toggle navigation' });
    if ((await navigationToggle.getAttribute('aria-expanded')) !== 'true') {
      await navigationToggle.click();
    }

    const recoveryButton = this.page.getByRole('button', { name: 'Recovery', exact: true });
    const tabLink = this.page.getByRole('link', { name: tab, exact: true });

    if (!(await tabLink.isVisible())) {
      await recoveryButton.click();
    }

    await expect(tabLink).toBeVisible();
    await tabLink.click();
    await expect(this.page).toHaveURL(new RegExp(`${recoveryPages[tab].path}$`));
    await expect(this.page.getByRole('heading', { name: recoveryPages[tab].heading, exact: true })).toBeVisible();
  }
}
