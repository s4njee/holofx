import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '../../site');
const require = createRequire(path.join(site, 'noop.cjs'));

const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const { chromium } = require('@playwright/test');

const server = await createServer({
  root: here,
  configFile: path.join(here, 'vite.config.mjs'),
  logLevel: 'warn',
});
await server.listen();

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--mute-audio'],
});
const page = await browser.newPage();
const logs = [];
page.on('console', (message) => logs.push(`${message.type()}: ${message.text()}`));
page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));

let exitCode = 1;
try {
  await page.goto('http://127.0.0.1:5299/', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__lib, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const result = await page.evaluate(() => window.__lib);
  await page.locator('#c').screenshot({ path: path.join(here, 'shot.png') });
  console.log(JSON.stringify(result, null, 2));
  exitCode = result && result.ok && result.errors.length === 0 ? 0 : 1;
} catch (error) {
  console.error('driver error:', error.message);
} finally {
  if (logs.length) console.error('browser log:', logs.slice(0, 20).join('\n'));
  await browser.close();
  await server.close();
}
process.exit(exitCode);
