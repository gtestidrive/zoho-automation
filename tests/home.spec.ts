import { expect, test } from '@playwright/test';
import { HomePage } from '../pages/home.page';

test('opens the getting started documentation',{ tag: '@zoho' }, async ({ page }) => {
  const homePage = new HomePage(page);

  await homePage.open();
  await expect(homePage.getStartedLink).toBeVisible();
  await homePage.openGettingStarted();
  await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible();});