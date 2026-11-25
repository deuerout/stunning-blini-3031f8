# Content skills

Five Claude Code skills that chain into one pipeline:

```
record → edit → virality → locator → publish
                 ↑
               build  (tools, pages, designs the content points to)
```

| Skill | Does | Needs |
|---|---|---|
| `edit` | Cuts silences, reframes 9:16/1:1/16:9, burns captions, writes .srt + transcript | ffmpeg (with libass), `pip install faster-whisper` |
| `virality` | Ranks your posts by engagement rate in Metricool, extracts winning patterns, rewrites drafts in your voice | Metricool connector |
| `build` | Turns an idea into a working app, page or design | Artifacts, Canva, Gamma, WordPress.com connectors |
| `locator` | Localises content for a place or market: location pages, local SEO, GBP updates, geo-targeted posts, market-entry briefs | Web search; WordPress.com connector for drafts; market seeds in `locator/references/markets.md` |
| `publish` | Per-platform captions, best-time scheduling, confirm-then-post | Metricool connector, media at a public URL |

Platforms: LinkedIn, Instagram, TikTok, YouTube. Brand voice lives in `virality/references/voice.md`; edit it to update every skill.

Try: "edit raw.mp4 for Reels and TikTok", "what's working on my LinkedIn?", "build me an AI-readiness quiz", "make a Bedford manufacturing location page", "publish this video on Thursday".
