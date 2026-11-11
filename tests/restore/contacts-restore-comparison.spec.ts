import { expect, test } from '@playwright/test';
import { zohoContactSummary } from '../../pages/contacts/api/zoho-contacts.api';
import { contactSummariesChecksum } from '../../pages/contacts/backup/contacts-backup.assertions';

test('compares C2C visible fields with native contacts without dropping duplicates', () => {
  const c2c = [{ name: 'Alex Example', email: 'ALEX@example.com', phone: 'NA' }];
  const native = [{
    first_name: 'Alex', last_name: 'Example',
    emails: [{ email_id: 'other@example.com' }, { email_id: 'alex@example.com', is_primary: true }],
  }].map(zohoContactSummary);
  expect(contactSummariesChecksum(native)).toBe(contactSummariesChecksum(c2c));
  expect(contactSummariesChecksum([...native, ...native])).not.toBe(contactSummariesChecksum(c2c));
  expect(contactSummariesChecksum([{ ...native[0], phone: '123' }])).not.toBe(contactSummariesChecksum(c2c));
});
