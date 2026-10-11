---
name: virality
description: Find what is already performing on the user's LinkedIn, Instagram, TikTok and YouTube (via Metricool analytics), work out why it worked, and rewrite new ideas, transcripts or drafts as hooks, scripts and captions in Deverout Graham's voice. Use when the user asks what is working, what to post next, why a post did well, for hooks, viral angles, content ideas, a content calendar, or to rewrite something "in my voice".
---

# Virality: find what performs, rewrite it in your voice

Two phases. Never skip phase A when analytics are reachable: patterns come from the user's own numbers, not generic advice.

## Phase A: find what is already performing

1. `getBrandSettings` → the brand's `blogId`/`brandId`, connected networks and timezone. If several brands exist, ask which one.
2. For each connected network among linkedin, instagram, tiktok, youtube, call `getAnalyticsAvailableMetrics` with `connector: "posts"` (also `"reels"` for Instagram, `"videos"` for YouTube) to get the field IDs for post text/title, publish date, impressions or views, reach, engagement, comments, shares, saves and watch time.
3. `getAnalyticsDataByMetrics` for the last 90 days (widen to 180 if under 15 posts).
4. Rank by **engagement rate** (engagements ÷ impressions or reach), not raw views. Take the top 10% (min 3) and the bottom 10% per network.
5. For each winner, label: hook type (see table), format, length, topic pillar, first-line wording, and day/hour posted. Then state the patterns that separate winners from losers, with numbers ("contrarian hooks: 6.1% avg engagement vs 2.3% overall").

Hook types to label against:

| Type | Shape |
|---|---|
| Contrarian | "Most X is wrong. Here's why." |
| Number / proof | "1M views. Here's the 4-step system." |
| Diagnosis | "Most transformation programmes fail for one reason." |
| Story | "In Kingston, a library taught me…" |
| Question | "Should your AI strategy exist at all?" |
| Prediction | "By 2030, half of today's org charts will be obsolete." |

No Metricool data (not connected, network missing, or under 5 posts) → say so plainly, then work from the user's pasted examples or the pillars in `references/voice.md`. Never invent metrics.

## Phase B: rewrite in voice

Read `references/voice.md` first, every time.

For each piece (a transcript from **edit**, a rough idea, or a competitor format the user admires), produce:

1. **Three hooks** using the hook types that won in Phase A, each under 12 words for video and under 210 characters for a LinkedIn first line (the "see more" cut).
2. **The body**, matched to format:
   - Short video (TikTok/Reels/Shorts, 30–60s): hook (0–3s), one tension, three beats, single takeaway, CTA. Write as spoken lines with on-screen text cues.
   - LinkedIn text post: hook line, white space, 5–9 short paragraphs, closing question.
   - Carousel: 1 hook slide + 5–8 single-idea slides + CTA slide, ≤25 words per slide.
3. **Why it should work**: one line linking it to a Phase A pattern.

Rewriting someone else's post: keep the *structure* that performed, replace every sentence with the user's argument and evidence. No copied phrasing.

## Output

A short table of winning patterns, then the rewritten drafts, ready for **publish**. For a content calendar, give a two-week grid: date, network, format, pillar, hook, using the best posting windows found in Phase A.
