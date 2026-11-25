---
name: locator
description: Localise Deverout and Associates content for a specific place or market — Bedford, Bedfordshire, London, UK regions or a global affiliate country — as location landing pages on deuerout.com, WordPress posts, Google Business Profile updates, and geo-targeted LinkedIn, Instagram, TikTok and YouTube posts, adapted to the local economy, sectors and culture. Use when the user names a town, city, region or country, or asks for local SEO, "near me" visibility, location or service-area pages, local landing pages, market-entry content, or content for a new affiliate market.
---

# Locator: the right message, placed

Takes one idea (or an existing page or post) and places it in a market: what the local economy is wrestling with, which of the firm's practices answer it, and the content that proves it. Local relevance comes from facts about the place, not from swapping a town name into a template.

## 1. Brief (one message, max 3 questions, skip what's given)

- **Where?** Town / city / region / country. Default set: Bedford, Bedfordshire, London.
- **For whom?** Sector and buyer (e.g. Bedfordshire manufacturing COOs, City of London finance boards, NHS trust leaders).
- **What output?** Location page, social posts, WordPress post, Google Business Profile update, or a full local pack (all of them).

## 2. Build the market profile

Read `references/markets.md`. If the place is listed, start from it. If not, research it (WebSearch, `standard` mode; `extended` for small towns or non-UK markets) and add a new entry to `markets.md` so the next run starts from it.

A profile needs, each with a source:
1. Economy: anchor employers and sectors, recent investments or closures, public-sector bodies.
2. Live pressures: skills gaps, regeneration schemes, regulation, AI or digital adoption gaps.
3. Culture and community: languages, diaspora communities, civic institutions, local idioms of business. Respect, never stereotype.
4. Local proof the user has supplied (clients, talks, partnerships). Never invent any.
5. Search intent: 5–10 phrases a buyer there would type ("digital transformation consultant Bedford", "AI strategy consultancy London").

Facts older than 18 months or unsourced: flag them, don't publish them.

## 3. Map the pressure to the practice

One line per pressure: **local pressure → practice → pillar** (pillars in `../virality/references/voice.md`). Example: "Bedfordshire advanced manufacturing faces automation skills gaps → AI transformation → AI, from pilot to permanent." Pick the strongest two or three; that is the spine of every output.

## 4. Produce

Read `../virality/references/voice.md` first. British English for UK markets; for non-UK markets keep the voice but use local spelling, currency, date format and, if asked, language (have the user confirm any translation with a native speaker before publishing).

| Output | Spec |
|---|---|
| **Location page** on deuerout.com | Static HTML in this repo at `locations/<slug>.html`, cloned from `about.html` structure and `styles.css`. Unique `<title>` (≤60 chars, place + service), meta description (≤155), canonical, OG tags, `ProfessionalService` JSON-LD with `areaServed` and only real addresses (Bedford, London — never a fake office for an affiliate market). Sections: the local challenge, how the practices answer it, a sourced local fact, CTA to `/contact.html`. 500–900 words, ≥60% unique to that place. Add to `sitemap.xml` and link from the footer or about page. |
| **WordPress post** | Via the WordPress.com connector: load its `create-content` guide, create as **draft** only. |
| **Google Business Profile** | ≤1,500 chars (first 100 carry it), one CTA, no phone numbers in the body. Hand the text to the user to post; no connector here posts to GBP. |
| **Social posts** | Write as **virality** Phase B does, with the place in the hook or first line. Location tag + 1–2 local hashtags (#Bedford #LondonBusiness) on top of the brand's 3–5. Hand to **publish** for scheduling. |
| **Market-entry brief** (new affiliate country) | One page: profile, the 3 pressure→practice lines, 5 content angles, cultural notes, risks. Make it a Claude Doc. |

## 5. Check before handing over

- Every place fact has a source in the market profile; every client claim came from the user.
- Location pages: open in Playwright at 390px and 1280px, screenshot, look; confirm every `application/ld+json` block parses with `json.loads`.
- No doorway pages: if two location pages read the same with names swapped, merge them.
- Nothing is published or pushed without the user's go-ahead. Repo changes go on the working branch.

## Output

The market profile (short table), the pressure→practice lines, then each output, ready to review. For a full local pack, list what is drafted where (file path, WordPress draft link, text for GBP, posts queued for **publish**).
