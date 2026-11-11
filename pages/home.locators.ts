import type { Locator, Page } from '@playwright/test';

export class HomeLocators {
  readonly getStartedLink: Locator;

  constructor(page: Page) {
    this.getStartedLink = page.getByRole('link', { name: 'Get started' });
  }
}
