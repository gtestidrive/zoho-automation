import { expect, test } from '@playwright/test';
import { SignInPage } from '../pages/sign-in.page';

for (const session of ['active', 'expired', 'absent', 'already-open']) {
  test(`sign-in handles ${session} session without unnecessary login`, async ({ page }) => {
    let submissions = 0;
    await page.route('https://signin.test/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/account/authenticate') {
        submissions++;
        await route.fulfill({ json: { success: true } });
      } else if (path === '/zoho/overview' && session === 'expired' && submissions === 0) {
        await route.fulfill({ contentType: 'text/html',
          body: '<script>location.replace("/auth/sign-in")</script>' });
      } else if (path === '/zoho/overview') {
        await route.fulfill({ contentType: 'text/html', body: '<a href="/zoho/overview">Overview</a>' });
      } else {
        await route.fulfill({ contentType: 'text/html', body: `
          <h1>Sign in</h1>
          <label>Email<input type="email"></label>
          <label>Password<input type="password"></label>
          <button onclick="fetch('/api/account/authenticate', {method:'POST'}).then(() => location.href='/zoho/overview')">Sign in</button>` });
      }
    });
    if (session === 'active' || session === 'expired') {
      await page.addInitScript(() => {
        localStorage.setItem('idrive', JSON.stringify({ auth: { accessToken: 'test-only-token' } }));
      });
    }
    await page.goto(`https://signin.test/${session === 'already-open' ? 'zoho/overview' : 'auth/sign-in'}`);
    const needsLogin = session === 'expired' || session === 'absent';
    await new SignInPage(page).signInIfRequired(
      needsLogin ? 'owner@example.com' : undefined,
      needsLogin ? 'test-only-password' : undefined,
    );
    expect(submissions).toBe(needsLogin ? 1 : 0);
    await expect(page.getByRole('link', { name: 'Overview', exact: true })).toBeVisible();
  });
}
