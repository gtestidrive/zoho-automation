import type { Locator, Page } from '@playwright/test';
import { signInLabels as labels } from './sign-in.labels';

export class SignInLocators {
  readonly signInHeading: Locator;
  readonly overviewLink: Locator;
  readonly email: Locator;
  readonly password: Locator;
  readonly submit: Locator;

  constructor(page: Page) {
    this.signInHeading = page.getByRole('heading', { name: labels.heading });
    this.overviewLink = page.getByRole('link', { name: labels.overview, exact: true });
    this.email = page.getByLabel(labels.email);
    this.password = page.getByLabel(labels.password);
    this.submit = page.getByRole('button', { name: labels.submit });
  }

  signInOrOverview(): Locator {
    return this.signInHeading.or(this.overviewLink);
  }
}
