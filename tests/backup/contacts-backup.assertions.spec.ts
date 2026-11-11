import { expect, test } from '@playwright/test';
import { ContactsBackupAssertions } from '../../pages/contacts/backup/contacts-backup.assertions';
import type { ZohoContact } from '../../pages/contacts/api/zoho-contacts.api';

test('compares visible Contacts fields and detects snapshot differences', () => {
  const assertions = new ContactsBackupAssertions();
  const source: ZohoContact[] = [{
    first_name: 'Alex',
    last_name: 'Example',
    emails: [{ email_id: 'alex@example.com', is_primary: true }],
    phones: [{ number: '1234567890', type: 'mobile', is_primary: true }],
  }];
  const snapshot = [{
    name: 'Alex Example',
    email: 'alex@example.com',
    phone: '1234567890',
  }];

  expect(() => assertions.expectSnapshotMatchesNativeContacts(source, snapshot)).not.toThrow();

  expect(() => assertions.expectSnapshotMatchesNativeContacts(
    source,
    [],
  )).toThrow('Zoho Contacts fields differ from the latest C2C snapshot.');
});
