import { expect, type Locator, type Page } from '@playwright/test';
import { HomeLocators } from './home.locators';

export class HomePage {
  readonly page: Page;
  readonly getStartedLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.getStartedLink = new HomeLocators(page).getStartedLink;
  }

  async open(): Promise<void> {
    await this.page.goto('/');
  }

  async openGettingStarted(): Promise<void> {
    await this.getStartedLink.click();
    await expect(this.page).toHaveURL(/\/docs\/intro/);
  }
}