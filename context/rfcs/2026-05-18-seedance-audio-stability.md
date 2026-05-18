# RFC: Seedance Audio Stability Workflow

Status: Draft
Author: luna
Date: 2026-05-18

## Summary

Add an explicit audio-stability workflow to `skills/seedance-video-gen`.
The current skill documents `reference_audio` as a future knob, but the
script does not wire reference audio inputs, does not preflight audio
duration/reachability, and does not describe how to keep the same character
voice across multiple clips.

This RFC uses the Dodo/Wangwang 45s production as the concrete reference case.

## Current State

`skills/seedance-video-gen/SKILL.md` currently says:

- default audio is off;
- `reference_audio` is not wired;
- reference audio/video are "knobs Zayn might want surfaced";
- reference audio is documented only as `<=3 clips, <=15s each`.

`skills/seedance-video-gen/generate.js` currently supports image references,
first/last frames, `--audio`, and standard Seedance parameters, but has no
`--reference-audio` flag, no speaker mapping, and no audio-reference
preflight.

Conclusion: the current skill does not yet consider audio stability deeply
enough for multi-clip speaking-character production.

## Seedance Constraints Observed

1. Prompt-only voice locking is not reliable.
   - The strong voice constraint is a reference audio URL sent with
     `role: "reference_audio"`.
   - The prompt still matters: it binds each audio reference to a named
     speaker and line-level dialogue.

2. `generate_audio=true` is required for native spoken output.
   - For a voice-stability test, the final concat must preserve Seedance's
     original segment audio.
   - Replacing the generated audio with external TTS/SFX makes voice
     consistency impossible to evaluate.

3. Multi-reference audio has a tighter total-duration limit than expected.
   - A real validation with two 15s references failed.
   - The error required total audio-reference duration to be about `<=15.2s`.
   - Practical rule: keep full 15s voice records for archive/review, but pass
     trimmed clean reference clips of about 7s each for two-speaker Seedance
     tasks.

4. Reference audio and strict first/last-frame control should not be mixed.
   - In the Studio wrapper and observed Ark path, audio references are treated
     as multimodal reference inputs.
   - For voice-stable clips, use `reference_image` + `reference_audio`.
   - Do not combine this mode with `first_frame` / `last_frame`; if transition
     control is needed, handle it as a separate non-audio mode or use returned
     last frames after generation.

5. Reference URLs must remain durably reachable by Ark.
   - When the 7s audio URLs returned 404, all seven submitted segments failed
     immediately with `audio_url resource not found`.
   - The fix was to re-upload the local 7s MP3 files to media repo, verify
     direct `/i/...` URLs return 200, then resubmit.

6. Final assembly must verify audio streams.
   - Each segment should be downloaded immediately because Ark result URLs are
     short-lived.
   - `ffprobe` should confirm each segment has an audio stream before final
     concat.
   - Final output should be checked for expected duration, dimensions, and AAC
     audio.

## Proposed Skill Changes

### 1. Add Voice-Stable Mode

Add a documented workflow for multi-clip speaking-character production:

1. Generate or select a clean full voice record per character.
2. Store the full record in media repo for review/archive.
3. Cut a clean short Seedance reference clip per character.
4. Verify reference clips:
   - remote URL returns HTTP 200;
   - MIME type is audio;
   - total reference duration is `<=15.2s`;
   - max reference audio count is 3.
5. Submit every segment with the same ordered reference audio list.
6. Bind references in every prompt:
   - "Audio reference 1 is Dodo..."
   - "Audio reference 2 is Wangwang..."
   - line-level dialogue names the speaker.
7. Concatenate original Studio/Seedance segment audio; do not replace audio in
   the native stability pass.

### 2. Add CLI Flags

Extend `generate.js` with:

```bash
--reference-audio URL        repeatable, sent as role=reference_audio
--reference-audio-label NAME repeatable, used for prompt/report metadata
--voice-stable              enable stricter audio-reference preflight
--dry-run                   print request payload without submitting
```

Keep `--audio` as the switch for `generate_audio=true`, but in
`--voice-stable` mode either require `--audio` or turn it on by default.

### 3. Preflight Rules

Before submission:

