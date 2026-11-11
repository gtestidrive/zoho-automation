import { expect, test } from '@playwright/test';
import { ContactsRestorePage } from '../../pages/contacts/restore/contacts-restore.page';

test('C2C restore method selects the whole snapshot, correct destination, and new-folder mode', async ({ page }) => {
  await page.setContent(`
    <button id="open">Restore</button>
    <section role="dialog" aria-label="Restore" hidden>
      <label><input type="radio" name="scope" value="snapshot">Snapshot</label>
      <label><input type="radio" name="scope" value="selected" checked>Selected Items (1)</label>
      <label>Restore to
        <select><option>Other User</option><option>Alex Example</option></select>
      </label>
      <label><input type="radio" name="mode" value="new">New folder</label>
      <label><input type="radio" name="mode" value="override" checked>Override always</label>
      <button id="submit">Restore</button>
    </section>
  `);
  await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    document.querySelector('#open')!.addEventListener('click', () => { dialog.hidden = false; });
    document.querySelector('#submit')!.addEventListener('click', () => { dialog.hidden = true; });
  });
  const restorePage = new ContactsRestorePage(page);
  const user = { name: 'Alex Example', email: 'alex@example.com' };
  let selectedEmail: string | undefined;
  restorePage.selectUser = async (email) => {
    selectedEmail = email;
    return user;
  };
  const before = Date.now();
  const startedAt = await restorePage.startC2cNewFolderRestore(user);
  expect(selectedEmail).toBe(user.email);
  expect(Date.parse(startedAt)).toBeGreaterThanOrEqual(before);
  expect(Date.parse(startedAt)).toBeLessThanOrEqual(Date.now());
  await expect(page.locator('input[value="snapshot"]')).toBeChecked();
  await expect(page.locator('input[value="new"]')).toBeChecked();
  await expect(page.locator('select')).toHaveValue(user.name);
  await expect(page.getByRole('dialog', { name: 'Restore' })).toBeHidden();
});

for (const selectionColumn of [false, true]) {
test(`reads every snapshot page with checkbox column ${selectionColumn} and preserves duplicates`, async ({ page }) => {
  await page.setContent(`
    <section role="tabpanel" aria-label="Users">
      <table><tr>${selectionColumn ? '<th><input type="checkbox"></th>' : ''}<th>Name</th><th>Email</th><th>Phone</th></tr>
        <tr>${selectionColumn ? '<td><input type="checkbox"></td>' : ''}<td>Alex</td><td>alex@example.com</td><td>NA</td></tr>
      </table>
      <span id="range">1–1 of 2</span>
      <button id="next" aria-label="Next page">Next</button>
    </section>
  `);
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('#next')!.onclick = () => {
      document.querySelector('#range')!.textContent = '2–2 of 2';
      document.querySelector<HTMLButtonElement>('#next')!.disabled = true;
    };
  });
  const c2c = new ContactsRestorePage(page);
  c2c.readLatestSnapshotContactCount = async () => 2;
  await expect(c2c.readLatestSnapshotContacts({ name: 'Alex', email: 'alex@example.com' }))
    .resolves.toEqual([
      { name: 'Alex', email: 'alex@example.com', phone: 'NA' },
      { name: 'Alex', email: 'alex@example.com', phone: 'NA' },
    ]);
});
}
