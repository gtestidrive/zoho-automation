import type { Locator, Page } from '@playwright/test';

export class ExportDownloadLocators {
  manager(page: Page): Locator {
    return page.locator('downloads-manager');
  }

  items(page: Page): Locator {
    return page.locator('downloads-item');
  }

  keep(item: Locator): Locator {
    return item.getByRole('button', { name: /^keep(?: anyway)?$/i });
  }

  menu(item: Locator): Locator {
    return item.locator('#more-actions');
  }
}
