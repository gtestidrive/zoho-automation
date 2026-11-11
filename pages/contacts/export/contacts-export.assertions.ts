import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { exportLog } from '../../export/export-log';
import { zohoContactSummary, type ZohoContact } from '../api/zoho-contacts.api';
import type { C2cSnapshotContact } from '../backup/contacts-backup.page';
import type { ExportedContact } from './contacts-export.page';

function text(value: string): string {
  return value.trim() === 'NA' ? '' : value.trim();
}

function canonical(contact: ExportedContact): ExportedContact {
  return {
    name: text(contact.name),
    emails: contact.emails.map((email) => text(email).toLowerCase()).sort(),
    phones: contact.phones.map(text).sort(),
  };
}

function checksum(contact: ExportedContact): string {
  return createHash('sha256').update(JSON.stringify(canonical(contact))).digest('hex');
}

function matchesSnapshot(exported: ExportedContact, selected: C2cSnapshotContact): boolean {
  const value = canonical(exported);
  const email = text(selected.email).toLowerCase();
  const phone = text(selected.phone);
  return value.name === text(selected.name)
    && (email ? value.emails.includes(email) : value.emails.length === 0)
    && (phone ? value.phones.includes(phone) : value.phones.length === 0);
}

function nativeValues(contact: ZohoContact, field: string, key: string): string[] {
  const values = contact[field];
  if (values === undefined || values === null) {
    return [];
  }
  if (!Array.isArray(values)) {
    throw new Error(`Zoho Contacts "${field}" is not an array.`);
  }
  return values.map((value: unknown) => {
    if (typeof value !== 'object' || value === null || !(key in value)) {
      throw new Error(`Zoho Contacts "${field}" contains an invalid entry.`);
    }
    const result: unknown = Reflect.get(value, key);
    if (typeof result !== 'string') {
      throw new Error(`Zoho Contacts "${field}.${key}" is not a string.`);
    }
    return result;
  });
}

export class ContactsExportAssertions {
  expectMatches(
    selected: C2cSnapshotContact[],
    exported: ExportedContact[],
    source: ZohoContact[],
  ): void {
    console.log('[Contacts export verification 1/2] Downloaded names, emails and phones versus selected C2C contacts.');
    const remaining = [...exported];
    const matched: ExportedContact[] = [];
    const rows = selected.map((contact) => {
      const index = remaining.findIndex((value) => matchesSnapshot(value, contact));
      if (index >= 0) {
        matched.push(remaining.splice(index, 1)[0]);
      }
      return {
        ...contact,
        DownloadName: index >= 0 ? matched.at(-1)?.name : '(missing)',
        DownloadEmails: index >= 0 ? matched.at(-1)?.emails.join(', ') : '(missing)',
        DownloadPhones: index >= 0 ? matched.at(-1)?.phones.join(', ') : '(missing)',
        DownloadedFieldsMatch: index >= 0,
      };
    });
    console.table(rows);
    exportLog('Contacts export', 'C2C comparison',
      `Selected=${selected.length}, downloaded=${exported.length}, matched=${matched.length}, `
      + `missing/changed=${selected.length - matched.length}, unmatched downloads=${remaining.length}.`);
    if (remaining.length) {
      console.table(remaining.map((contact) => ({ Problem: 'Unmatched downloaded contact', ...contact })));
    }
    expect(exported.length, 'Downloaded contact count differs from the selected C2C count.').toBe(selected.length);
    expect(rows.every(({ DownloadedFieldsMatch }) => DownloadedFieldsMatch),
      'Downloaded names, emails or phones differ from the selected C2C contacts.').toBe(true);

    console.log('[Contacts export verification 2/2] Canonical name/all-email/all-phone SHA-256 versus live Zoho Contacts.');
    const availableSource = source.map((original) => {
      const sourceContact = {
        name: zohoContactSummary(original).name,
        emails: nativeValues(original, 'emails', 'email_id'),
        phones: nativeValues(original, 'phones', 'number'),
      };
      return { contact: sourceContact, checksum: checksum(sourceContact) };
    });
    const checks = matched.map((contact) => {
      const exportChecksum = checksum(contact);
      const matchingIndex = availableSource.findIndex((candidate) => candidate.checksum === exportChecksum);
      if (matchingIndex < 0) {
        console.error(`[Contacts export] FAIL: "${contact.name}" has no remaining Zoho record with the same name/all-emails/all-phones checksum.`);
        console.table(availableSource.filter(({ contact: candidate }) => text(candidate.name) === text(contact.name))
          .map(({ contact: candidate, checksum: sourceHash }) => ({
            ZohoName: candidate.name, ZohoEmails: candidate.emails.join(', '),
            ZohoPhones: candidate.phones.join(', '), ZohoSHA256: sourceHash,
          })));
      }
      const sourceChecksum = matchingIndex >= 0
        ? availableSource.splice(matchingIndex, 1)[0].checksum
        : '(no remaining Zoho record with matching fields)';
      return {
        Name: contact.name, Emails: contact.emails.join(', '), Phones: contact.phones.join(', '),
        ExportSHA256: exportChecksum, ZohoSHA256: sourceChecksum, Matches: matchingIndex >= 0
      };
    });
    console.table(checks);
    exportLog('Contacts export', 'Result',
      `Zoho inventory=${source.length}, checksum matched=${checks.filter(({ Matches }) => Matches).length}, `
      + `failed=${checks.filter(({ Matches }) => !Matches).length}. Duplicate source records are consumed individually.`);
    expect(checks.every(({ Matches }) => Matches), 'Exported contact field checksums differ from Zoho.').toBe(true);
    console.log(`[Contacts export] Verified ${selected.length} selected contacts against C2C and live Zoho; no mismatches.`);
  }
}