- reject local audio paths unless they are uploaded first;
- `HEAD`/small `GET` every reference audio URL;
- probe local audio durations when available;
- fail if known total reference duration exceeds about 15.2s;
- fail if more than 3 reference audio clips are supplied;
- fail if reference audio is mixed with `--first-frame` or `--last-frame`;
- warn if prompt does not mention each audio label.

### 4. Voice Registry

For repeated productions, store a small manifest such as:

```json
{
  "characters": {
    "dodo": {
      "fullAudioUrl": "https://image.zaynjarvis.com/i/uploads/studio/sha256/...",
      "referenceAudioUrl": "https://image.zaynjarvis.com/i/uploads/studio/sha256/...",
      "referenceDuration": 7.0,
      "promptVoice": "cute young female Mandarin voice, bright and soft"
    },
    "wangwang": {
      "fullAudioUrl": "https://image.zaynjarvis.com/i/uploads/studio/sha256/...",
      "referenceAudioUrl": "https://image.zaynjarvis.com/i/uploads/studio/sha256/...",
      "referenceDuration": 7.0,
      "promptVoice": "natural young Mandarin boy voice, warm and earnest"
    }
  }
}
```

The skill should prefer this registry over ad hoc voice URLs when a user says a
character voice has been "fixed".

### 5. Prompt Template

For each segment, inject stable voice binding text:

```text
Audio reference 1 is Dodo's voice. Dodo must always use audio reference 1:
<voice descriptor>.

Audio reference 2 is Wangwang's voice. Wangwang must always use audio
reference 2: <voice descriptor>.

Only these named speakers talk. Use clean Mandarin dialogue. No narrator. No
background music.
```

The dialogue block should use explicit speaker labels for every line.

### 6. Assembly Contract

The native-audio path must:

- download every successful segment immediately;
- record each segment's task id, prompt, input refs, local path, and ffprobe;
- final-concat with original segment audio;
- create a chat-sized review copy and contact sheet;
- clearly mark any external TTS/post audio version as a separate fallback, not
  the native voice-consistency result.

## Dodo/Wangwang Reference Case

Fixed full voice records:

- Dodo:
  `https://image.zaynjarvis.com/i/uploads/studio/sha256/094ff97848cd56f67291e43361ce53818f11c10c96b72b1241911f390a495005`
- Wangwang:
  `https://image.zaynjarvis.com/i/uploads/studio/sha256/e6f687af057d3e7b1942d54462a9b2a6dbe8653400d36d665e09c0acc58ad631`

Seedance short references:

- Dodo 7s:
  `https://image.zaynjarvis.com/i/uploads/studio/sha256/8f5974daa14a8425a003b4a7c9b17533b8fbfb4572b39bf483245d7a034ab963`
- Wangwang 7s:
  `https://image.zaynjarvis.com/i/uploads/studio/sha256/191a880ba717e103afa4a798f0dc3d422db8529c534a85fb95bb1968f5d3451d`

Successful 45s native-audio output:

`https://image.zaynjarvis.com/i/uploads/studio/sha256/de4eaacd66f3df3c15c2c1ac0d3eef41d2c4600ffb1e9b86f3c9c04ab5e4dd10`

## Rollout Plan

1. Documentation update:
   - add this workflow to `skills/seedance-video-gen/SKILL.md`;
   - mark the old "reference_audio not wired" note as a known gap until code
     support lands.

2. CLI update:
   - add reference-audio flags;
   - add dry-run and preflight checks;
   - emit request payload metadata in the JSON result.

3. Helper scripts:
   - cut full audio into short clean reference clips;
   - upload audio/video to media repo;
   - build multi-segment manifests and final concat.

4. Validation:
   - unit-test argument parsing and preflight rejection paths;
   - run a two-speaker 5s validation task;
   - run a 45s multi-segment native-audio production and verify audio streams.

## Open Questions

- Is the `<=15.2s` limit officially total across all reference audio clips, or
  model/version/account dependent? Treat it as total until proven otherwise.
- Can any future Ark mode safely combine reference audio with strict
  first/last frames? Current production should assume no.
- Should the voice registry live inside this artifact repo, Studio data, or
  media repo metadata?
