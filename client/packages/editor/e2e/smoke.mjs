/**
 * Browser smoke test: drives the built editor (vite preview) with a real
 * Chromium via playwright-core. Creates bones with the mouse, imports an
 * image, attaches it, translates a bone, undoes, checks autosave across a
 * reload, and dumps the exported Spine JSON.
 *
 * Usage: node packages/editor/e2e/smoke.mjs [outDir] [baseUrl]
 */

import fs from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = process.argv[2] ?? 'e2e-out';
const BASE = process.argv[3] ?? 'http://localhost:4173/';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(m.text());
});

await page.addInitScript(() =>
  window.localStorage.setItem(
    'spine-editor.settings',
    JSON.stringify({ fps: 30, autosave: true, welcome: false }),
  ),
);
await page.goto(BASE);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/01-initial.png` });

// --- Create two bones with the Create tool (drag on canvas)
await page.click('button:has-text("Create")');
const vp = await page.locator('.viewport').boundingBox();
const cx = vp.x + vp.width / 2 - 250; // clear of the bottom-center tool cluster
const cy = vp.y + vp.height * 0.45;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 60, cy - 120, { steps: 8 });
await page.mouse.up();
await page.mouse.move(cx + 60, cy - 120);
await page.mouse.down();
await page.mouse.move(cx + 140, cy - 180, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/02-bones-created.png` });
const treeText = await page.locator('.tree').innerText();

// --- Generate a PNG in-browser, import it, attach to the first created bone
const dataUrl = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d9773b';
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#7a3c14';
  g.fillRect(0, 0, 64, 16);
  return c.toDataURL('image/png');
});
fs.writeFileSync(`${OUT}/arm.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
await page.setInputFiles('input[type=file][multiple]', `${OUT}/arm.png`);
await page.waitForTimeout(400);
await page.locator('.tree .row.bone').filter({ hasText: 'bone' }).first().click();
await page.click('.assets button:has-text("Attach")');
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/03-image-attached.png` });

// --- Translate the second bone with the Translate tool
await page.click('button:has-text("Translate")');
await page.mouse.move(cx + 60, cy - 120);
await page.mouse.down();
await page.mouse.move(cx + 30, cy - 60, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/04-translated.png` });

// --- Undo the translation via keyboard
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/05-after-undo.png` });

// --- Probe: try deleting the root bone (must be blocked with an error)
await page.locator('.tree .row.bone').filter({ hasText: 'root' }).first().click();
await page.keyboard.press('Delete');
await page.waitForTimeout(200);
const errBanner = await page
  .locator('.error-banner')
  .innerText()
  .catch(() => '(no banner)');

// --- Export state + validation via the exposed store
const exported = await page.evaluate(() => window.__spineEditor.getState().doc.toJsonString(2));
fs.writeFileSync(`${OUT}/exported.json`, exported);
const issues = await page.evaluate(() => window.__spineEditor.getState().doc.validate());

// --- Autosave probe: wait past the debounce, reload, check the rig survived
await page.waitForTimeout(1400);
await page.reload();
await page.waitForTimeout(1500);
const bonesAfterReload = await page.evaluate(() =>
  window.__spineEditor.getState().doc.data.bones.map((b) => b.name),
);
const slotsAfterReload = await page.evaluate(() =>
  window.__spineEditor.getState().doc.data.slots.map((s) => s.name),
);
await page.screenshot({ path: `${OUT}/06-after-reload.png` });

console.log(
  JSON.stringify(
    { treeText, errBanner, issues, bonesAfterReload, slotsAfterReload, pageErrors },
    null,
    2,
  ),
);
await browser.close();
