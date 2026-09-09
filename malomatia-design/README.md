# malomatia Design System

A working design system for **malomatia** — Qatar's national IT services and digital transformation company. This system codifies the brand's visual foundations, content voice, components, and slide vocabulary so that any new artifact (deck, web page, mock, prototype) feels unmistakably malomatia.

> **Tagline (current 2025):** *"Reimagining what's possible through digital excellence"*
> **Heritage tagline:** *"excel with IT"* (still appears on the official logotype)

---

## About the company

malomatia is Qatar's largest sovereign IT services provider, headquartered in Doha. Established **2008**, **100% owned by the Qatar Investment Authority (QIA)**. The company runs Qatar's largest Security Operations Centre, operates the country's biggest contact centre, and is the long-term incumbent for national platforms such as **Al Nadeeb (Customs)**, **Hukoomi**, and the **Supreme Judicial Council** digitisation programme.

**Scale at a glance**
- 2,200+ specialists (incl. external resources)
- 500+ projects delivered, 100+ clients, 7+ sectors
- Operations: Qatar (HQ — Marabea Tower, Lusail), India, Egypt, Oman, Jordan
- QAR 200M capital, 26% revenue growth (2024), 17% 2-year CAGR

**Core service pillars** (from the 2025 corporate deck)
1. Cybersecurity
2. Cloud Solutions
3. IT Managed Services
4. Application Development & Modernization
5. Enterprise Applications
6. Data & Artificial Intelligence
7. Contact Centre Services
8. Business Process Outsourcing
9. Managed Services

---

## Source materials

This design system was built from the following uploads (kept in `uploads/` — do not assume readers have access, but they may):

| File | Purpose |
|---|---|
| `uploads/Brand Guidelines.pdf` (37 pages) | Official brand book — logo construction, exclusion zone, colour values, typography, imagery, stationery |
| `uploads/Malomatia Corporate Presentation Jan 18.pptx` (31 slides) | 2025 master corporate deck — current voice, layouts, photography style, leadership, success stories |
| `uploads/Malomatia Logo *.png` | Logo lockups on transparent / red / black / grey / light-on-black backgrounds |
| `uploads/Malomatia Logo Nov 12 2025.ai` | Vector master logo (Adobe Illustrator — not opened) |

No codebase or Figma was provided. There is currently **no public web product or app** in scope for this system — the assets above describe a *corporate brand* primarily expressed through documents, decks, signage, and stationery. The UI kit and slide kit in this project are the first attempt to translate that brand into screen-ready components.

---

## Index

```
README.md                  ← you are here
SKILL.md                   ← agent-skill manifest
colors_and_type.css        ← all design tokens (CSS variables)
fonts/                     ← webfont files + license notes
assets/
  logos/                   ← 5 logo lockups (PNG, transparent + on-colour)
  imagery/                 ← 9 hero photographs from the 2025 deck
  icons/                   ← icon usage notes (uses Lucide via CDN)
preview/                   ← Design System tab cards (one HTML per token group)
slides/                    ← Sample slide deck templates
  index.html               ← Full deck preview (8 slide types)
  *.jsx                    ← Per-slide components
ui_kits/
  corporate-website/       ← Mock corporate marketing site
    index.html
    *.jsx
```

---

## CONTENT FUNDAMENTALS

malomatia's voice has two registers, both present in the 2025 corporate deck and the brand book.

### 1. Brand-book register (timeless / formal)
- **Lowercase logotype is law.** The brand book is explicit: *"all titles must be lower case as a relation with the malomatia logo."* Section headings in the brand book itself follow this — `brand platform`, `identity elements`, `brand typography`.
- Vocabulary leans corporate-elegant: *trusted, passion, energy, efficient, flexibility* (the five brand values); *smart strategies and solutions* (brand essence).

### 2. Corporate-deck register (2025, more assertive)
- Current decks layer on **ALL-CAPS section labels** (`OUR VISION`, `CORE SERVICES`, `SUCCESS STORIES`) over the lowercase brand mark — a deliberate tension between brand humility and operational confidence.
- **Voice is "we" not "I" or "you"** — collective, institutional. Examples from the 2025 deck:
  - *"At malomatia, we boldly reimagine what's possible."* (CEO quote)
  - *"We power Qatar's digital infrastructure."*
  - *"We shape the next chapter of Qatar's digital transformation — together."*
