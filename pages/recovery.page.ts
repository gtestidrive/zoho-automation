import { expect, type Page } from '@playwright/test';
import { recoveryPages, type RecoveryTab } from './recovery.labels';
import { RecoveryLocators } from './recovery.locators';

export class RecoveryPage {
  private readonly locators: RecoveryLocators;

  constructor(private readonly page: Page) {
    this.locators = new RecoveryLocators(page);
  }

  // Expand the app navigation if needed, then open and verify the requested recovery section.
  async openTab(tab: RecoveryTab): Promise<void> {
    const navigationToggle = this.locators.navigationToggle;
    if ((await navigationToggle.getAttribute('aria-expanded')) !== 'true') {
      await navigationToggle.click();
    }

    const recoveryButton = this.locators.recoveryButton;
    const tabLink = this.locators.tabLink(tab);

    if (!(await tabLink.isVisible())) {
      await recoveryButton.click();
    }

    await expect(tabLink).toBeVisible();
    await tabLink.click();
    await expect(this.page).toHaveURL(new RegExp(`${recoveryPages[tab].path}$`));
    await expect(this.locators.heading(tab)).toBeVisible();
  }
}
