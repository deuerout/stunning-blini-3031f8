# Content skills

Four Claude Code skills that chain into one pipeline:

```
record → edit → virality → publish
                 ↑
               build  (tools, pages, designs the content points to)
```

| Skill | Does | Needs |
|---|---|---|
| `edit` | Cuts silences, reframes 9:16/1:1/16:9, burns captions, writes .srt + transcript | ffmpeg (with libass), `pip install faster-whisper` |
| `virality` | Ranks your posts by engagement rate in Metricool, extracts winning patterns, rewrites drafts in your voice | Metricool connector |
| `build` | Turns an idea into a working app, page or design | Artifacts, Canva, Gamma, WordPress.com connectors |
| `publish` | Per-platform captions, best-time scheduling, confirm-then-post | Metricool connector, media at a public URL |

Platforms: LinkedIn, Instagram, TikTok, YouTube. Brand voice lives in `virality/references/voice.md`; edit it to update every skill.

Try: "edit raw.mp4 for Reels and TikTok", "what's working on my LinkedIn?", "build me an AI-readiness quiz", "publish this video on Thursday".