- **National framing.** Almost every claim is anchored in Qatar. *"Anchored in Qatar"*, *"Qatar's first AI-powered omnichannel contact centre"*, *"Qatar's digital ambitions"*. Use this framing — it's the brand's centre of gravity.
- **Numbers as proof.** Big stats are headline-sized: `500+ projects`, `100+ clients`, `2,200+ employees`, `99.9% uptime`, `9M+ transactions`, `600% platform growth`. Use them as visual anchors, not buried in body copy.
- **Compound capability statements.** Service descriptions follow a pattern of *capability + qualifier + outcome*. Example: *"Continuous monitoring and security operations — Maintaining around-the-clock oversight to detect, investigate, and respond to security incidents."*
- **No emoji. Ever.** Neither brand-book nor 2025 deck use any. Don't add them.
- **No exclamation marks.** The voice is confident, not excited.
- **Em-dashes and ampersands are fine.** `Cybersecurity & Cloud`, `Government & Enterprise`.
- **Bilingual considerations.** Arabic content is handled in parallel (right-to-left, GE Hili / AXTManal fonts). Don't mix Arabic and Latin in the same line — use a side-by-side layout or separate documents.

### Casing rules at a glance
| Element | Casing |
|---|---|
| Logotype `malomatia` | always lowercase |
| Section labels (`OUR VISION`, `CORE SERVICES`) | ALL-CAPS, letter-spaced |
| Page / slide titles | lowercase preferred per brand book; deck-style titles can mix case for emphasis (`malomatia's Journey to a Knowledge-Driven Digital Economy`) |
| Body copy | sentence case |
| Buttons / CTAs | sentence case (`Learn more`, `Contact us`) |

---

## VISUAL FOUNDATIONS

### Colour
The brand book defines a strict four-colour palette. There is **no secondary palette** in the official guidelines — additional neutrals introduced in this system are scaffolding only and should be used sparingly.

| Role | Hex | Source |
|---|---|---|
| **malomatia red** | `#CF0A2C` | Pantone 186 C — RGB 207/10/44 |
| **metallic grey** | `#777575` | Pantone 8401 metallic — RGB 119/117/117 |
| **cool grey** | `#999999` | Pantone 877 C — 40% black |
| **black** | `#000000` | 100% K |
| white | `#FFFFFF` | (paper / negative space) |

**Usage discipline (from the brand book):**
- Full-colour logo → **white background only** (incl. white metal: stainless, aluminium)
- Reversed-out logo → **black background or black-biased image**
- Silver lockup → **15% black background only**
- Red is a hero/accent colour, never a wash for body copy. Use it for the wordmark, primary CTAs, key numerals, and section markers.

### Typography
The official primary face is **Equestrienne RR** (a transitional serif with calligraphic detailing), with **Times** as the screen/internal fallback. For Arabic the hierarchy is **GE Hili** (display) → **AXTManal** (body) → **Arabic Transparent** (body fallback).

**Font substitution in this system** (none of the licensed faces ship with the brand pack — flag for the user):
| Original | Substituted with | Why |
|---|---|---|
| Equestrienne RR (display serif) | **Equestrienne** (licensed, supplied) ✅ | Official brand font — now loaded from `fonts/Equestrienne_Book.ttf` and `fonts/Equestrienne_Light.ttf` |
| Times (body/internal) | **Source Serif 4** (Google) | Modern reinterpretation of the Times genre — better screen rendering |
| Sans-serif (UI, where the brand book is silent) | **Manrope** (Google) | Geometric humanist sans, neutral, pairs well with the serif |
| GE Hili (Arabic display) | **Reem Kufi** (Google) | Closest Arabic display style with similar open counters |
| AXTManal (Arabic body) | **Cairo** (Google) | Widely-supported, contemporary Arabic body face |

> **⚠ Action for user:** please share the GE Hili and AXTManal Arabic font files (TTF/OTF/WOFF). Equestrienne is now live; the Arabic substitutes are usable but not pixel-accurate.

### Imagery
The 2025 deck establishes the photographic language. Pull from these treatments:

- **Cinematic Qatar landmarks** — Museum of Islamic Art arches with Doha skyline at dusk; Marabea Tower (HQ). Warm sunset palette OR desaturated black-and-white.
- **Cool blue tech imagery** — Cloud / circuit / server / network photography with a heavy cyan-blue cast. This is the visual shorthand for "infrastructure & security."
- **Monochrome portraits** — Leadership shots are tight crop, soft-grey backdrops, desaturated. Consistent treatment across the team grid.
- **High-contrast "concept" stock** — A hand holding a glowing network globe, robotic arm at a dashboard, etc. The brand book asks for *first plane subject + second plane motion blur* — that "speed concept" still drives selection in 2025.

