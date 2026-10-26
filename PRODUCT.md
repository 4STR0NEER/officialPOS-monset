# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Ships as a PWA for Android/iPad tablets, a local hub on a Windows mini PC that serves that PWA, and an Android app made by wrapping the same PWA in Capacitor. It is one web UI, so the design language is web, not native per OS.)

## Stack

Confirmed by the user on 2026-10-26: TypeScript everywhere, a React PWA, and local SQLite. The Windows "installed app" is the local hub (Node with native SQLite) serving the PWA to every terminal, and Android gets a thin Capacitor shell. There is no Electron and no Tauri/Rust. See `docs/ARCHITECTURE.md`.

## Users

1. **Cashiers and servers.** They work at the counter or the table on a tablet, in bright stores, often with one hand, under queue pressure. Their job is to ring up a sale correctly and quickly and to hand over a valid invoice.
2. **Supervisors and managers.** They approve voids, refunds and discounts, run X and Z readings, and close the day.
3. **Owners.** They watch sales, margins, stock, staff and payroll across their own branches, and they need to trust that the books will survive a BIR audit.
4. **BIR evaluators (the Technical Working Group).** They see the system once during the accreditation demo and test whether it is tamper free, numbered without gaps, controlled offline and reconciled.
5. **Monset staff.** They install the system, register terminals (MIN, PTU), issue licenses and support clients.

## Product Purpose

Monset POS is one BIR-accredited point of sale that includes every feature Monset will ever sell. Cheaper tiers are licenses that switch features off; we never ship a different build per tier. Success has three parts: the system passes BIR accreditation under RMO No. 24-2023, clients never lose a sale or fail an audit, and Monset can sell any tier without re-accrediting.

## Positioning

The client owns its own data. Every client's invoices live on that client's own devices or its in-store hub and never in a shared Monset cloud. That keeps Monset POS a single-taxpayer POS rather than an e-invoicing service provider (RMC No. 110-2026), and it means the client is never locked in.

## Operating Context

- Philippine SMEs: restaurants, cafes, retail, pharmacies, salons.
- The internet is unreliable, so the system works offline first. Thermal printers are 58mm and 80mm, with A4 for reports.
- BIR rituals shape the workflows: terminal registration (MIN, PTU or Acknowledgement Certificate), X and Z readings, monthly eSales, special discount books, and later EIS transmission.

## Capabilities and Constraints

- The compliance core is version-pinned and can never be gated by tier. Training mode and no-sale mode are not allowed.
- Invoices are always called "Invoice", never "Official Receipt" (EOPT Act, RR 7-2024).
- Every tax rate, discount rate and contribution table is data with effective dates.
- Open regulatory questions are tracked in `docs/OPEN_QUESTIONS.md`.

## Brand Commitments

- The brand comes from the Monset website (`../monset-website`). The name is "Monset.co" with the ".co" in orange, and the mark is the two slanted peaks (`brand/`). The palette is night navy `#0b1a2e`, drafting-film paper `#eef1ec`, contour orange `#e8892f` (deep `#a65410`), benchmark red `#d23a22` reserved for problems, and steel `#8c97a5`. The type is Archivo Variable. Easing is `cubic-bezier(0.23,1,0.32,1)`.
- The voice is plain and direct, with no jargon and no pressure, in English and Filipino.
- The client's brand goes on the client's invoice header. Monset appears only in the accredited-supplier footer and the app chrome.
- Design and motion follow the impeccable and emil-design-eng skills. The POS is an Operate surface, so speed and legibility come before expression.

## Evidence on Hand

- No accreditation number, PTU, client deployments or Monset TIN yet. Never fabricate them on sample documents. Use clearly marked placeholders.
- Earlier demos (`../sample-pos`, `../couraged-pos`) are reference material only.

## Product Principles

1. Compliance first. The ledger is the truth, and nothing gets past it.
2. Offline is normal, not an error.
3. One build with license-gated tiers. Compliance is never a paid feature.
4. Make the cashier fast: fewest taps, nothing animated in the hot path.
5. Honest documents. A demo is marked DEMO, a reprint is marked REPRINT, and a supplementary document carries its footer.

## Accessibility & Inclusion

Touch targets of at least 48px, contrast that holds up under store glare, tabular figures for money, a Filipino and English UI, and no meaning carried by colour alone (voids and errors also carry a label).
