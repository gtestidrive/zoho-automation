import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import type { ZohoMailFolder } from '../api/zoho-mail.api';

export function zohoMailChecksum(folders: ZohoMailFolder[]): string {
  const normalizePath = (path: string) => path.trim().replace(/\\+/g, '\\').toLowerCase();
  const folderPaths = folders.map((folder) => normalizePath(folder.path)).sort();
  const records = folders.flatMap((folder) => folder.messages.map((message) => JSON.stringify({
    path: normalizePath(folder.path),
    from: message.from.trim().toLowerCase(),
    to: message.to.trim().toLowerCase(),
    subject: message.subject.trim().replace(/\s+/g, ' '),
    size: message.size.trim().toLowerCase(),
  }))).sort();
  return createHash('sha256').update(JSON.stringify({ folderPaths, records })).digest('hex');
}

export class MailBackupAssertions {
  expectMessagePresent(folders: ZohoMailFolder[], subject: string): void {
    expect(folders.some((folder) => folder.messages.some((message) => message.subject === subject)),
      `The sent test message "${subject}" must appear in native Zoho Mail.`).toBe(true);
  }

  expectSnapshotMatchesSource(
    sourceFolders: ZohoMailFolder[],
    snapshotFolders: ZohoMailFolder[],
  ): void {
    const sourceChecksum = zohoMailChecksum(sourceFolders);
    const snapshotChecksum = zohoMailChecksum(snapshotFolders);
    const sourceMessages = countMailMessages(sourceFolders);
    const snapshotMessages = countMailMessages(snapshotFolders);
    console.table([{
      Product: 'Mail',
      SourceFolders: sourceFolders.length,
      SnapshotFolders: snapshotFolders.length,
      SourceMessages: sourceMessages,
      SnapshotMessages: snapshotMessages,
      Status: sourceChecksum === snapshotChecksum ? 'Verified' : 'Mismatch',
    }]);
    expect(sourceChecksum, 'Zoho Mail folders or message metadata differ from the latest C2C snapshot.')
      .toBe(snapshotChecksum);
  }
}

function countMailMessages(folders: ZohoMailFolder[]): number {
  return folders.reduce((count, folder) => count + folder.messages.length, 0);
}
