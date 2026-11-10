# Deverout and Associates — Static Site

A five-page static site with full SEO scaffolding. No build step; the only runtime dependency is Google Fonts (CDN).

## Files
- `index.html`, `about.html`, `practices.html`, `intelligence.html`, `contact.html` — pages
- `styles.css` — shared design system
- `app.js` — shared behaviour (nav, scroll reveal)
- `sitemap.xml`, `robots.txt` — crawler scaffolding
- Keep every file together in one folder; pages link by relative path.

## 1. Deploy to Netlify (drag-and-drop)
1. Netlify → "Add new site" → "Deploy manually" (Netlify Drop).
2. Drag the whole folder on. Live on a temporary `*.netlify.app` URL.
3. The contact form works automatically (Netlify detects `data-netlify="true"`). Add an email alert under Site settings → Forms.

## 2. Domain strategy (the spelling fix)
Brand = **Deverout and Associates** (v). Domain = **deuerout.com** (u). Canonical home = **deuerout.com**.

- **Capture the brand spelling:** register `deverout.com` and `deverout.co.uk` (and `deuerout.co.uk`) and 301-redirect them to deuerout.com. This stops word-of-mouth/spoken traffic from hitting a bad spelling.
- **Consolidate your own strays** (all your WordPress.com properties) into deuerout.com via redirects:
  - `deverouts.com` (extra "s")
  - `deuerout.wpcomstaging.com` (leftover staging site — should be unpublished/redirected)
  - Medium `@deverout_77132` — point old posts to canonical versions on the site.
- The site already declares `<link rel="canonical">` on every page pointing to deuerout.com, so once redirects are in place, search authority consolidates to one domain.

## 3. Point deuerout.com (registered at WordPress.com) to Netlify
Keep nameservers at WordPress.com; only repoint the website (so email/MX keep working):
1. Netlify → Domain management → add `deuerout.com`; it shows the exact records.
2. WordPress.com → Upgrades → Domains → deuerout.com → DNS records → Manage:
   - apex **A record** → Netlify's IP
   - **CNAME** `www` → your `*.netlify.app` address
3. Propagation up to 72h. Netlify issues free SSL automatically.

> IMPORTANT: repointing the apex takes the old WordPress site offline at deuerout.com (blog, intelligence pages, published blueprint). Migrate that content into this site first, OR keep WordPress content live elsewhere while you launch.

## 4. Get found (do immediately after deploy)
- Submit `https://deuerout.com/sitemap.xml` to **Google Search Console** and **Bing Webmaster Tools** (verify ownership first).
- Structured data is built in: Organization schema on the homepage, Person schema on About. Test with Google's Rich Results Test.
- Add a real **`og-cover.jpg`** (1200×630) at the site root — every page references it for link previews. Until then, social shares show no image.
- Optional: request removal from data-broker listings (e.g. RocketReach) for tighter control of your professional surface.

## 5. Name + handles (wired in)
One public identity everywhere: **Deverout Graham**, standard handle **@DeveroutGraham**.
- LinkedIn → https://www.linkedin.com/in/deverout
- X / Twitter → https://twitter.com/DeveroutGraham (meta/cards use @DeveroutGraham)
- YouTube → https://www.youtube.com/@DeveroutGraham
- TikTok → https://www.tiktok.com/@grahamdeverout (differs from the @DeveroutGraham standard — reclaim the matching handle when possible)
All four are in every footer, the contact page, and the homepage schema `sameAs`.

## 6. Finish before launch
- Replace remaining `#` links: podcast, individual book volumes, position-paper pages.
- Confirm contact email (currently deveroutandassociates@gmail.com).
- Add a favicon.
- Add real proof points (clients/outcomes) once approved.

## Operational checklist: Exhibit J PDF signing and hash binding

Use this checklist when implementing or verifying the exhibit-J PDF signing flow.

### 1. Install dependencies
```bash
pip install -r requirements.txt
```

### 2. Run locally
```bash
docker-compose up --build
# or
uvicorn app.main:app --reload
```

### 3. Test PDF generation
Call:
```http
POST /v1/onboarding/exhibit-j/sign
```
with a valid `JurisdictionConfig` payload.

### 4. Verify hash binding
Ensure the returned value is consistent with the signed payload:
```text
signature_payload.data == exhibit_j_hash
```
This is the verification step that proves the signed payload and returned hash are bound to the same document payload.

### 5. Production storage strategy
In production:
- Stream `pdf_bytes` to S3/MinIO with WORM locking.
- Retain only the hash in the application database.
- Keep the original PDF in immutable object storage for auditability.

This preserves integrity while reducing the risk of mutable document copies in the application DB.

