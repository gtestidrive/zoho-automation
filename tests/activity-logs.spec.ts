import { expect, test } from '@playwright/test';
import { SignInPage } from '../pages/sign-in.page';
import { testSettings } from '../test-settings';

test('signs in and opens the overview home screen', async ({ page }) => {
  test.setTimeout(45_000);

  await page.goto(testSettings.c2cZoho.url, { waitUntil: 'domcontentloaded' });

  const signInPage = new SignInPage(page);
  await signInPage.signInIfRequired(testSettings.c2cZoho.email, testSettings.c2cZoho.password);

  await expect(page).toHaveURL(/\/zoho\/overview$/i, { timeout: 30_000 });
  await expect(signInPage.overviewLink).toBeVisible();
});
