#!/usr/bin/env node
// Generate a short video from one-or-more reference images via ByteDance Seedance 2.0
// on Volcengine Ark (mainland-China region by default — Zayn's account lives there).
//
// This script ONLY generates and saves an MP4 to disk. Showing it to the user and any
// follow-up upload / cleanup are deliberately separate concerns — see SKILL.md.
//
// Submit:  POST   https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks
// Poll:    GET    https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{id}
// Auth:    Authorization: Bearer $ARK_API_KEY
//
// Usage:
//   ARK_API_KEY=... node generate.js \
//     --prompt "@image1 walks toward @image2 holding the team flag" \
//     --image https://image.zaynjarvis.com/i/.../girl.png \
//     --image https://image.zaynjarvis.com/i/.../dog.png \
//     [--resolution 2k] [--ratio 16:9] [--duration 15] \
//     [--fast] [--audio] [--seed 42] \
//     [--output ./videos] [--name first.mp4]

const fs = require('fs');
const path = require('path');

const ARK_BASE_CN = 'https://ark.cn-beijing.volces.com/api/v3';
const ARK_BASE_GLOBAL = 'https://ark.ap-southeast.bytepluses.com/api/v3';

const MODEL_STD = 'doubao-seedance-2-0-260128';
const MODEL_FAST = 'doubao-seedance-2-0-fast-260128';

