---
name: publish
description: Post or schedule a finished video or image to LinkedIn, Instagram, TikTok and YouTube through Metricool, with a caption written for each platform, at the best time from the account's own data. Use when the user says publish, post, schedule, share, upload, queue, go live, or "put this out" for a video, Reel, Short, TikTok, carousel or post.
---

# Publish: right caption, right platform, right time

Uses the Metricool connector. Load its tools with ToolSearch (`select:mcp__Metricool_Social_Media_Management__getBrandSettings,...createScheduledPost,...getBestTimeToPostByNetwork,...getScheduledPosts`) if they are deferred.

## 1. Gather inputs

| Need | Source |
|---|---|
| Media at a **public URL** | User, Google Drive link (if Drive is linked in Metricool), or Dropbox. A local file from **edit** must be uploaded first; ask the user where. |
| Transcript / angle | `OUTPUT.txt` from **edit**, or drafts from **virality** |
| Networks | Default: LinkedIn, Instagram, TikTok, YouTube, limited to what `getBrandSettings` shows as connected |
| When | User's time, or best time (step 3) |

Ask once, in a single message, for anything missing. Required by platform: Instagram and TikTok need media; YouTube needs a video, a title and `madeForKids`.

## 2. Write one caption per platform

Read `../virality/references/voice.md` and `references/platforms.md`. Each platform gets its own caption, never one pasted everywhere. Because Metricool's `text` field is shared across providers in a single post, **schedule one post per network** so each carries its own caption.

## 3. Pick the time

`getBrandSettings` → timezone. Then `getBestTimeToPostByNetwork` per network for the target week (max 7 days). Take the highest-scoring slot on the requested day, not in the past. Stagger networks by at least 30 minutes.

## 4. Confirm before posting

Publishing is public and hard to undo. Show the user a table: network, date/time with timezone, format, caption (full), media URL, first comment. Wait for an explicit yes. If they want approval from a colleague, use `createScheduledPostForReview` instead.

## 5. Schedule

`createScheduledPost` per network, with `publicationDate.timezone` from brand settings and an empty-or-filled `<network>Data` block for that network only:

- LinkedIn: `"linkedinData": {"type": "post", "previewIncluded": true}`
- Instagram video: `"instagramData": {"type": "REEL", "showReelOnFeed": true, "isAiGenerated": false}`
- TikTok: `"tiktokData": {"privacyOption": "PUBLIC_TO_EVERYONE", "title": "<hook>", "isAigc": false}`
- YouTube: `"youtubeData": {"title": "<≤100 chars>", "type": "short", "privacy": "public", "madeForKids": false, "category": "EDUCATION", "tags": [...]}` (`"video"` for >3 min or landscape)

Set the AI-generated flags to true only when the media itself is AI-generated or substantially altered; captions written with help do not count. Ask if unsure.

Put links in `firstCommentText` on Instagram and LinkedIn (captions with links reach less), not in the caption.

## 6. Report

Return each `plannerUrl` with network and local time. On an error, relay it verbatim, fix only what it names, and retry that network only.
