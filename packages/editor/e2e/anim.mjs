/**
 * Animate-mode smoke test: creates a bone, switches to Animate, creates an
 * animation, auto-keys two rotate poses at t=0 and t=0.5 via the Rotate tool,
 * scrubs, plays back, and checks the exported timeline JSON.
 *
 * Usage: node packages/editor/e2e/anim.mjs [outDir] [baseUrl]
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
page.on('dialog', (d) => void d.accept('walk'));

await page.goto(BASE);
await page.waitForTimeout(1500);
// Fresh document (previous autosave may exist from other runs).
await page.evaluate(() => {
  const s = window.__spineEditor.getState();
  s.replaceProject(
    { skeleton: { spine: '4.2.43' }, bones: [{ name: 'root' }], skins: [{ name: 'default' }] },
    [],
  );
});
await page.waitForTimeout(300);

// --- Create one bone in setup mode
await page.click('button:has-text("Create")');
const vp = await page.locator('.viewport').boundingBox();
const cx = vp.x + vp.width / 2;
const cy = vp.y + vp.height * 0.75;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 20, cy - 150, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(200);

// --- Switch to Animate, create animation "walk" (prompt auto-accepted)
await page.click('.modes button:has-text("Animate")');
await page.click('.timeline-header button:has-text("New")');
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/01-animate-mode.png` });

// The timeline panel takes vertical space once Animate mode is active, so the
// viewport (and the bone's screen position within it, anchored to the panel's
// top-left) is shorter than it was in setup mode — re-measure before clicking
// inside it, and keep the grab point comfortably within the shrunk bounds.
const vpAnimate = await page.locator('.viewport').boundingBox();
const originY = Math.min(cy, vpAnimate.y + vpAnimate.height - 20);

// --- Key 1 at t=0: rotate the bone with the Rotate tool (auto-key)
await page.click('button:has-text("Rotate")');
const tip = { x: cx + 20, y: originY - 150 };
await page.mouse.move(tip.x, tip.y - 10);
// grab near the bone (hitTest picks the origin at cx,originY — click the bone origin)
await page.mouse.move(cx + 2, originY - 2);
await page.mouse.down();
await page.mouse.move(cx + 120, originY - 60, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(200);

// --- Scrub to 0.5s by clicking the ruler, then key 2
await page.locator('.ruler').click({ position: { x: 0.5 * 200, y: 10 } });
await page.waitForTimeout(200);
await page.mouse.move(cx + 2, originY - 2);
await page.mouse.down();
await page.mouse.move(cx - 120, originY - 60, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/02-two-keys.png` });

// --- Scrub to 0.25s: pose must interpolate between the keys
await page.locator('.ruler').click({ position: { x: 0.25 * 200, y: 10 } });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/03-scrub-midway.png` });

const stateAtQuarter = await page.evaluate(() => {
  const s = window.__spineEditor.getState();
  return { time: s.anim.time, playing: s.anim.playing };
});

// --- Play and confirm time advances and the pose changes
await page.click('button:has-text("Play")');
await page.waitForTimeout(350);
await page.screenshot({ path: `${OUT}/04-playing.png` });
const stateWhilePlaying = await page.evaluate(() => {
  const s = window.__spineEditor.getState();
  return { time: s.anim.time, playing: s.anim.playing };
});
await page.click('button:has-text("Pause")');

// --- Export: timeline must contain 2 rotate keys with offset values
const exported = await page.evaluate(() => window.__spineEditor.getState().doc.toJson());
fs.writeFileSync(`${OUT}/exported.json`, JSON.stringify(exported, null, 2));
const issues = await page.evaluate(() => window.__spineEditor.getState().doc.validate());

// --- Probe: undo removes the last key
const keysBeforeUndo = exported.animations?.walk?.bones?.bone?.rotate?.length ?? 0;
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
const keysAfterUndo = await page.evaluate(
  () =>
    window.__spineEditor.getState().doc.getAnimation('walk')?.bones?.['bone']?.rotate?.length ?? 0,
);

// --- Probe: drag the remaining key in the dopesheet from t=0 to ~t=0.8
await page.keyboard.press('Control+Shift+z'); // redo, back to 2 keys
await page.waitForTimeout(200);
const keyEl = page.locator('.track .key').first();
const keyBox = await keyEl.boundingBox();
await page.mouse.move(keyBox.x + 5, keyBox.y + 5);
await page.mouse.down();
await page.mouse.move(keyBox.x + 5 + 0.8 * 200, keyBox.y + 5, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(200);
const keyTimesAfterDrag = await page.evaluate(() =>
  (window.__spineEditor.getState().doc.getAnimation('walk')?.bones?.['bone']?.rotate ?? []).map(
    (k) => k.time ?? 0,
  ),
);

console.log(
  JSON.stringify(
    {
      animations: exported.animations,
      issues,
      stateAtQuarter,
      stateWhilePlaying,
      keysBeforeUndo,
      keysAfterUndo,
      keyTimesAfterDrag,
      pageErrors,
    },
    null,
    2,
  ),
);
await browser.close();
