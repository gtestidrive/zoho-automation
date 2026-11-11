import { expect, type Download, type Locator, type Page, type Response } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { ExportDownloadLocators } from './export-download.locators';
import { exportLog } from './export-log';

export class ExportDownloadPage {
  private readonly locators = new ExportDownloadLocators();

  constructor(private readonly page: Page, private readonly product: string) { }

  async downloadZip(action: Locator, directory: string): Promise<string> {
    const started = Date.now();
    exportLog(this.product, 'Download', `Clicking download; destination="${directory}", timeout=180s.`);
    let downloadsPage: Page | undefined;
    let download: Download | undefined;
    let saving: Promise<void> | undefined;
    let archivePath: string | undefined;
    let saveError: unknown;
    let failed = false;
    let linkError: Error | undefined;
    const pendingResponses = new Set<Promise<void>>();
    const onResponse = (response: Response): void => {
      const url = new URL(response.url());
      if (url.origin !== new URL(this.page.url()).origin
        || !/^\/api\/recovery\/export\/[^/]+\/download\/?$/.test(url.pathname)) {
        return;
      }
      const inspection = this.inspectDownloadLink(response).catch((error: unknown) => {
        linkError = error instanceof Error ? error : new Error('Export download-link inspection failed.', { cause: error });
      });
      pendingResponses.add(inspection);
      void inspection.then(() => pendingResponses.delete(inspection));
    };
    const onDownload = (value: Download): void => { download = value; };
    this.page.on('download', onDownload);
    this.page.on('response', onResponse);
    try {
      const headless = await this.page.evaluate(() => navigator.userAgent.includes('HeadlessChrome'));
      if (!headless) {
        downloadsPage = await this.page.context().newPage();
        await downloadsPage.goto('chrome://downloads/');
        await expect(this.locators.manager(downloadsPage)).toBeAttached();
      }
      const previousIds = new Set(downloadsPage
        ? (await this.readItems(downloadsPage)).flatMap((item) => item ? [item.id] : [])
        : []);
      await this.page.bringToFront();
      await action.click();
      await expect.poll(async () => {
        if (linkError) return true;
        if (downloadsPage) {
          await this.keepNewInsecureZip(downloadsPage, previousIds);
        }
        if (download && !saving) {
          saving = this.saveZip(download, directory).then((path) => {
            archivePath = path;
          }, (error: unknown) => {
            saveError = error;
            failed = true;
          });
        }
        return failed || archivePath !== undefined;
      }, {
        timeout: 180_000,
        intervals: [500, 1_000],
        message: `Waiting for ${this.product} ZIP download, accepting Chrome Keep for an insecure ZIP if present.`,
      }).toBe(true);
      await Promise.all(pendingResponses);
      if (linkError) throw linkError;
      if (failed) throw saveError;
      if (!archivePath) {
        throw new Error(`${this.product} download finished without a saved ZIP.`);
      }
      exportLog(this.product, 'Download saved',
        `ZIP="${archivePath}", bytes=${(await stat(archivePath)).size}, elapsed=${((Date.now() - started) / 1000).toFixed(1)}s.`);
      return archivePath;
    } catch (error) {
      console.error(`[${this.product}] Download FAILED after ${((Date.now() - started) / 1000).toFixed(1)}s; `
        + `destination="${directory}", browser download event received=${download !== undefined}.`, error);
      throw error;
    } finally {
      this.page.off('download', onDownload);
      this.page.off('response', onResponse);
      await Promise.all(pendingResponses);
      await downloadsPage?.close();
    }
  }

  private async inspectDownloadLink(response: Response): Promise<void> {
    if (!response.ok()) {
      throw new Error(`${this.product} download-link API failed (HTTP ${response.status()}).`);
    }
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null || !('result' in body)
      || typeof body.result !== 'string' || 'success' in body && body.success === false) {
      throw new Error(`${this.product} download-link API did not return a successful URL response.`);
    }
    let url: URL;
    try {
      url = new URL(body.result);
    } catch {
      throw new Error(`${this.product} download-link API returned an invalid URL.`);
    }
    if (!/^https?:$/.test(url.protocol) || !/\.zip$/i.test(url.pathname)) {
      throw new Error(`${this.product} backend returned a download URL without a ZIP object path. `
        + 'The export may be ACTIVE, but its downloadable archive link is invalid; no checksum verification is possible.');
    }
    exportLog(this.product, 'Download link', `API returned HTTP ${response.status()} with a ZIP object path. Signed URL credentials are not logged.`);
  }

  private async keepNewInsecureZip(page: Page, previousIds: Set<string>): Promise<void> {
    const blocked = (await this.readItems(page)).flatMap((item, index) =>
      item && !previousIds.has(item.id) && item.isInsecure && /\.zip$/i.test(item.fileName)
        ? [{ ...item, index }] : []);
    if (blocked.length > 1) {
      throw new Error(`Multiple new insecure ZIP downloads found; cannot identify ${this.product} safely.`);
    }
    const item = blocked[0];
    if (!item) {
      return;
    }
    const row = this.locators.items(page).nth(item.index);
    const keep = this.locators.keep(row);
    if (!await keep.isVisible()) {
      const menu = this.locators.menu(row);
      if (!await menu.isVisible()) {
        return;
      }
      await menu.click();
    }
    await expect(keep).toBeVisible({ timeout: 5_000 });
    await keep.click();
    previousIds.add(item.id);
    console.log(`[${this.product}] Clicked Chrome Keep for "${item.fileName}".`);
  }

  private async saveZip(download: Download, directory: string): Promise<string> {
    const filename = download.suggestedFilename();
    if (!filename || basename(filename) !== filename || !/\.zip$/i.test(filename)) {
      throw new Error(`Expected ${this.product} ZIP archive, received "${filename}".`);
    }

    await mkdir(directory, { recursive: true });
    const archivePath = join(directory, `export-${Date.now()}-${filename}`);
    await download.saveAs(archivePath);
    return archivePath;
  }

  private async readItems(page: Page) {
    return this.locators.items(page).evaluateAll((items) => items.map((item) => {
      if (!('data' in item) || typeof item.data !== 'object' || item.data === null) return null;
      const data = item.data;
      if (!('id' in data) || typeof data.id !== 'string'
        || !('fileName' in data) || typeof data.fileName !== 'string'
        || !('isInsecure' in data) || typeof data.isInsecure !== 'boolean') {
        throw new Error('Chrome download item has an unsupported data format.');
      }
      return { id: data.id, fileName: data.fileName, isInsecure: data.isInsecure };
    }));
  }
}
