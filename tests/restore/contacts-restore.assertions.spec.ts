import { expect, test } from '@playwright/test';
import { isCurrentContactsRestoreFolder, zohoContactsChecksum } from '../../pages/contacts/restore/contacts-restore.assertions';

test('compares restored contact content without generated IDs, timestamps, or category membership', () => {
  const source = [{
    contact_id: 'source', first_name: 'Alex', last_name: 'Example',
    emails: [{ email_id: 'alex@example.com', is_primary: true }],
    phones: [{ number: '123', type: 'mobile' }, { number: '456', type: 'work' }],
    notes: 'Keep these notes',
    categories: [{ category_id: 'old' }], created_time: 1,
  }];
  const restored = [{
    ...source[0], contact_id: 'new', created_time: 2,
    categories: [{ category_id: 'restored' }],
    phones: [...source[0].phones].reverse(),
  }];
  expect(zohoContactsChecksum(restored)).toBe(zohoContactsChecksum(source));
  expect(zohoContactsChecksum([{ ...restored[0], notes: 'Changed' }])).not.toBe(zohoContactsChecksum(source));
  expect(zohoContactsChecksum([{ ...restored[0], emails: [] }])).not.toBe(zohoContactsChecksum(source));
  expect(zohoContactsChecksum([...restored, ...restored])).not.toBe(zohoContactsChecksum(source));
});

test('requires a restore folder timestamp in the current UTC restore window', () => {
  const start = Date.parse('2026-10-29T05:10:45Z');
  const end = Date.parse('2026-10-29T05:12:30Z');
  expect(isCurrentContactsRestoreFolder('Restored Contacts 2026-10-29 05:10', start, end)).toBe(true);
  expect(isCurrentContactsRestoreFolder('Restored Contacts 2026-10-29 05:12', start, end)).toBe(true);
  expect(isCurrentContactsRestoreFolder('Restored Contacts 2026-10-29 05:09', start, end)).toBe(false);
  expect(isCurrentContactsRestoreFolder('Restored Contacts 2026-10-29 05:13', start, end)).toBe(false);
  expect(isCurrentContactsRestoreFolder('(IDrive Restore 2026-10-29 05;10;00 UTC)_My Contacts', start, end)).toBe(false);
  expect(isCurrentContactsRestoreFolder('Restored Contacts invalid', start, end)).toBe(false);
});
