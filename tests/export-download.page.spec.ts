import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { strToU8, zipSync } from 'fflate';
import { ExportDownloadPage } from '../pages/export/export-download.page';

test.use({ userAgent: 'HeadlessChrome export-download-regression' });

const cases = [
  { name: 'rejects a bucket-only link immediately', result: 'https://export.test/bucket?signature=do-not-log', success: true, status: 200, error: 'backend returned a download URL without a ZIP object path' },
  { name: 'rejects an invalid URL', result: 'invalid URL', success: true, status: 200, error: 'download-link API returned an invalid URL' },
  { name: 'rejects an unsuccessful API response', result: null, success: false, status: 200, error: 'download-link API did not return a successful URL response' },
  { name: 'rejects an HTTP failure', result: null, success: false, status: 503, error: 'download-link API failed (HTTP 503)' },
  { name: 'saves a valid ZIP link', result: 'https://export.test/archive.zip?signature=do-not-log', success: true, status: 200, error: undefined },
];

for (const scenario of cases) {
  test(`export download ${scenario.name}`, async ({ page }) => {
    const directory = await mkdtemp(join(tmpdir(), 'export-download-'));
    const archive = zipSync({ 'item.txt': strToU8('export payload') });
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (pathname === '/api/recovery/export/job/download') {
        response.writeHead(scenario.status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          success: scenario.success,
          result: scenario.result?.replace('https://export.test', origin) ?? null,
        }));
      } else if (pathname === '/archive.zip') {
        response.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="archive.zip"',
        });
        response.end(Buffer.from(archive));
      } else {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(`
          <button onclick="fetch('/api/recovery/export/job/download').then(r => r.json()).then(data => {
            if (data.success && data.result?.includes('archive.zip')) {
              const a = document.createElement('a'); a.href = data.result;
              a.download = 'archive.zip'; document.body.append(a); a.click();
            }
          })">Download</button>`);
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing local download server address.');
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      await page.goto(origin);
      const started = Date.now();
      const download = new ExportDownloadPage(page, 'Export regression').downloadZip(
        page.getByRole('button', { name: 'Download' }), directory,
      );
      if (scenario.error) {
        await expect(download).rejects.toThrow(scenario.error);
        expect(Date.now() - started).toBeLessThan(10_000);
      } else {
        expect(await readFile(await download)).toEqual(Buffer.from(archive));
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
}
