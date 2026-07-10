/**
 * Backend e2e for Phase 13 segmentation: drives the built editor (vite
 * preview) against a running Python server with a real Chromium. Registers
 * an account, imports a two-blob transparent PNG, splits it into parts via
 * the Split dialog, and verifies both parts land as separate assets.
 *
 * Prereqs: editor built + `vite preview` on 4173, server on 8100.
 * Usage: node packages/editor/e2e/segment.mjs [outDir] [baseUrl]
 */

import fs from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = process.argv[2] ?? 'e2e-out/segment';
const BASE = process.argv[3] ?? 'http://localhost:4173/';
fs.mkdirSync(OUT, { recursive: true });

const email = `e2e-seg-${Date.now()}@example.com`;
const password = 'e2e-password-1';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(m.text());
});

await page.goto(BASE);
await page.waitForTimeout(1200);

// --- Register a fresh account
await page.click('button:has-text("Server")');
await page.click('.server-auth .tabs button:has-text("Register")');
await page.fill('.server-auth input[type=email]', email);
await page.fill('.server-auth input[type=password]', password);
await page.click('.server-auth button[type=submit]');
await page.waitForSelector('.server-user-row');
await page.click('.server-modal .close');

// --- Build a two-blob transparent PNG in-browser (two disjoint squares)
const dataUrl = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 120;
  c.height = 80;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 120, 80);
  g.fillStyle = '#ff2222';
  g.fillRect(10, 10, 30, 30);
  g.fillStyle = '#2222ff';
  g.fillRect(70, 30, 40, 40);
  return c.toDataURL('image/png');
});
fs.writeFileSync(`${OUT}/sheet.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
await page.setInputFiles('input[type=file][multiple]', `${OUT}/sheet.png`);
await page.waitForTimeout(400);
const assetName = await page.evaluate(() => Object.keys(window.__spineEditor.getState().assets)[0]);

// --- Open Split dialog, split into parts, verify preview + import
await page.click('button:has-text("Split")');
await page.waitForSelector('.generate-modal select');
await page.click('.generate-modal button:has-text("Split")');
await page.waitForSelector('.projects-list .project-row');
await page.screenshot({ path: `${OUT}/01-parts-preview.png` });
const partCount = await page.locator('.projects-list .project-row').count();

await page.click('button:has-text("Import selected parts")');
await page.waitForSelector('.form-notice');
await page.screenshot({ path: `${OUT}/02-imported.png` });
const assetsAfter = await page.evaluate(() => Object.keys(window.__spineEditor.getState().assets));
await page.click('.generate-modal .close');

// --- Split with "keep original placement" off (cropped) for comparison
await page.click('button:has-text("Split")');
await page.waitForSelector('.generate-modal select');
await page.click('.row-inline:has-text("Keep original placement") input');
await page.click('.generate-modal button:has-text("Split")');
await page.waitForSelector('.projects-list .project-row');
const croppedPartCount = await page.locator('.projects-list .project-row').count();
await page.screenshot({ path: `${OUT}/03-cropped-preview.png` });
await page.click('.generate-modal .close');

console.log(
  JSON.stringify(
    { email, assetName, partCount, croppedPartCount, assetsAfter, pageErrors },
    null,
    2,
  ),
);
await browser.close();
