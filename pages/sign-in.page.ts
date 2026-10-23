import { expect, type Locator, type Page } from '@playwright/test';

export class SignInPage {
  readonly signInHeading: Locator;
  readonly overviewLink: Locator;

  constructor(private readonly page: Page) {
    this.signInHeading = page.getByRole('heading', { name: 'Sign in' });
    this.overviewLink = page.getByRole('link', { name: 'Overview', exact: true });
  }

  // C2C login is independent of WorkDrive OAuth; skip form entry if this browser is already signed in.
  async signInIfRequired(email?: string, password?: string): Promise<void> {
    await expect(this.signInHeading.or(this.overviewLink)).toBeVisible({ timeout: 30_000 });

    if (await this.signInHeading.isVisible()) {
      if (!email || !password) {
        throw new Error('Set C2C_ZOHO_EMAIL and C2C_ZOHO_PASSWORD (or C2C_ZOHO_USERNAME and C2C_ZOHO_PASSWORD).');
      }

      await this.page.getByLabel('Email').fill(email);
      await this.page.getByLabel('Password').fill(password);
      await this.page.getByRole('button', { name: 'Sign in' }).click();
    }

    await expect(this.overviewLink).toBeVisible({ timeout: 30_000 });
  }
}
