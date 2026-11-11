import { expect, test } from '@playwright/test';
import { ContactsBackupPage } from '../../pages/contacts/backup/contacts-backup.page';

test('prints the matching failed Contacts backup job details', async ({ page }) => {
  await page.setContent(`
    <a href="#logs">Activity Logs</a>
    <button role="tab">All Event Logs</button>
    <table aria-label="All event logs">
      <tr><th>Event</th><th>Timestamp</th><th>Seat</th><th>Module</th><th>Status</th><th>Details</th></tr>
      <tr><td>Backup</td><td>09/11/2026, 3:22 pm</td><td>c2c@example.com</td><td>Contacts</td><td>Failed</td><td><a href="#details">Details</a></td></tr>
    </table>
    <section role="dialog" hidden>
      <h2>Job Details</h2>
      <p>Error message: [zoho.contacts.syncContacts] Zoho returned status_code 404.</p>
    </section>
  `);
  await page.getByRole('link', { name: 'Details', exact: true }).evaluate((element) => {
    element.addEventListener('click', () => {
      document.querySelector<HTMLElement>('[role="dialog"]')!.hidden = false;
    });
  });
  const originalError = console.error;
  const messages: string[] = [];
  console.error = (message: string) => { messages.push(message); };
  try {
    await new ContactsBackupPage(page).printBackupFailureDetails(
      { name: 'Example', email: 'c2c@example.com' },
      { timestamp: '11/09/2026, 3:22 PM', status: 'Failed', totalCount: 50 },
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('[zoho.contacts.syncContacts] Zoho returned status_code 404.');
  } finally {
    console.error = originalError;
  }
});
