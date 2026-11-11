import type { Locator, Page } from '@playwright/test';
import { recoveryPages, type RecoveryTab } from './recovery.labels';

export class RecoveryLocators {
  readonly navigationToggle: Locator;
  readonly recoveryButton: Locator;

  constructor(private readonly page: Page) {
    this.navigationToggle = page.getByRole('button', { name: 'Toggle navigation' });
    this.recoveryButton = page.getByRole('button', { name: 'Recovery', exact: true });
  }

  tabLink(tab: RecoveryTab): Locator {
    return this.page.getByRole('link', { name: tab, exact: true });
  }

  heading(tab: RecoveryTab): Locator {
    return this.page.getByRole('heading', { name: recoveryPages[tab].heading, exact: true });
  }
}
