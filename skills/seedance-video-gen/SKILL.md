---
name: seedance-video-gen
description: Generate short videos from one-or-more reference images via ByteDance Seedance 2.0 on Volcengine Ark. Trigger when the user asks to "make a seedance video", "animate these images into a clip", "multi-image to video", or otherwise wants Seedance 2.0 specifically. Defaults: 2K, adaptive aspect, 15s duration, no audio.
---

# seedance-video-gen

Generates a short video from 1..N reference images using **ByteDance Seedance 2.0** via the **Volcengine Ark** task-based API. `generate.js` only generates and saves an MP4 to disk — showing it to the user and any follow-up upload / cleanup are deliberately separate steps (same shape as `chatgpt-image-gen`: the agent reviews with the user first, only then decides whether to upload or delete).

## Why Volcengine Ark

Of the providers serving Seedance 2.0, the Ark task API is the one Zayn already has access to (his existing `ARK_API_KEY` works), and it's the only public route that exposes **2K (2560×1440)** output. Other providers either cap at 1080p (fal.ai) or 720p (Replicate). Use this path by default; only fall back elsewhere if Ark is down.

## Endpoints

```
POST  https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks
GET   https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{task_id}
```

Auth header: `Authorization: Bearer $ARK_API_KEY`. The China-region endpoint is the default; pass `--region global` for `ark.ap-southeast.bytepluses.com` if you ever need the BytePlus international route (different billing account, different model IDs — see "Region differences" below).

## Prerequisites

1. `ARK_API_KEY` env var — Volcengine Ark key, starts with `ark-...`.
2. Reference images must be **URLs reachable by Ark's servers**. If the user only has local files, upload them first — `image.zaynjarvis.com` works fine (`ZAYN_IMAGE_KEY` + `chatgpt-image-gen/upload.js` produces a URL Ark can fetch).
3. Node ≥ 18 (uses global `fetch`). No npm deps.

## Defaults (per Zayn's spec)

| Knob | Default | Notes |
| --- | --- | --- |
| `--resolution` | `2k` | `480p` / `720p` / `1080p` / `2k` |
| `--ratio` | `adaptive` | `adaptive` / `21:9` / `16:9` / `4:3` / `1:1` / `3:4` / `9:16` |
| `--duration` | `15` | integer 4..15 |
| `--audio` | off | `generate_audio=false`. Zayn asked to skip audio for now. Flip with `--audio`. |
| `--fast` | off | Switches model to `doubao-seedance-2-0-fast-260128` — cheaper, faster, slightly lower quality. |

Model IDs (China region):
- Standard: `doubao-seedance-2-0-260128`
- Fast: `doubao-seedance-2-0-fast-260128`

## Request shape

```json
{
  "model": "doubao-seedance-2-0-260128",
  "content": [
    { "type": "text", "text": "Your prompt here. Refer to images as @image1, @image2..." },
    { "type": "image_url", "image_url": { "url": "https://.../girl.png" }, "role": "reference_image" },
    { "type": "image_url", "image_url": { "url": "https://.../dog.png" }, "role": "reference_image" }
  ],
  "resolution": "2k",
  "ratio": "16:9",
  "duration": 15,
  "generate_audio": false
}
```

The `role` field on each image item is what controls how Ark uses it:

| `role` | What it does | Flag in `generate.js` |
| --- | --- | --- |
| `reference_image` | Subject / style reference (multi-image case) | `--image URL` (repeatable) |
| `first_frame` | Pin video's opening frame to this image | `--first-frame URL` |
| `last_frame` | Pin video's closing frame to this image | `--last-frame URL` |
| `reference_video` | Reference motion / extend a clip | (not wired — Zayn said skip) |
| `reference_audio` | Reference audio for lip-sync etc. | (not wired — Zayn said skip) |

## Run

```bash
export ARK_API_KEY=ark-...   # don't commit, don't echo

# Default: multi-image → 2K / adaptive / 15s / no audio
node generate.js \
  --prompt "@image1 holds the team flag and @image2 (the corgi) trots beside her" \
  --image https://image.zaynjarvis.com/i/.../girl.png \
  --image https://image.zaynjarvis.com/i/.../dog.png

# Override knobs
node generate.js \
  --prompt "..." \
  --image URL1 --image URL2 --image URL3 \
  --resolution 1080p --ratio 9:16 --duration 10 \
  --audio --seed 42 --fast \
  --output ./videos --name first.mp4

# First-frame / last-frame mode (single still per slot)
node generate.js \
  --prompt "..." \
  --first-frame URL --last-frame URL
```

