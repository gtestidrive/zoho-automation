import { createHash } from 'node:crypto';
import type { ZohoContact } from '../api/zoho-contacts.api';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function normalizeContent(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeContent).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort()
      .filter((key) => !['id', 'contact_id', 'category_id'].includes(key))
      .map((key) => [key, normalizeContent(value[key])])
      .filter(([, item]) => item !== undefined && item !== null && item !== ''));
  }
  return value;
}

export function zohoContactsChecksum(contacts: ZohoContact[]): string {
  const records = contacts.map((contact) => JSON.stringify(normalizeContent(
    Object.fromEntries(contactContentFields.map((key) => [key, contact[key]])),
  ))).sort();
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
}

export function isCurrentContactsRestoreFolder(name: string, startedAt: number, completedAt: number): boolean {
  const match = /^Restored Contacts (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(name);
  if (!match) {
    return false;
  }
  const timestamp = Date.parse(`${match[1]}T${match[2]}:00Z`);
  return Number.isFinite(timestamp)
    && timestamp >= Math.floor(startedAt / 60_000) * 60_000
    && timestamp <= completedAt;
}

const contactContentFields = [
  'first_name', 'middle_name', 'last_name', 'gender', 'notes',
  'birth_day', 'birth_month', 'birth_year', 'company', 'job_title', 'designation',
  'emails', 'phones', 'address', 'urls', 'ims',
];
