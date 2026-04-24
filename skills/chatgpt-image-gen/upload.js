#!/usr/bin/env node
// Upload a local image to https://image.zaynjarvis.com and print the resulting URL.
// Mirrors the multipart contract used by studio/scripts/upload_images_zayn.py.
//
//   node upload.js ./images/001.png [--base-url URL] [--key-env NAME] [--delete]

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { baseUrl: 'https://image.zaynjarvis.com', keyEnv: 'ZAYN_IMAGE_KEY', deleteLocal: false };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base-url') args.baseUrl = argv[++i];
    else if (a === '--key-env') args.keyEnv = argv[++i];
    else if (a === '--delete' || a === '--delete-local') args.deleteLocal = true;
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node upload.js <file> [--base-url URL] [--key-env NAME] [--delete]');
      process.exit(0);
    } else positional.push(a);
  }
  args.file = positional[0];
  return args;
}

function guessMime(name) {
  const ext = path.extname(name).toLowerCase();
  return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[ext] || 'application/octet-stream';
}

async function uploadImage({ baseUrl, uploadKey, filePath }) {
  const boundary = `----studio-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  const fileBytes = fs.readFileSync(filePath);
  const filename = path.basename(filePath);
  const mime = guessMime(filename);

  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="uploadKey"\r\n\r\n${uploadKey}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
    'utf8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const body = Buffer.concat([head, fileBytes, tail]);

  const endpoint = baseUrl.replace(/\/$/, '') + '/api/upload';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Origin': baseUrl.replace(/\/$/, ''),
      'Referer': baseUrl.replace(/\/$/, '') + '/',
      'User-Agent': 'curl/8.7.1',
    },
    body,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }
  const payload = await res.json();
  if (!payload.url) throw new Error(`Upload response missing url: ${JSON.stringify(payload)}`);
  return payload;
}

if (require.main === module) {
  (async () => {
    const args = parseArgs(process.argv);
    if (!args.file) { console.error('Usage: node upload.js <file>'); process.exit(2); }
    const uploadKey = (process.env[args.keyEnv] || '').trim();
    if (!uploadKey) { console.error(`${args.keyEnv} is not set`); process.exit(1); }
    const abs = path.resolve(args.file);
    if (!fs.existsSync(abs)) { console.error(`Not found: ${abs}`); process.exit(1); }

    const result = await uploadImage({ baseUrl: args.baseUrl, uploadKey, filePath: abs });
    console.log(JSON.stringify(result, null, 2));
    if (args.deleteLocal) {
      try { fs.unlinkSync(abs); console.error(`[upload] removed local ${abs}`); }
      catch (e) { console.error(`[upload] failed to remove ${abs}: ${e.message}`); }
    }
  })().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
}

module.exports = { uploadImage };
