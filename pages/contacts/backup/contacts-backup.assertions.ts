import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import {
  zohoContactSummary,
  type ZohoContact,
} from '../api/zoho-contacts.api';
import type { C2cSnapshotContact } from './contacts-backup.page';

export type ContactSummary = { name: string; email: string; phone: string };

export function contactSummariesChecksum(contacts: ContactSummary[]): string {
  const text = (value: string) => value.trim() === 'NA' ? '' : value.trim();
  const records = contacts.map((contact) => JSON.stringify({
    name: text(contact.name),
    email: text(contact.email).toLowerCase(),
    phone: text(contact.phone),
  })).sort();
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
}

export class ContactsBackupAssertions {
  expectSnapshotMatchesNativeContacts(
    sourceContacts: ZohoContact[],
    snapshotContacts: C2cSnapshotContact[],
  ): void {
    const sourceSummaries = sourceContacts.map(zohoContactSummary);
    const snapshotChecksum = contactSummariesChecksum(snapshotContacts);
    const sourceChecksum = contactSummariesChecksum(sourceSummaries);

    console.table([{
      Product: 'Contacts',
      SourceContacts: sourceSummaries.length,
      SnapshotContacts: snapshotContacts.length,
      SourceChecksum: sourceChecksum,
      SnapshotChecksum: snapshotChecksum,
      Status: sourceChecksum === snapshotChecksum ? 'Verified' : 'Mismatch',
    }]);
    expect(sourceChecksum, 'Zoho Contacts fields differ from the latest C2C snapshot.')
      .toBe(snapshotChecksum);
  }
}
