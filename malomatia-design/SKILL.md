---
name: malomatia-design
description: Use this skill to generate well-branded interfaces and assets for malomatia — Qatar's national IT services and digital transformation company — either for production or throwaway prototypes/mocks/decks. Contains essential design guidelines, colors, type, fonts, logos, imagery, and UI-kit components for prototyping corporate marketing, slide decks, and service-oriented interfaces.
user-invocable: true
---

# malomatia design skill

Read `README.md` in this skill first, then explore the other files. `README.md` contains the brand context, content voice, visual foundations, and iconography rules. `colors_and_type.css` is the single source of truth for all design tokens (colours, fonts, type scale, spacing, shadows, radii).

## Working with this skill

- **Pull tokens from `colors_and_type.css`**, never from memory. Use the semantic variables (`--fg-1`, `--bg-accent`, `--h1`, `--stat-number`) rather than raw hex where possible.
- **Use real assets from `assets/`**: logos live in `assets/logos/`, brand photography in `assets/imagery/`. Do not redraw the logo or invent stand-ins.
- **Match the voice.** Brand voice is institutional-confident, plural "we", lowercase "malomatia" wordmark, no emoji, frequent reference to Qatar. Display typography renders in italic/lowercase for emotional phrases ("reimagining what's possible").
- **Respect the palette.** Only four brand colours: black, white, brand red `#CF0A2C`, and greys (`#777575`, `#999999`). No bluish-purple gradients, no pastel accents.
- **Icons:** Lucide via CDN, 1.5px stroke. Never emoji. See `README.md` → ICONOGRAPHY for full rules.

## If creating visual artifacts

Copy the required assets out of this folder into your working project (the design system is the source; your artifact should be self-contained). Then build static HTML files referencing the copied assets. For decks, mirror the patterns in `slides/`. For web/app-style screens, mirror `ui_kits/corporate-website/`.

## If the user invokes this skill without any other guidance

Ask them what they want to build or design — a slide deck, a landing page, a one-pager, a case study, a pitch, an internal tool mock. Ask some clarifying questions (audience, tone, length, variations). Then act as an expert designer who outputs either HTML artifacts or production code, depending on the need.

## File map

- `README.md` — brand context, content fundamentals, visual foundations, iconography
- `colors_and_type.css` — design tokens
- `assets/logos/` — 5 official logo variants
- `assets/imagery/` — brand photography
- `fonts/` — webfont files (Google Fonts substitutes noted in README)
- `preview/` — visual specimens for every token class
- `ui_kits/corporate-website/` — a full corporate marketing site recreation
- `slides/` — 6 sample slides in a `<deck-stage>` shell
