import { expect } from '@playwright/test';
import { exportLog } from '../../export/export-log';
import type { ZohoMailMessage } from '../api/zoho-mail.api';
import { compareMailExportMessages, messageKey } from './mail-export.comparison';
import type { ExportedEml, MailExportChecksumResult } from './mail-export.page';

export class MailExportAssertions {
  expectC2CMatches(
    selected: ZohoMailMessage[],
    exported: ExportedEml[],
  ): void {
    console.log('[Mail export verification 1/2] Downloaded message count, From, To and Subject versus selected C2C messages.');
    const comparison = compareMailExportMessages(selected, exported.map(({ headers }) => headers));
    console.table(selected.map((message) => ({
      From: message.from, To: message.to, Subject: message.subject,
      DownloadedMatches: exported.filter(({ headers }) => messageKey(headers) === messageKey(message)).length,
    })));
    console.table(exported.map(({ path, headers, bytes, identity }) => ({
      DownloadPath: path, From: headers.from, To: headers.to, Subject: headers.subject,
      Bytes: bytes.length, ...identity,
    })));
    exportLog('Mail export', 'C2C comparison',
      `Selected=${selected.length}, downloaded=${exported.length}, missing/changed=${comparison.nativeOnly.length}, extra/changed=${comparison.exportOnly.length}.`);
    if (comparison.nativeOnly.length || comparison.exportOnly.length) {
      console.table(comparison.nativeOnly.map((message) => ({ Problem: 'Missing/changed C2C message', ...message })));
      console.table(comparison.exportOnly.map((message) => ({ Problem: 'Extra/changed downloaded message', ...message })));
    }
    expect(exported.length, 'Downloaded message count differs from selected C2C count.').toBe(selected.length);
    expect(comparison.nativeOnly, 'Selected C2C messages missing or headers changed in export.').toEqual([]);
    expect(comparison.exportOnly, 'Export contains unselected messages or changed headers.').toEqual([]);
  }

  expectZohoChecksumsMatch(results: MailExportChecksumResult[]): void {
    console.table(results);
    exportLog('Mail export', 'Result',
      `Checksum matched=${results.filter(({ Matches }) => Matches).length}, failed=${results.filter(({ Matches }) => !Matches).length}.`);
    expect(results.every(({ Matches }) => Matches), 'Exported Mail raw EML SHA-256 differs from Zoho originals.').toBe(true);
    console.log(`[Mail export] Verified ${results.length} real messages against C2C headers and Zoho original MIME SHA-256.`);
  }
}
