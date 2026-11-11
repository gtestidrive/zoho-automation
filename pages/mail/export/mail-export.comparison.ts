import { createReadStream } from 'node:fs';
import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';
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

function normalizeAddresses(value: string): string {
  const addresses = decodeHtmlEntities(value).match(/[^\s<,;]+@[^\s>,;]+/g) ?? [];
  return addresses.map((address) => address.replace(/[>),;]+$/g, '').trim().toLowerCase()).sort().join(',');
}

function decodeEncodedWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_match, charset: string, encoding: string, text: string) => {
    try {
      const bytes = encoding.toLowerCase() === 'b'
        ? Buffer.from(text, 'base64')
        : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_hex, code: string) =>
          String.fromCharCode(Number.parseInt(code, 16))), 'binary');
      return new TextDecoder(charset).decode(bytes);
    } catch (error) {
      throw new Error(`Could not decode exported Mail header using ${charset}: ${String(error)}`);
    }
  });
}

function readHeader(rawMessage: string, headerName: string): string {
  const headerBlock = rawMessage.split(/\r?\n\r?\n/, 1)[0] ?? '';
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, ' ');
  const values = unfolded
    .split(/\r?\n/)
    .filter((line) => line.toLowerCase().startsWith(`${headerName.toLowerCase()}:`))
    .map((line) => line.slice(headerName.length + 1).trim());
  return decodeEncodedWords(values.join(', ')).replace(/\s+/g, ' ').trim();
}

function parseEmlHeaders(rawHeaders: Uint8Array): ExportedMailMessage {
  const text = new TextDecoder('utf-8').decode(rawHeaders);
  return {
    from: normalizeAddresses(readHeader(text, 'From')),
    to: normalizeAddresses(readHeader(text, 'To')),
    subject: readHeader(text, 'Subject').normalize('NFC'),
  };
}

export async function readExportedMailMessages(zipPath: string): Promise<ExportedMailMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: ExportedMailMessage[] = [];
    let activeEntries = 0;
    let inputEnded = false;
    let settled = false;
    const maxHeaderBytes = 256 * 1024;

    const fail = (error: Error): void => {
      if (!settled) {
        settled = true;
        input.destroy();
        reject(error);
      }
    };

    const finishIfReady = (): void => {
      if (inputEnded && activeEntries === 0 && !settled) {
        settled = true;
        if (messages.length === 0) {
          reject(new Error('Mail export ZIP contains no .eml messages to compare.'));
        } else {
          resolve(messages);
        }
      }
    };

    const archive = new Unzip((file) => {
      const isMessage = /\.eml$/i.test(file.name);
      let headerBytes = new Uint8Array(0);
      let headerComplete = false;
      if (isMessage) {
        activeEntries += 1;
      }

      file.ondata = (error, data, final) => {
        if (error) {
          fail(error);
          return;
        }
        if (isMessage && data.length > 0 && !headerComplete) {
          const combined = new Uint8Array(headerBytes.length + data.length);
          combined.set(headerBytes);
          combined.set(data, headerBytes.length);
          let headerEnd = -1;
          for (let index = 0; index < combined.length; index++) {
            if (
              index + 3 < combined.length
              && combined[index] === 13 && combined[index + 1] === 10
              && combined[index + 2] === 13 && combined[index + 3] === 10
            ) {
              headerEnd = index;
              break;
            }
            if (index + 1 < combined.length && combined[index] === 10 && combined[index + 1] === 10) {
              headerEnd = index;
              break;
            }
          }
          if (headerEnd >= 0) {
            headerBytes = combined.slice(0, headerEnd);
            headerComplete = true;
          } else {
            if (combined.length > maxHeaderBytes) {
              fail(new Error(`Exported Mail message "${file.name}" has a header larger than ${maxHeaderBytes} bytes.`));
              return;
            }
            headerBytes = combined;
          }
        }
        if (final && isMessage) {
          if (!headerComplete) {
            fail(new Error(`Exported Mail message "${file.name}" has no complete header section.`));
            return;
          }
          try {
            messages.push(parseEmlHeaders(headerBytes));
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
            return;
          }
          activeEntries -= 1;
          finishIfReady();
        }
      };

      try {
        file.start();
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    archive.register(UnzipInflate);
    archive.register(UnzipPassThrough);

    const input = createReadStream(zipPath);
    input.on('data', (chunk: string | Buffer) => {
      if (settled) {
        return;
      }
      try {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        archive.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    input.on('error', (error) => fail(error));
    input.on('end', () => {
      if (settled) {
        return;
      }
      try {
        archive.push(new Uint8Array(0), true);
        inputEnded = true;
        finishIfReady();
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

function messageKey(message: ExportedMailMessage): string {
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
