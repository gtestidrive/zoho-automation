import { expect, type Locator, type Page } from '@playwright/test';
import { SignInLocators } from './sign-in.locators';

export class SignInPage {
  readonly signInHeading: Locator;
  readonly overviewLink: Locator;
  private readonly locators: SignInLocators;

  constructor(private readonly page: Page) {
    this.locators = new SignInLocators(page);
    this.signInHeading = this.locators.signInHeading;
    this.overviewLink = this.locators.overviewLink;
  }

  // C2C login is independent of WorkDrive OAuth; skip form entry if this browser is already signed in.
  async signInIfRequired(email?: string, password?: string): Promise<void> {
    await expect(this.locators.signInOrOverview()).toBeVisible({ timeout: 30_000 });

    if (await this.signInHeading.isVisible()) {
      const hasSession = await this.page.evaluate(() => {
        const saved = localStorage.getItem('idrive');
        if (!saved) return false;
        const state: unknown = JSON.parse(saved);
        return typeof state === 'object' && state !== null && 'auth' in state
          && typeof state.auth === 'object' && state.auth !== null && 'accessToken' in state.auth
          && typeof state.auth.accessToken === 'string' && state.auth.accessToken.length > 0;
      });
      if (hasSession) {
        await this.page.goto(new URL('/zoho/overview', this.page.url()).href, { waitUntil: 'domcontentloaded' });
        await expect(this.locators.signInOrOverview()).toBeVisible({ timeout: 30_000 });
      }
    }

    if (await this.signInHeading.isVisible()) {
      if (!email || !password) {
        throw new Error('Set C2C_ZOHO_EMAIL and C2C_ZOHO_PASSWORD (or C2C_ZOHO_USERNAME and C2C_ZOHO_PASSWORD).');
      }

      await this.locators.email.fill(email);
      await this.locators.password.fill(password);
      await this.locators.submit.click();
    }

    await expect(this.overviewLink).toBeVisible({ timeout: 30_000 });
  }
}
