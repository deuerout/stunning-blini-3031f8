---
name: edit
description: Edit raw talking-head or screen-recorded video for social. Cuts dead space and silences, reframes to vertical (9:16), square or landscape, transcribes the speech and burns in bold word-grouped captions, and writes an .srt and transcript for the Publish skill. Use when the user says edit, cut, trim, tighten, remove silences or pauses, jump-cut, caption, subtitle, reframe, make vertical, or prepare a video/Reel/Short/TikTok.
---

# Edit: cut dead space, add captions

One command does the work: `scripts/autoedit.py`. It runs ffmpeg silence detection, keeps the speech with a little padding so cuts don't clip words, optionally centre-crops to a target aspect, transcribes with faster-whisper, and burns captions in.

## 1. Check the environment (once per session)

```bash
ffmpeg -hide_banner -filters | grep -E " (ass|silencedetect) "   # both must be listed
python3 -c "import faster_whisper" || pip install faster-whisper
```

No faster-whisper → the cut still runs, captions are skipped and the report says `"captions": false`. Tell the user.

## 2. Pick settings from the destination

| Destination | `--aspect` | `--words` |
|---|---|---|
| TikTok, Instagram Reels, YouTube Shorts | `9:16` | 3 |
| LinkedIn feed video | `1:1` (or `9:16` for mobile-first) | 4 |
| YouTube long-form | `keep` or `16:9` | 5 |

When the user names several platforms, render once per aspect ratio, not once per platform.

Silence tuning:
- Default `--noise -32dB --min-silence 0.45 --pad 0.12` suits a phone mic in a quiet room.
- Noisy room or music bed, nothing gets cut → raise the floor: `--noise -26dB`.
- Everything cut, or words clipped → lower it: `--noise -40dB`, and/or `--pad 0.2`.
- Want a punchier jump-cut style → `--min-silence 0.3 --pad 0.08`.

Captions: `--model small` is the default balance; `base` for speed, `medium` for accents or technical vocabulary. Pass `--language en` to skip detection.

## 3. Run

```bash
python3 .claude/skills/edit/scripts/autoedit.py INPUT.mp4 -o OUTPUT_9x16.mp4 --aspect 9:16
```

Prints JSON: original vs edited seconds, cuts made, and paths to `OUTPUT.srt` and `OUTPUT.txt`.

## 4. Quality pass before handing back

1. Grab a frame and look at it: `ffmpeg -loglevel error -y -ss 2 -i OUT.mp4 -frames:v 1 -vf scale=360:-1 frame.png`, then Read the PNG. Check captions sit clear of the face and of the platform UI (bottom ~20% on TikTok/Reels).
2. Read the `.srt`. Whisper writes US spelling and can mishear names. Deverout and Associates uses **British English** (programme, organisation, optimise). Mis-transcribed proper nouns to watch: *Deverout*, *Talent Paradox*, *Bridge Doctrine*, *Groundings*, *Walter Rodney*. If anything is wrong, fix the `.srt` and re-burn:
   ```bash
   ffmpeg -y -i OUT_nocaps.mp4 -vf "subtitles=OUT.srt:force_style='Fontsize=22,Bold=1,Outline=2,Alignment=2,MarginV=90'" -c:a copy OUT.mp4
   ```
   (Rerun autoedit with `--no-captions` to get the uncaptioned cut.)
3. Report to the user: seconds removed, number of cuts, output paths, and any caption fixes made.

## 5. Hand-off

The `.txt` transcript is the input for the **virality** skill (hook rewrite) and the **publish** skill (caption). Publish needs the video at a public URL; say so if the file is only local.

## Limits

- Centre crop only: if the speaker is off-centre, warn the user, or crop manually with `crop=W:H:X:Y` in ffmpeg.
- Silence-based, not filler-word-based: "um" and "erm" stay. For filler removal, use the word timestamps (rerun transcription and cut words matching um/uh/erm) only if the user asks.
