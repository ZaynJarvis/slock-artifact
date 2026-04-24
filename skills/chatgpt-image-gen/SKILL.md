---
name: chatgpt-image-gen
description: Generate images via the ChatGPT web UI by attaching to the user's already-running Chrome (CDP). Submits a prompt, waits for the image to render, downloads it as a numbered PNG into ./images/, and appends a results.jsonl log entry. Use when the user asks to "generate an image with ChatGPT", "make a ChatGPT/DALL-E image and save it locally", or to batch-run prompts.
---

# chatgpt-image-gen

Drives the **logged-in** ChatGPT tab in the user's own Chrome via the Chrome DevTools Protocol. No separate Chromium, no re-login.

## Prerequisites

1. Chrome must be launched with remote debugging enabled, pointing at the user's default profile so the ChatGPT login is reused.
   ```bash
   # macOS — fully quit Chrome first (Cmd+Q or via osascript), then:
   while pgrep -x "Google Chrome" >/dev/null; do osascript -e 'quit app "Google Chrome"'; sleep 1; done
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --remote-debugging-port=9222 \
     --user-data-dir="$HOME/Library/Application Support/Google/Chrome" >/dev/null 2>&1 &
   ```
   Verify: `curl -s http://127.0.0.1:9222/json/version` should return JSON. Open or restore a ChatGPT tab.
2. From the skill dir: `npm install` (one-time, installs `playwright`).
3. For `--upload`: export `ZAYN_IMAGE_KEY` (host: `image.zaynjarvis.com`, endpoint `/api/upload`).

## Run

```bash
node generate.js --prompt "a watercolor fox at dusk"
# batch:
node generate.js --prompts prompts.json
# also upload each saved PNG to image.zaynjarvis.com:
ZAYN_IMAGE_KEY=... node generate.js --prompt "..." --upload
```

Flags: `--output ./images`  `--start N`  `--cdp http://127.0.0.1:9222`  `--upload`  `--upload-base https://image.zaynjarvis.com`  `--upload-key-env ZAYN_IMAGE_KEY`

`prompts.json` is a JSON array of strings.

## Standalone uploader

```bash
ZAYN_IMAGE_KEY=... node upload.js ./images/001.png
```
Posts multipart to `<base>/api/upload` with fields `uploadKey` + `image`. Returns `{ url, key, duplicate, contentType, size, filename }`.

## Output

- `./images/001.png`, `002.png`, …
- `./images/results.jsonl` — one line per prompt: `{ index, prompt, file, ok, src?, uploadUrl?, uploadDuplicate?, error? }`

## How it works

1. Connect to running Chrome via CDP (`chromium.connectOverCDP`).
2. Find or open a tab on `https://chatgpt.com/`.
3. Type the prompt into the composer (`#prompt-textarea` / `div[contenteditable]`), press Enter.
4. Poll for an `<img>` whose `src` starts with `https://` inside the latest assistant message and whose `alt` indicates a generated image (or the visible "Image" label disappears).
5. Fetch the image bytes with the page's auth context and write to disk.

## Failure modes

- **Login wall / Cloudflare check** → re-login in the visible Chrome window, re-run.
- **DOM drift** → selectors in `generate.js` may need updates; ChatGPT changes its UI often.
- **Rate limit** → script aborts and logs the error in `results.jsonl`.
