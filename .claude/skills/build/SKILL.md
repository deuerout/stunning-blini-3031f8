---
name: build
description: Turn an idea into a working app, tool, landing page, calculator, dashboard or branded design with no technical background needed, combining design tools (Canva, Gamma) with code and publishing (Artifacts, the repo's static site, WordPress.com). Use when the user says build, make me an app/tool/page/site/calculator/quiz/lead magnet/dashboard/landing page, or wants a design plus something that actually works.
---

# Build: design + code → a working thing

The user is not technical. Ask about outcomes, never stacks. Choose the stack yourself and explain it in one plain line.

## 1. Brief (one message, max 4 questions, skip what's obvious)

- What should someone be able to *do* with it? (book a call, get a score, calculate ROI, download a guide)
- Who uses it: the user, clients, or the public?
- Does it need to remember anything (sign-ups, answers, results) or show live data?
- Where should it live: a shareable link, deuerout.com, or the WordPress site?

## 2. Choose the route

| Need | Route |
|---|---|
| Interactive tool, quiz, calculator, dashboard, shareable link | **Artifact**: load `artifact-design` first, and `artifact-capabilities` if it must store data or read live data |
| Page on deuerout.com | Static HTML in this repo, matching `styles.css` and an existing page's structure; add it to `sitemap.xml` |
| Blog post or page on WordPress.com | WordPress.com connector: site editor context → patterns → create as **draft** |
| Visual assets (social graphics, thumbnail, OG image, one-pager) | **Canva** (`generate-design`, brand kit via `list-brand-kits`) |
| Deck or long-form visual doc | **Gamma** (`generate`) or the Slides artifact type |
| Video | **edit** skill; animated explainer → `remotion` skill |

Most builds combine two: e.g. Canva for the hero image + an Artifact for the tool, or a Gamma deck + a landing page that links to it.

## 3. Brand defaults (Deverout and Associates)

Pull live values from `styles.css` before designing (colours, the EB Garamond + Hanken Grotesk pairing). Tone and CTAs: `../virality/references/voice.md`. Primary CTA links to `https://deuerout.com/contact`.

## 4. Build loop

1. Ship a working first version fast. Small and working beats complete and broken.
2. Verify it yourself: open it in Playwright (Chromium is preinstalled), click through the main path at 390px and 1280px wide, screenshot, and look at the screenshots. Fix what's broken before showing the user.
3. Hand over the link plus **"How to use it"** in 3 bullets and **"What to change"** in plain words ("say 'make the button gold'").
4. Iterate on their feedback; republish to the same link.

## 5. Lead-magnet pattern (common request)

Assessment or calculator → result page with a tailored recommendation → CTA to book a call. Store responses with the artifact `db` capability so the user can see who took it. Promote it via **virality** (hooks) and **publish** (posts linking to it).

## Guardrails

- Never put API keys or passwords in page code.
- Publish WordPress content as draft; the user approves going live.
- Don't change the live site's existing pages unless asked; add new ones.
- Claims, testimonials and client results only from what the user supplies.
