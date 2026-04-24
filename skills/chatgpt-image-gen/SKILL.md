---
name: chatgpt-image-gen
description: Generate images via the ChatGPT web UI by attaching to the user's already-running Chrome (CDP). Submits a prompt in a fresh conversation, waits for the image to render, downloads it as a numbered PNG into ./images/, and appends a results.jsonl log entry. Optionally uploads the PNG to image.zaynjarvis.com (asks for confirmation first) and can remove the local copy after a successful upload. Use when the user asks to "generate an image with ChatGPT", "make a ChatGPT/DALL-E image and save it locally", or to batch-run prompts.
---

# chatgpt-image-gen

Drives the **logged-in** ChatGPT tab in the user's own Chrome via the Chrome DevTools Protocol. No separate Chromium, no re-login. Each invocation opens a **fresh ChatGPT conversation** by default.

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
3. For `--upload`: export `ZAYN_IMAGE_KEY` (host: `image.zaynjarvis.com`, endpoint `/api/upload`).

## Run

```bash
# Generate only (new ChatGPT conversation, PNG saved locally):
node generate.js --prompt "a watercolor fox at dusk"

# Generate + offer upload (interactive y/N prompt on stderr):
ZAYN_IMAGE_KEY=... node generate.js --prompt "..." --upload

# Non-interactive: auto-accept upload and delete local copy after success:
ZAYN_IMAGE_KEY=... node generate.js --prompt "..." --upload --yes --delete-local

# Batch run:
node generate.js --prompts prompts.json
```

### Flags

- `--prompt "..."` / `--prompts file.json` — one prompt or a JSON array of strings
- `--output ./images` — output dir (default `./images`)
- `--start N` — skip the first N prompts in a batch
- `--cdp URL` — CDP endpoint (default `http://127.0.0.1:9222`)
- `--timeout MS` — image-wait timeout per prompt (default 180000 = 3m)
- `--upload` — after each save, offer to upload to `image.zaynjarvis.com`. Prompts `[y/N]` on stderr unless `--yes` is set.
- `--yes` / `-y` — skip the upload confirmation (for non-interactive callers)
- `--delete-local` / `--delete-local-after-upload` — remove the local PNG after a successful upload (no-op if upload was declined or failed)
- `--reuse-chat` — keep using the existing ChatGPT conversation instead of navigating to a fresh one (default: new conversation every run)
- `--upload-base URL` — override upload host
- `--upload-key-env NAME` — env var holding the upload key (default `ZAYN_IMAGE_KEY`)

`prompts.json` is a JSON array of strings.

## Standalone uploader

```bash
ZAYN_IMAGE_KEY=... node upload.js ./images/001.png           # upload only
ZAYN_IMAGE_KEY=... node upload.js ./images/001.png --delete  # upload then rm
```
Posts multipart to `<base>/api/upload` with fields `uploadKey` + `image`. Returns `{ url, key, duplicate, contentType, size, filename }`. Pass `--delete` to unlink the local file after a successful upload.

## Output

- `./images/001.png`, `002.png`, …
- `./images/results.jsonl` — one line per prompt: `{ index, prompt, file, ok, src?, uploadUrl?, uploadDuplicate?, uploadSkipped?, localDeleted?, error? }`

## Agent workflow (recommended)

When an agent invokes the skill on a user's behalf in zouk / chat:

1. Run `generate.js --prompt "..."` (no `--upload`) to get the local PNG.
2. Send the PNG to the chat as an attachment so the user can see it.
3. Ask the user: "also upload to the image CDN?"
4. If yes: re-run with `--upload --yes --delete-local` on the same prompt (or call `upload.js <file> --delete` on the existing PNG). If no: remove the local PNG with `rm` — no reason to hoard generated images on disk once they're in the chat.

## How it works

1. Connect to running Chrome via CDP (`chromium.connectOverCDP`).
2. Find the ChatGPT tab (or open one). Navigate to `https://chatgpt.com/` to start a fresh conversation unless `--reuse-chat` is set.
3. Type the prompt into the composer (`#prompt-textarea` / `div[contenteditable]`), press Enter.
4. Poll for an `<img>` whose `src` matches `/estuary\/content|oaiusercontent/` and whose `naturalWidth >= 256`, that wasn't present before submit.
5. Fetch the image bytes with the page's auth context (`fetch(..., { credentials: 'include' })` inside `page.evaluate`) and write to disk.
6. If `--upload` and user confirms: POST multipart to `image.zaynjarvis.com/api/upload`, store the returned URL in `results.jsonl`.

## Failure modes

- **CDP not bound (Chrome 136+)** → must use a non-default `--user-data-dir` (see prerequisites).
- **Login wall / Cloudflare check** → re-login in the visible Chrome window, re-run.
- **DOM drift** → selectors in `generate.js` may need updates; ChatGPT changes its UI often.
- **Rate limit** → script aborts and logs the error in `results.jsonl`.
- **Upload declined** → `uploadSkipped: true` in `results.jsonl`; local PNG kept.
