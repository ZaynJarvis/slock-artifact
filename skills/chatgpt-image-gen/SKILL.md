---
name: chatgpt-image-gen
description: Generate images via the ChatGPT web UI by attaching to the user's already-running Chrome (CDP). Submits a prompt in a fresh conversation, waits for the image to render, and downloads it as a numbered PNG. `generate.js` only generates. Uploading to image.zaynjarvis.com and local-file cleanup are separate commands (`upload.js`) so the agent can show the image to the user FIRST and only then ask whether to upload / delete. Use when the user asks to "generate an image with ChatGPT", "make a ChatGPT/DALL-E image and save it locally", or to batch-run prompts.
---

# chatgpt-image-gen

Drives the **logged-in** ChatGPT tab in the user's own Chrome via the Chrome DevTools Protocol. No separate Chromium, no re-login. Each invocation opens a **fresh ChatGPT conversation** by default.

Design principle: `generate.js` only generates + saves to disk. Uploading and deletion live in `upload.js` / plain `rm`, so the agent can show the user the PNG first and only then ask whether to upload and/or delete. Bundling those decisions into `generate.js` would force the agent to commit before the user sees the image, which is the wrong UX.

## Prerequisites

1. Chrome must be launched with remote debugging enabled. **Chrome 136+ silently refuses to bind `--remote-debugging-port` against the default profile** for security — so point at a dedicated profile directory:
   ```bash
   # macOS — fully quit Chrome first, then:
   while pgrep -x "Google Chrome" >/dev/null; do osascript -e 'quit app "Google Chrome"'; sleep 1; done
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --remote-debugging-port=9222 \
     --user-data-dir="$HOME/chrome-cdp-profile" \
     --no-first-run --no-default-browser-check >/dev/null 2>&1 &
   ```
   Verify: `curl -s http://127.0.0.1:9222/json/version` should return JSON. First time, open https://chatgpt.com/ in that Chrome window and log in (Google SSO is fine). The login persists in `~/chrome-cdp-profile` for future runs.
2. From the skill dir: `npm install` (one-time, installs `playwright`).
3. For uploads: export `ZAYN_IMAGE_KEY` (host: `image.zaynjarvis.com`, endpoint `/api/upload`).

## Agent workflow (the expected flow)

1. Run `generate.js --prompt "..."` — generates a PNG in `./images/` in a fresh ChatGPT conversation.
2. Show the PNG to the user (attach it in chat).
3. Ask the user explicitly: "要不要上传到 image.zaynjarvis.com？" and "要不要删掉本地？"
4. Act on their answer:
   - Upload: `ZAYN_IMAGE_KEY=... node upload.js ./images/001.png` (add `--delete` to remove the local PNG after a successful upload).
   - Don't upload + delete anyway: `rm ./images/001.png`.
   - Keep as-is: do nothing.

Do **not** decide upload/delete before the user sees the image.

## Run

```bash
# Generate only — fresh ChatGPT conversation, PNG saved to ./images/001.png
node generate.js --prompt "a watercolor fox at dusk"

# Batch
node generate.js --prompts prompts.json

# After the user sees it and says yes:
ZAYN_IMAGE_KEY=... node upload.js ./images/001.png            # just upload
ZAYN_IMAGE_KEY=... node upload.js ./images/001.png --delete   # upload + rm local
```

### `generate.js` flags

- `--prompt "..."` / `--prompts file.json` — one prompt or a JSON array of strings
- `--output ./images` — output dir (default `./images`)
- `--start N` — skip the first N prompts in a batch
- `--cdp URL` — CDP endpoint (default `http://127.0.0.1:9222`)
- `--timeout MS` — image-wait timeout per prompt (default 180000 = 3m)
- `--reuse-chat` — keep using the existing ChatGPT conversation instead of navigating to a fresh one (default: new conversation every run)

Note: there is deliberately no `--upload` flag here. Use `upload.js` post-hoc after the user confirms.

### `upload.js` flags

```bash
node upload.js <file> [--base-url URL] [--key-env NAME] [--delete]
```
- `--delete` / `--delete-local` — remove the local file after a successful upload.
- `--base-url` — default `https://image.zaynjarvis.com`.
- `--key-env` — env var that holds the upload key (default `ZAYN_IMAGE_KEY`).

Posts multipart to `<base>/api/upload` with fields `uploadKey` + `image`. Returns `{ url, key, duplicate, contentType, size, filename }`.

## Output

- `./images/001.png`, `002.png`, …
- `./images/results.jsonl` — one line per prompt: `{ index, prompt, file, ok, src?, error? }`. Uploads do not write into this file (they're separate invocations); capture the upload URL from `upload.js`' stdout.

## How it works

1. Connect to running Chrome via CDP (`chromium.connectOverCDP`).
2. Find the ChatGPT tab (or open one). Navigate to `https://chatgpt.com/` to start a fresh conversation unless `--reuse-chat` is set.
3. Type the prompt into the composer (`#prompt-textarea` / `div[contenteditable]`), press Enter.
4. Poll for an `<img>` whose `src` matches `/estuary\/content|oaiusercontent/` and whose `naturalWidth >= 256`, that wasn't present before submit.
5. Fetch the image bytes with the page's auth context (`fetch(..., { credentials: 'include' })` inside `page.evaluate`) and write to disk.

## Failure modes

- **CDP not bound (Chrome 136+)** → must use a non-default `--user-data-dir` (see prerequisites).
- **Login wall / Cloudflare check** → re-login in the visible Chrome window, re-run.
- **DOM drift** → selectors in `generate.js` may need updates; ChatGPT changes its UI often.
- **Rate limit** → script aborts and logs the error in `results.jsonl`.
