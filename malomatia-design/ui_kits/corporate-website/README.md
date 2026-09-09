# Corporate Website UI Kit

A high-fidelity recreation of a malomatia corporate marketing website. No public web product was provided as source — this kit is built directly from the brand book + 2025 corporate deck materials, treating those as the design source of truth.

## Files
- `index.html` — full single-page corporate site (hero, services, sectors, success stories, leadership, contact)
- `Components.jsx` — Header, Footer, Hero, ServiceCard, StatBlock, SuccessStory, SectorChip, CTAButton, etc.

## Approach
- Pure HTML + React (Babel-transpiled inline) — no build step
- Pulls every token from `../../colors_and_type.css`
- Real logo and imagery from `../../assets/`
- Lucide icons via CDN (1.5px stroke per design system rules)

## Coverage
- Sticky top nav with brand mark + 5 sections
- Full-bleed hero with the deck's "reimagining what's possible" treatment
- Stats strip (the four big numbers from slide 6)
- Service grid (8 service pillars from the deck)
- Sector grid (6 client sectors)
- Featured success story (Al Nadeeb, with the four KPIs)
- Leadership preview (3 portraits, monochrome)
- Contact / footer with brand book contact details
