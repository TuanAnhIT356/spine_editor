/**
 * Chat e2e: fake model backend walks the real pipeline (mock generate →
 * mock segment → rig_from_parts → walk preset) from one chat message.
 *
 * Prereqs: editor built + `vite preview` on 4173; server on 8100 started with
 * SPINE_SERVER_CHAT_FAKE=1 SPINE_SERVER_SEGMENT_FAKE=1.
 * Usage: node packages/editor/e2e/chat.mjs [outDir] [baseUrl]
 */

import fs from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = process.argv[2] ?? 'e2e-out/chat';
const BASE = process.argv[3] ?? 'http://localhost:4173/';
fs.mkdirSync(OUT, { recursive: true });

const email = `chat-${Date.now()}@example.com`;
const password = 'e2e-password-1';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto(BASE);
await page.waitForTimeout(1200);

// Register + sign in through the Server modal (same flow as server.mjs).
await page.click('button:has-text("Server")');
await page.click('.server-auth .tabs button:has-text("Register")');
await page.fill('.server-auth input[type=email]', email);
await page.fill('.server-auth input[type=password]', password);
await page.click('.server-auth button[type=submit]');
await page.waitForSelector('.server-user-row');
await page.click('.server-modal .close');

// Open the chat window and run the pipeline from one sentence.
await page.click('button:has-text("Chat")');
await page.waitForSelector('[data-testid="chat-window"]');
await page.fill('.chat-input-row textarea', 'tạo hiệp sĩ và cho nó đi bộ');
await page.click('.chat-input-row button:has-text("Send")');

// The fake script ends with screenshot_viewport ✓ then a closing text.
await page.waitForSelector('.chat-chip:has-text("apply_preset_animation")', { timeout: 120000 });
await page.waitForSelector('.chat-chip:has-text("screenshot_viewport")', { timeout: 120000 });
await page.waitForFunction(
  () =>
    document.querySelectorAll('.chat-chip').length >= 5 &&
    ![...document.querySelectorAll('.chat-chip')].some((c) => c.textContent.includes('…')),
  { timeout: 120000 },
);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/01-chat-done.png` });

const state = await page.evaluate(() => {
  const s = window.__spineEditor.getState();
  return {
    bones: s.doc.data.bones.map((b) => b.name),
    animations: Object.keys(s.doc.data.animations),
    chips: [...document.querySelectorAll('.chat-chip')].map((c) => c.textContent.trim()),
    failedChips: [...document.querySelectorAll('.chat-chip.err')].length,
  };
});

const summary = {
  chatRigWorks:
    state.bones.includes('spine') &&
    state.bones.includes('upper_leg_l') &&
    state.animations.includes('walk'),
  chipCount: state.chips.length,
  failedChips: state.failedChips,
  chips: state.chips,
  pageErrors: pageErrors.slice(0, 5),
};
console.log(JSON.stringify(summary, null, 2));
await browser.close();
if (!summary.chatRigWorks || summary.failedChips > 0) process.exit(1);
process.exit(0);
