import { expect, test } from '@playwright/test';
import { CalendarBackupPage } from '../../pages/calendar/backup/calendar-backup.page';

test('opens every C2C calendar folder, including duplicates and folders without events', async ({ page }) => {
  await page.setContent(`
    <main>
      <div role="tablist">
        <button role="tab" aria-selected="true">Users</button>
        <button role="tab">Backups</button>
      </div>
      <section role="tabpanel" aria-label="Users">
        <input type="search" aria-label="Search Users">
        <table>
          <thead><tr><th>Name</th><th>Email</th></tr></thead>
          <tbody><tr><td>Ajay</td><td>user@example.com</td></tr></tbody>
        </table>
        <button>Backup now</button>
        <div id="snapshot"></div>
        <p id="range"></p>
        <button aria-label="Previous page" disabled></button>
        <button aria-label="Next page" disabled></button>
      </section>
      <section role="tabpanel" aria-label="Backups"></section>
    </main>
  `);

  await page.evaluate(() => {
    const renderRoot = () => {
      document.querySelector('#snapshot')!.innerHTML = `
        <table>
          <thead><tr><th>Name</th><th>Organizer</th><th>Start</th></tr></thead>
          <tbody>
            <tr data-event="Planning"><td>Ajay</td><td>owner</td><td>2026-10-25 10:00:00</td></tr>
            <tr data-event="Restore one"><td>Restore</td><td>owner</td><td>2026-07-10 04:34:08</td></tr>
            <tr data-event="Restore two"><td>Restore</td><td>owner</td><td>2026-07-10 04:35:08</td></tr>
            <tr data-event=""><td>Empty</td><td>owner</td><td>2026-07-10 04:36:08</td></tr>
          </tbody>
        </table>`;
      document.querySelector('#range')!.textContent = '1–4 of 4';
      document.querySelectorAll('#snapshot tbody tr').forEach((row) => {
        row.querySelector('td')!.addEventListener('click', () => renderEvents(row.getAttribute('data-event') ?? ''));
      });
    };
    const renderEvents = (title: string) => {
      document.querySelector('#snapshot')!.innerHTML = `
        <button>Calendars</button>
        <table>
          <thead><tr><th>Name</th><th>Organizer</th><th>Start</th></tr></thead>
          <tbody>${title
            ? `<tr><td>${title}</td><td>ajay@example.com</td><td>2026-10-25T10:00:00Z</td></tr>`
            : '<tr><td>No events found.</td></tr>'}</tbody>
        </table>`;
      document.querySelector('#range')!.textContent = title ? '1–1 of 1' : '0–0 of 0';
      document.querySelector('#snapshot button')!.addEventListener('click', renderRoot);
    };
    renderRoot();
  });

  const snapshot = await new CalendarBackupPage(page).readSnapshot('user@example.com');
  expect(snapshot).toEqual({
    folderNames: ['Ajay', 'Restore', 'Restore', 'Empty'],
    events: [
      { calendarName: 'Ajay', title: 'Planning', organizer: 'ajay@example.com', start: '2026-10-25T10:00:00Z' },
      { calendarName: 'Restore', title: 'Restore one', organizer: 'ajay@example.com', start: '2026-10-25T10:00:00Z' },
      { calendarName: 'Restore', title: 'Restore two', organizer: 'ajay@example.com', start: '2026-10-25T10:00:00Z' },
    ],
  });
});
