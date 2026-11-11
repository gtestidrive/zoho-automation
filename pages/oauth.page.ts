import type { Page } from '@playwright/test';

export class OAuthPage {
  constructor(private readonly page: Page) { }

  readonly open = async (url: string): Promise<void> => {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  };
}