const ALLOWED_RESOLUTION = new Set(['480p', '720p', '1080p', '2k']);
const ALLOWED_RATIO = new Set(['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);

function parseArgs(argv) {
  const args = {
    images: [],
    output: './videos',
    resolution: '2k',
    ratio: 'adaptive',
    duration: 15,
    fast: false,
    audio: false,
    region: 'cn',
    pollMs: 5000,
    timeoutMs: 30 * 60 * 1000,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--prompt') args.prompt = next();
    else if (a === '--image') args.images.push(next());
    else if (a === '--first-frame') args.firstFrame = next();
    else if (a === '--last-frame') args.lastFrame = next();
    else if (a === '--output') args.output = next();
    else if (a === '--name') args.name = next();
    else if (a === '--resolution') args.resolution = next().toLowerCase();
    else if (a === '--ratio' || a === '--aspect-ratio' || a === '--aspect') args.ratio = next();
    else if (a === '--duration') args.duration = parseInt(next(), 10);
    else if (a === '--fast') args.fast = true;
    else if (a === '--audio') args.audio = true;
    else if (a === '--watermark') args.watermark = true;
    else if (a === '--no-watermark') args.watermark = false;
    else if (a === '--camera-fixed') args.cameraFixed = true;
    else if (a === '--frames') args.frames = parseInt(next(), 10);
    else if (a === '--callback-url') args.callbackUrl = next();
    else if (a === '--return-last-frame') args.returnLastFrame = true;
    else if (a === '--seed') args.seed = parseInt(next(), 10);
    else if (a === '--region') args.region = next();
    else if (a === '--poll-ms') args.pollMs = parseInt(next(), 10);
    else if (a === '--timeout') args.timeoutMs = parseInt(next(), 10);
    else if (a === '--model') args.modelOverride = next();
    else if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
    else { console.error(`Unknown arg: ${a}`); process.exit(2); }
  }
  if (!args.prompt) { console.error('Missing --prompt'); process.exit(2); }
  const haveAnyImage = args.images.length > 0 || args.firstFrame || args.lastFrame;
  if (!haveAnyImage) {
    console.error('Need at least one image: --image (repeatable, reference) or --first-frame / --last-frame');
    process.exit(2);
  }
  if (!ALLOWED_RESOLUTION.has(args.resolution)) {
    console.error(`--resolution must be one of: ${[...ALLOWED_RESOLUTION].join(', ')}`);
    process.exit(2);
  }
  if (!ALLOWED_RATIO.has(args.ratio)) {
    console.error(`--ratio must be one of: ${[...ALLOWED_RATIO].join(', ')}`);
    process.exit(2);
  }
  if (!Number.isInteger(args.duration) || args.duration < 4 || args.duration > 15) {
    console.error('--duration must be an integer 4..15');
    process.exit(2);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node generate.js --prompt "..." --image URL [--image URL ...] [options]

Required:
  --prompt TEXT           Text prompt. Reference reference-images in-prompt as @image1, @image2 ...
  --image URL             Reference image URL (repeatable). Must be reachable by Ark's servers.

Alternative single-image inputs (instead of, or alongside, --image):
  --first-frame URL       Use this image as the video's first frame.
  --last-frame URL        Use this image as the video's last frame.

Output:
  --output DIR            Output dir (default ./videos)
  --name FILE             Output filename (default: 001.mp4, 002.mp4, ...)

Generation params (defaults in [brackets]):
  --resolution VAL        480p | 720p | 1080p | 2k   [2k — highest]
  --ratio VAL             adaptive | 21:9 | 16:9 | 4:3 | 1:1 | 3:4 | 9:16   [adaptive]
  --duration N            4..15 seconds   [15]
  --frames N              Alternative to --duration; takes precedence if both set.
  --audio                 Generate synchronized audio (off by default per Zayn's instruction)
  --no-watermark          Strip Ark watermark (account default usually has it on).
  --watermark             Force watermark on.
  --camera-fixed          Lock the camera — no pans/zooms.
  --return-last-frame     Also return the last frame as a still (useful for sequencing clips).
  --callback-url URL      Ark webhooks the URL when the task finishes (instead of polling).
  --seed N                Reproducibility seed.
  --fast                  Use doubao-seedance-2-0-fast-260128 (cheaper, faster, slightly lower quality).
  --model ID              Override the model ID entirely.

Routing:
  --region cn|global      cn=ark.cn-beijing.volces.com (default), global=ark.ap-southeast.bytepluses.com
  --poll-ms MS            Queue poll interval (default 5000)
  --timeout MS            Total wait limit (default 30 min)

Env:
  ARK_API_KEY             Required. Volcengine Ark API key (starts with "ark-").
`);
}

function nextOutputPath(outDir, explicitName) {
  fs.mkdirSync(outDir, { recursive: true });
  if (explicitName) return path.join(outDir, explicitName);
  for (let n = 1; n < 10000; n++) {
    const candidate = path.join(outDir, String(n).padStart(3, '0') + '.mp4');
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Could not find a free output filename');
}

async function arkPost(url, key, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`POST ${url} → HTTP ${res.status}: ${txt}`);
  return JSON.parse(txt);
}

async function arkGet(url, key) {
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${key}` } });
  const txt = await res.text();
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}: ${txt}`);
  return JSON.parse(txt);
}

function buildContent(args) {
  const items = [{ type: 'text', text: args.prompt }];
  if (args.firstFrame) {
    items.push({ type: 'image_url', image_url: { url: args.firstFrame }, role: 'first_frame' });
  }
  for (const u of args.images) {
    items.push({ type: 'image_url', image_url: { url: u }, role: 'reference_image' });
  }
  if (args.lastFrame) {
    items.push({ type: 'image_url', image_url: { url: args.lastFrame }, role: 'last_frame' });
  }
  return items;
}

function buildBody(args, model) {
  const body = {
    model,
    content: buildContent(args),
    resolution: args.resolution,
    ratio: args.ratio,
    duration: args.duration,
    generate_audio: !!args.audio,
  };
  if (typeof args.frames === 'number' && !Number.isNaN(args.frames)) body.frames = args.frames;
  if (typeof args.seed === 'number' && !Number.isNaN(args.seed)) body.seed = args.seed;
  if (typeof args.watermark === 'boolean') body.watermark = args.watermark;
  if (args.cameraFixed) body.camera_fixed = true;
  if (args.returnLastFrame) body.return_last_frame = true;
  if (args.callbackUrl) body.callback_url = args.callbackUrl;
  return body;
}

async function downloadTo(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download ${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

async function main() {
  const args = parseArgs(process.argv);
  const key = (process.env.ARK_API_KEY || '').trim();
  if (!key) { console.error('ARK_API_KEY env var is not set.'); process.exit(1); }

  const base = args.region === 'global' ? ARK_BASE_GLOBAL : ARK_BASE_CN;
  const model = args.modelOverride || (args.fast ? MODEL_FAST : MODEL_STD);
  const body = buildBody(args, model);
  const outPath = nextOutputPath(args.output, args.name);

  console.error(`[seedance] region=${args.region} model=${model}`);
  console.error(`[seedance] images=${args.images.length}${args.firstFrame ? ' +first-frame' : ''}${args.lastFrame ? ' +last-frame' : ''} resolution=${args.resolution} ratio=${args.ratio} duration=${args.duration}s audio=${!!args.audio}${args.fast ? ' fast' : ''}`);
  console.error(`[seedance] output=${outPath}`);

  const submitUrl = `${base}/contents/generations/tasks`;
  const submitted = await arkPost(submitUrl, key, body);
  const taskId = submitted.id || submitted.task_id;
  if (!taskId) throw new Error(`No task id in submit response: ${JSON.stringify(submitted)}`);
  console.error(`[seedance] submitted task_id=${taskId}`);

  const pollUrl = `${base}/contents/generations/tasks/${taskId}`;
  const start = Date.now();
  let lastLog = 0;
  let final = null;
  while (true) {
    if (Date.now() - start > args.timeoutMs) {
      throw new Error(`Timed out after ${Math.round(args.timeoutMs / 1000)}s waiting on ${taskId}`);
    }
    const st = await arkGet(pollUrl, key);
    const status = (st.status || '').toLowerCase();
    if (status === 'succeeded') { final = st; break; }
    if (['failed', 'cancelled', 'expired'].includes(status)) {
      throw new Error(`Task ${taskId} ended status=${status}: ${JSON.stringify(st)}`);
    }
    if (Date.now() - lastLog > 15000) {
      console.error(`[seedance] status=${status || '?'} elapsed=${Math.round((Date.now() - start) / 1000)}s`);
      lastLog = Date.now();
    }
    await new Promise((r) => setTimeout(r, args.pollMs));
  }

  const videoUrl = final?.content?.video_url;
  if (!videoUrl) throw new Error(`No content.video_url in result: ${JSON.stringify(final).slice(0, 500)}`);
  console.error(`[seedance] downloading ${videoUrl}`);
  await downloadTo(videoUrl, outPath);
  console.error(`[seedance] saved → ${outPath}`);

  console.log(JSON.stringify({
    ok: true,
    task_id: taskId,
    file: path.resolve(outPath),
    video_url: videoUrl,
    seed: final.seed,
    duration: args.duration,
    resolution: args.resolution,
    ratio: args.ratio,
    model,
    region: args.region,
  }));
}

if (require.main === module) {
  main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
}

module.exports = { main };
