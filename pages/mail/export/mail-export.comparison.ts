import type { ZohoMailMessage } from '../api/zoho-mail.api';

export type ExportedMailMessage = Pick<ZohoMailMessage, 'from' | 'to' | 'subject'>;

export type MailExportComparison = {
  nativeOnly: ExportedMailMessage[];
  exportOnly: ExportedMailMessage[];
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|amp|lt|gt|quot|apos|#39);?/gi, (entity, code: string) => {
    const namedEntities: Record<string, string> = {
      amp: '&',
      apos: "'",
      gt: '>',
      lt: '<',
      quot: '"',
      '#39': "'",
    };
    if (code[0] !== '#') {
      return namedEntities[code.toLowerCase()] ?? entity;
    }

    const numeric = code[1]?.toLowerCase() === 'x'
      ? Number.parseInt(code.slice(2), 16)
      : Number.parseInt(code.slice(1), 10);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 0x10ffff
      || (numeric >= 0xd800 && numeric <= 0xdfff)) {
      return entity;
    }
    return String.fromCodePoint(numeric);
  });
}

export function normalizeAddresses(value: string): string {
  const addresses = decodeHtmlEntities(value).match(/[^\s<,;]+@[^\s>,;]+/g) ?? [];
  return addresses.map((address) => address.replace(/[>),;]+$/g, '').trim().toLowerCase()).sort().join(',');
}

export function messageKey(message: ExportedMailMessage): string {
  return JSON.stringify({
    from: normalizeAddresses(message.from),
    to: normalizeAddresses(message.to),
    subject: decodeHtmlEntities(message.subject).trim().replace(/\s+/g, ' ').normalize('NFC'),
  });
}

function asCounts(messages: ExportedMailMessage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const message of messages) {
    const key = messageKey(message);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function compareMailExportMessages(
  nativeMessages: ZohoMailMessage[],
  exportedMessages: ExportedMailMessage[],
): MailExportComparison {
  const nativeCounts = asCounts(nativeMessages);
  const exportCounts = asCounts(exportedMessages);
  const messagesByKey = new Map<string, ExportedMailMessage>();
  for (const message of [...nativeMessages, ...exportedMessages]) {
    messagesByKey.set(messageKey(message), message);
  }

  const nativeOnly: ExportedMailMessage[] = [];
  const exportOnly: ExportedMailMessage[] = [];
  for (const [key, count] of nativeCounts) {
    const missing = count - (exportCounts.get(key) ?? 0);
    for (let index = 0; index < missing; index++) {
      nativeOnly.push(messagesByKey.get(key)!);
    }
  }
  for (const [key, count] of exportCounts) {
    const extra = count - (nativeCounts.get(key) ?? 0);
    for (let index = 0; index < extra; index++) {
      exportOnly.push(messagesByKey.get(key)!);
    }
  }
  return { nativeOnly, exportOnly };
}