Avoid: pastel illustrations, cartoon characters, isometric vector art, low-contrast lifestyle photography. The brand explicitly warns against *cliché images* and asks for *high contrast, engaging, unexpected, innovative*.

### Backgrounds & surfaces
- **Default surface:** white with generous whitespace. The brand book specifies "RQ basic ultra white 120gsm" stock — translate that to clean `#FFFFFF` on screen.
- **Inverse surface:** pure black (`#000000`) — used for hero / cover treatments, especially when the logo reverses out.
- **Tinted surface:** 15% black (`#D9D9D9`) — the "silver" surface from the brand book. Use sparingly for callout cards.
- **Red surface:** the malomatia red (`#CF0A2C`) — used for full-bleed accent panels and the "on red" logo lockup. Reserve for ~1 panel per layout to keep its impact.
- No gradients in the print brand book. The 2025 deck introduces subtle dark-to-darker gradients on cyber/cloud imagery; treat these as photographic, not as a system token.
- No repeating patterns. No textures. The negative space *is* the texture.

### Spacing & layout
The brand book prescribes letterhead margins and an **exclusion zone** around the logo equal to the height of the "x" cap of `malomatia`. We translate that to a token system based on the cap height (`--space-x`).

| Token | px | Usage |
|---|---|---|
| `--space-1` | 4 | hairline gaps |
| `--space-2` | 8 | inline icon-to-text |
| `--space-3` | 12 | tight stack |
| `--space-4` | 16 | default stack |
| `--space-5` | 24 | section interior |
| `--space-6` | 32 | section between |
| `--space-8` | 48 | block separation |
| `--space-10` | 64 | major section break |
| `--space-12` | 96 | hero margin |

Layout grid: a flexible 12-column with 24px gutters at desktop, dropping to 4-column at mobile. Decks use a 1920×1080 canvas with a 96px outer margin (matching the printed exclusion zone).

### Borders, radii, shadows
The print brand favours sharp corners and crisp edges (the brand book recommends *spot UV on the appropriate locations such as the thin lines* — i.e. the design celebrates fine line work, not soft shapes).

| Token | Value | Notes |
|---|---|---|
| `--radius-0` | 0 | Default for cards, buttons, inputs — matches print discipline |
| `--radius-sm` | 2px | Subtle softening for pills/badges |
| `--radius-md` | 4px | Maximum — used for media tiles |
| `--radius-pill` | 999px | For status pills only |
| `--border-hairline` | 1px solid `#D9D9D9` | Default divider |
| `--border-strong` | 1px solid `#000` | Emphasis divider |
| `--shadow-card` | `0 1px 2px rgba(0,0,0,.04), 0 4px 12px rgba(0,0,0,.06)` | Subtle elevation only |
| `--shadow-elevated` | `0 4px 16px rgba(0,0,0,.08), 0 12px 32px rgba(0,0,0,.10)` | Modals / popovers |

No glow effects. No coloured shadows. No neumorphism.

### Animation
- **Fades and slides only.** No bounces, no springs, no parallax wash.
- **Easing:** `cubic-bezier(0.4, 0.0, 0.2, 1)` (standard material-style) for most movement; `cubic-bezier(0.0, 0.0, 0.2, 1)` (decelerate) for entrances.
- **Durations:** 150ms (micro — hover), 250ms (default — state change), 400ms (entrance), 600ms (page transition).
- The brand is institutional. Motion should feel *purposeful and quiet*, not playful.

### Interactive states
| State | Treatment |
|---|---|
| Hover (primary button) | Background shifts to `--red-700` (`#A40821`) |
| Hover (secondary button) | Background shifts to `--grey-100` (`#F2F2F2`) |
| Hover (link) | Underline appears, colour darkens slightly |
| Active / press | 2% opacity overlay (`rgba(0,0,0,0.04)`), no scale change |
| Focus | 2px outline in `--red-500`, 2px offset |
| Disabled | 40% opacity, cursor `not-allowed` |

No scale-down on press (the brand is too restrained for it). No coloured glows on focus.

### Transparency & blur
- **Use sparingly.** The brand is opaque and confident.
- Acceptable: dark gradient overlays on hero photography (60–80% black bottom-up, to allow white text on full-bleed images).
- Acceptable: 4px backdrop blur on sticky navigation over imagery.
- Avoid frosted-glass cards, semi-transparent panels for content, or any "glass morphism."

