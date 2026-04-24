#!/usr/bin/env node
// Drive ChatGPT (in user's already-open Chrome via CDP) to generate images and save them locally.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { uploadImage } = require('./upload');

function parseArgs(argv) {
  const args = { output: './images', cdp: 'http://127.0.0.1:9222', start: 0, timeoutMs: 180000 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--prompt') args.prompt = next();
    else if (a === '--prompts') args.prompts = next();
    else if (a === '--output') args.output = next();
    else if (a === '--start') args.start = parseInt(next(), 10) || 0;
    else if (a === '--cdp') args.cdp = next();
    else if (a === '--timeout') args.timeoutMs = parseInt(next(), 10);
    else if (a === '--upload') args.upload = true;
    else if (a === '--upload-base') args.uploadBase = next();
    else if (a === '--upload-key-env') args.uploadKeyEnv = next();
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node generate.js (--prompt "..." | --prompts file.json) [--output ./images] [--start N] [--cdp http://127.0.0.1:9222]');
      process.exit(0);
    }
  }
  return args;
}

async function findOrOpenChatGPT(browser) {
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      const url = p.url();
      if (url.startsWith('https://chatgpt.com') || url.startsWith('https://chat.openai.com')) {
        await p.bringToFront();
        return p;
      }
    }
  }
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
  return page;
}

async function submitPrompt(page, prompt) {
  // Try several known selectors for the composer
  const selectors = [
    '#prompt-textarea',
    'div[contenteditable="true"][data-virtualkeyboard="true"]',
    'div[contenteditable="true"]',
    'textarea[data-id]',
    'textarea',
  ];
  let composer = null;
  for (const sel of selectors) {
    composer = await page.$(sel);
    if (composer) break;
  }
  if (!composer) throw new Error('Could not find ChatGPT composer');
  await composer.click();
  // Clear any existing text
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(prompt, { delay: 5 });
  // Send
  await page.keyboard.press('Enter');
}

async function snapshotExistingImageSrcs(page) {
  return page.evaluate(() => {
    const seen = new Set();
    document.querySelectorAll('main img').forEach((i) => {
      const s = i.currentSrc || i.src || '';
      if (/estuary\/content|oaiusercontent/.test(s)) seen.add(s);
    });
    return [...seen];
  });
}

async function waitForGeneratedImage(page, beforeSet, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const before = new Set(beforeSet);
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const src = await page.evaluate((before) => {
        const beforeSet = new Set(before);
        const imgs = [...document.querySelectorAll('main img')]
          .filter((i) => /estuary\/content|oaiusercontent/.test(i.currentSrc || i.src || ''))
          .filter((i) => (i.naturalWidth || 0) >= 256);
        for (let k = imgs.length - 1; k >= 0; k--) {
          const s = imgs[k].currentSrc || imgs[k].src;
          if (!beforeSet.has(s)) return s;
        }
        return null;
      }, [...before]);
      if (src) return src;
    } catch (e) {
      lastErr = e;
    }
    await page.waitForTimeout(1500);
  }
  throw new Error(`Timed out waiting for image${lastErr ? ': ' + lastErr.message : ''}`);
}

async function downloadImage(page, url, destPath) {
  // Use the page's fetch so cookies/auth headers are included
  const result = await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = await r.arrayBuffer();
    // Convert to base64 in chunks to avoid stack overflow
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }, url);
  fs.writeFileSync(destPath, Buffer.from(result, 'base64'));
}

function loadPrompts(args) {
  if (args.prompt) return [args.prompt];
  if (args.prompts) {
    const raw = fs.readFileSync(args.prompts, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('prompts file must be a JSON array');
    return parsed;
  }
  throw new Error('Provide --prompt "..." or --prompts file.json');
}

(async () => {
  const args = parseArgs(process.argv);
  const prompts = loadPrompts(args);
  fs.mkdirSync(args.output, { recursive: true });
  const logPath = path.join(args.output, 'results.jsonl');

  console.log(`[chatgpt-image-gen] Connecting to Chrome at ${args.cdp} ...`);
  const browser = await chromium.connectOverCDP(args.cdp);
  const page = await findOrOpenChatGPT(browser);
  console.log(`[chatgpt-image-gen] Using tab: ${page.url()}`);

  for (let i = args.start; i < prompts.length; i++) {
    const prompt = prompts[i];
    const idx = String(i + 1).padStart(3, '0');
    const file = path.join(args.output, `${idx}.png`);
    const entry = { index: i, prompt, file, ok: false };
    try {
      console.log(`[${idx}] Submitting: ${prompt.slice(0, 80)}${prompt.length > 80 ? '…' : ''}`);
      const before = await snapshotExistingImageSrcs(page);
      await submitPrompt(page, prompt);
      console.log(`[${idx}] Waiting for image (up to ${args.timeoutMs / 1000}s)…`);
      const src = await waitForGeneratedImage(page, before, args.timeoutMs);
      console.log(`[${idx}] Got image URL, downloading…`);
      await downloadImage(page, src, file);
      entry.ok = true;
      entry.src = src;
      console.log(`[${idx}] Saved → ${file}`);
      if (args.upload) {
        const keyEnv = args.uploadKeyEnv || 'ZAYN_IMAGE_KEY';
        const uploadKey = (process.env[keyEnv] || '').trim();
        if (!uploadKey) throw new Error(`${keyEnv} not set; cannot --upload`);
        const up = await uploadImage({
          baseUrl: args.uploadBase || 'https://image.zaynjarvis.com',
          uploadKey,
          filePath: file,
        });
        entry.uploadUrl = up.url;
        entry.uploadDuplicate = !!up.duplicate;
        console.log(`[${idx}] Uploaded → ${up.url}${up.duplicate ? ' (dup)' : ''}`);
      }
    } catch (e) {
      entry.error = e.message;
      console.error(`[${idx}] FAILED: ${e.message}`);
    }
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  }

  console.log('[chatgpt-image-gen] Done. Browser left open.');
  // Don't close the user's browser
  await browser.close().catch(() => {}); // disconnects CDP, doesn't kill Chrome
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
