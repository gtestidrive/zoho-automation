import { expect, test } from '@playwright/test';
import { SignInPage } from '../pages/sign-in.page';

test('signs in with labeled email and password fields', async ({ page }) => {
  await page.setContent(`
    <h1>Sign in</h1>
    <form>
      <label for="email">Email</label>
      <input id="email" type="email">
      <label for="password">Password</label>
      <input id="password" type="password">
      <button type="submit">Sign in</button>
    </form>
    <script>
      document.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault();
        const email = document.querySelector('#email').value;
        const password = document.querySelector('#password').value;
        document.body.innerHTML = email === 'user@example.com' && password === 'secret'
          ? '<a href="/overview">Overview</a>'
          : '<h1>Sign in</h1>';
      });
    </script>
  `);

  await new SignInPage(page).signInIfRequired('user@example.com', 'secret');
  await expect(page.getByRole('link', { name: 'Overview', exact: true })).toBeVisible();
});

test('reuses an existing signed-in session without credentials', async ({ page }) => {
  await page.setContent('<a href="/overview">Overview</a>');

  await new SignInPage(page).signInIfRequired();

  await expect(page.getByRole('link', { name: 'Overview', exact: true })).toBeVisible();
});