Output: an MP4 saved as `./videos/NNN.mp4` (auto-numbered, or `--name` if provided). The script also prints a single JSON line on stdout with `{file, video_url, task_id, seed, ...}` for easy capture in scripts.

## Polling

The task API is async. Status flow: `queued` → `running` → `succeeded` (or `failed` / `cancelled` / `expired`). `generate.js` polls every 5 s, logs every 15 s, times out at 30 min. On success the final video URL lives at `content.video_url`. The URL is short-lived (Ark expires it in ~24 hours) so the script always downloads immediately into `./videos/`.

## Agent workflow

1. Gather inputs: prompt + image URLs. If user gave local files, upload them first (`chatgpt-image-gen/upload.js`).
2. Run `node generate.js …` with sensible defaults (2K / 15 s / no audio).
3. Show the MP4 (or a thumbnail) to the user.
4. **Ask explicitly**: 要不要上传 / 要不要删本地。Don't auto-upload or auto-delete.
5. Act on the answer.

## Knobs Zayn might want surfaced (not yet on by default)

- **`generate_audio=true`** — Ark synthesizes SFX, ambient sound, and even lip-synced speech. Off per Zayn's "audio暂时不用"; flip with `--audio`.
- **`seed`** — `--seed N` for reproducibility.
- **`--fast` tier** — `doubao-seedance-2-0-fast-260128`. ~20% cheaper and noticeably faster at some quality cost.
- **First/last frame** — `--first-frame URL` / `--last-frame URL`. Pins the opening/closing frame to a still — useful for clean transitions between clips in a sequence.
- **Reference video / audio** — Ark supports `reference_video` (≤3 clips, ≤15 s each) and `reference_audio` (≤3 clips, ≤15 s each) roles. Zayn said skip for now; add flags when needed.
- **`callback_url`** — Ark can POST to a webhook when the task finishes instead of polling. Useful for very long batches.
- **`return_last_frame`** — Ark can return the last frame as a still alongside the video (handy as a `first_frame` for the next clip in a continuation).
- **`watermark`** — boolean. Defaults to whatever Ark's account setting is (usually `true`). Pass `false` if you want clean output for downstream editing.
- **`camera_fixed`** — boolean, default `false`. Forces a locked camera (no pans / zooms). Useful for plate shots or when the reference image is the framing you want held.
- **`frames`** — alternative to `duration`. Lets you specify exact frame count instead of integer seconds; takes precedence over `duration` if both are set. Useful if you need frame-perfect timing.

## Input image limits (Ark)

- Formats: `jpeg` / `png` / `webp` / `bmp` / `tiff` / `gif` (+ `heic` / `heif` on Seedance 2.0)
- Aspect ratio (w/h): `0.4 .. 2.5`
- Side length (px): `300 .. 6000`
- Single image: ≤ 30 MB
- Whole request body: ≤ 64 MB (don't base64 large files — use URLs)

## Pitfalls observed

1. **Local files won't work as `--image` directly.** Ark needs a URL it can fetch. Upload to `image.zaynjarvis.com` first (or any public URL), then pass that URL.
2. **`@image1` order matters.** The Nth `reference_image` in the content array (i.e. the Nth `--image` flag) becomes `@image1`/`@image2`/... in the prompt — get the order right or the model swaps subjects.
3. **Video URL is short-lived.** ~24 h expiry. `generate.js` downloads immediately; if you ever capture only the URL, re-download from Ark won't work later.
4. **Top-level params, not prompt flags.** Ark used to accept `--resolution 2k` inside the text content; the current API takes `resolution` / `ratio` / `duration` as top-level body fields. The script does this correctly — just be aware if you hand-craft a request.
5. **2K is heaviest.** Generation noticeably slower and more expensive at 2K vs 1080p. For iteration, default to 1080p; switch to 2k for finals.

## Region differences

| Region (CLI flag) | Endpoint | Model IDs | Notes |
| --- | --- | --- | --- |
| `cn` (default) | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seedance-2-0-260128`, `doubao-seedance-2-0-fast-260128` | Zayn's existing `ARK_API_KEY`. |
| `global` | `https://ark.ap-southeast.bytepluses.com/api/v3` | `dreamina-seedance-2-0-260128`, `dreamina-seedance-2-0-fast-260128` | BytePlus international — separate billing account; pass `--model dreamina-…` if you switch over. |

Don't mix the two routes — each region only knows its own model IDs.
