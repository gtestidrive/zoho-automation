import { test } from '@playwright/test';
import { recoveryTabs } from '../pages/recovery.labels';
import { RecoveryPage } from '../pages/recovery.page';
import { SignInPage } from '../pages/sign-in.page';
import { testSettings } from '../test-settings';

test('each Recovery tab opens its matching page', async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto(testSettings.c2cZoho.url, { waitUntil: 'domcontentloaded' });

  const signInPage = new SignInPage(page);
  await signInPage.signInIfRequired(testSettings.c2cZoho.email, testSettings.c2cZoho.password);

  const recoveryPage = new RecoveryPage(page);
  for (const tab of recoveryTabs) {
    await recoveryPage.openTab(tab);
  }
});
