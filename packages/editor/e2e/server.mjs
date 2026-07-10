/**
 * Backend e2e: drives the built editor (vite preview) against a running
 * Python server with a real Chromium. Registers an account, saves the rig as
 * a server project, reloads (session restored from the refresh cookie),
 * opens the project from the dashboard, and exercises forgot/reset password
 * through the dev outbox.
 *
 * Prereqs: editor built + `vite preview` on 4173, server on 8100 with
 * SPINE_SERVER_DATA_DIR pointing at a fresh dir (pass it as arg 3 so this
 * script can read the reset-token outbox).
 *
 * Usage: node packages/editor/e2e/server.mjs [outDir] [baseUrl] [serverDataDir]
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const OUT = process.argv[2] ?? 'e2e-out/server';
const BASE = process.argv[3] ?? 'http://localhost:4173/';
const DATA_DIR = process.argv[4] ?? '';
fs.mkdirSync(OUT, { recursive: true });

const email = `e2e-${Date.now()}@example.com`;
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

// --- Register a fresh account through the Server modal
await page.click('button:has-text("Server")');
await page.click('.server-auth .tabs button:has-text("Register")');
await page.fill('.server-auth input[type=email]', email);
await page.fill('.server-auth input[type=password]', password);
await page.click('.server-auth button[type=submit]');
await page.waitForSelector('.server-user-row');
await page.screenshot({ path: `${OUT}/01-signed-in.png` });

// --- Store an API key, verify it lists masked
await page.fill('.server-keys .key-row:has-text("openai") input', 'sk-e2e-test-key-abcd');
await page.click('.server-keys .key-row:has-text("openai") button:has-text("Save")');
await page.waitForTimeout(400);
const maskedKey = await page
  .locator('.server-keys .key-row:has-text("openai") .key-masked')
  .innerText();
await page.click('.server-modal .close');

// --- Build a tiny rig, then save it as a server project
await page.click('button:has-text("Create")');
const vp = await page.locator('.viewport').boundingBox();
const cx = vp.x + vp.width / 2;
const cy = vp.y + vp.height * 0.7;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 80, cy - 100, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);

page.once('dialog', (d) => void d.accept('e2e walker'));
await page.click('button:has-text("Projects")');
await page.click('button:has-text("Save as new project")');
await page.waitForSelector('.project-row');
await page.screenshot({ path: `${OUT}/02-project-saved.png` });
const projectRow = await page.locator('.project-row').first().innerText();
await page.click('.server-modal .close');

// --- Reload: session must come back via the refresh cookie
await page.reload();
await page.waitForTimeout(1500);
const serverButton = await page.locator('button:has-text("Server")').innerText();

// --- Open the saved project from the dashboard into the editor
await page.click('button:has-text("Projects")');
await page.waitForSelector('.project-row');
await page.click('.project-row button:has-text("Open")');
await page.waitForTimeout(500);
const bonesAfterOpen = await page.evaluate(() =>
  window.__spineEditor.getState().doc.data.bones.map((b) => b.name),
);
await page.screenshot({ path: `${OUT}/03-project-opened.png` });

// --- Forgot/reset password via the dev outbox
await page.click('button:has-text("Server")');
await page.click('.server-user-row button:has-text("Log out")');
await page.waitForSelector('.server-auth');
await page.click('.server-auth .tabs button:has-text("Forgot")');
await page.fill('.server-auth input[type=email]', email);
await page.click('.server-auth button[type=submit]');
await page.waitForTimeout(600);

let resetOk = 'skipped (no data dir)';
if (DATA_DIR) {
  const outbox = fs.readFileSync(path.join(DATA_DIR, 'outbox.log'), 'utf8').trim().split('\n');
  const token = /token=(\S+)/.exec(outbox[outbox.length - 1])[1];
  await page.fill('.server-auth input:not([type=email]):not([type=password])', token);
  await page.fill('.server-auth input[type=password]', 'e2e-new-password-1');
  await page.click('.server-auth button[type=submit]');
  await page.waitForSelector('.form-notice');
  await page.fill('.server-auth input[type=email]', email);
  await page.fill('.server-auth input[type=password]', 'e2e-new-password-1');
  await page.click('.server-auth button[type=submit]');
  await page.waitForSelector('.server-user-row');
  resetOk = 'reset + re-login ok';
}
await page.screenshot({ path: `${OUT}/04-after-reset.png` });

console.log(
  JSON.stringify(
    { email, maskedKey, projectRow, serverButton, bonesAfterOpen, resetOk, pageErrors },
    null,
    2,
  ),
);
await browser.close();