### Cards
The default card: white background, no border, `--shadow-card`, `--radius-sm` (2px), generous internal padding (`--space-5` to `--space-6`). When cards sit on a tinted background, swap shadow for a `1px solid #E5E5E5` border. Section-marker cards (the "1 / 2 / 3" treatment in the deck) are pure typography on a coloured surface — no container chrome.

---

## ICONOGRAPHY

The official brand book is silent on icons — the deck-era materials use **stock photography rather than icon systems** for almost every concept. Where small icons appear in the 2025 deck (sector chips, badge marks), they are **simple white-line glyphs on dark roundels**, similar in weight to Lucide.

### Approach in this system
- **Primary icon set: [Lucide](https://lucide.dev/)** — loaded via CDN (`https://unpkg.com/lucide@latest`). 1.5px stroke, rounded line caps, 24×24 default. This is a substitution — flag to user if a proprietary icon set exists.
- **Stroke weight:** 1.5px at 24px (`stroke-width: 1.5`). Never fill icons.
- **Sizes:** 16, 20, 24, 32, 48px. 24px is the default.
- **Colour:** inherits `currentColor`. Default is `--grey-700`. Red icons reserved for primary actions or branded callouts.
- **Emoji:** **never used.** The brand book and corporate deck contain zero emoji.
- **Unicode glyphs:** acceptable for typographic punctuation only (`→`, `—`, `·`, `✓` for status checks, `★` for ratings). Do not use Unicode as a substitute for an icon.
- **Logos as icons:** the malomatia "swoosh" mark (the calligraphic ribbon to the right of the wordmark) can be used standalone as a brand mark at small sizes — see `assets/logos/`.

### When you need an icon malomatia would actually have
- Sectors (Government, Healthcare, Banking, Logistics, Oil & Gas, Education, IT) → use Lucide `landmark`, `heart-pulse`, `landmark`, `truck`, `fuel`, `graduation-cap`, `cpu`.
- Service pillars (Cyber, Cloud, Managed, App Dev, Enterprise Apps, Data & AI, Contact Centre, BPO) → Lucide `shield-check`, `cloud`, `server`, `code`, `layout-grid`, `brain-circuit`, `headphones`, `git-branch`.

---

## How to use this system (for designers and agents)

1. **Read this file end-to-end.** Then open `colors_and_type.css` and `SKILL.md`.
2. **Pull tokens from `colors_and_type.css`**, never from memory. Hex codes drift.
3. **Use real assets from `assets/`.** Do not redraw the logo, do not generate stand-ins for hero photography.
4. **Match the voice in CONTENT FUNDAMENTALS.** "We", lowercase wordmark, no emoji, Qatar-anchored.
5. **For decks**, copy the patterns in `slides/`. For web/screens, start from `ui_kits/corporate-website/`.

---

## Caveats and open questions

- **Display font is now the real Equestrienne** (supplied). GE Hili and AXTManal (Arabic faces) are still substituted by Reem Kufi / Cairo — flag if pixel-accurate Arabic is needed.
- **No real product UI.** malomatia is a services company; the UI kit is a corporate marketing site recreation, not a product app.
- **Icon system is a substitution.** Lucide is a placeholder until/unless an official set is identified.
- **Arabic samples are minimal.** The brand book has Arabic typography rules but we have not built a full RTL kit — flag if needed.

---

## Index — what lives where

```
README.md                       ← this file
SKILL.md                        ← agent-skill manifest (read first if you're an agent)
colors_and_type.css             ← ALL design tokens (colours, type, spacing, radius, shadow)

assets/
  logos/                        ← 5 official logo variants (black, grey, red, light-on-black, transparent)
  imagery/                      ← 10 brand photos (HQ, skyline, server rooms, portraits, etc.)

fonts/                          ← webfont files (Google Fonts substitutes, see caveats)

preview/                        ← 19 design-system cards (rendered in the Design System tab)
  type-*.html · colors-*.html · spacing-*.html · components-*.html · brand-*.html

ui_kits/
  corporate-website/            ← full corporate marketing site recreation
    index.html · Components.jsx · README.md

slides/
  index.html                    ← 6 sample slides in a <deck-stage> shell
  Slides.jsx · SlideChrome.jsx · deck_stage.js
```

### UI kits available
- **`ui_kits/corporate-website/`** — single-page corporate site: sticky nav, full-bleed hero, stats strip, filterable services grid, sector grid on black, featured case study, CEO quote banner in brand red, leadership, dark footer.

### Slides available
Cover · section divider (red) · stats grid · big quote · services 4×2 · success story split. All at 1920×1080 with auto-scaling via `<deck-stage>`.
