# Monset POS: project rules

This is one POS build, submitted to BIR for accreditation under RMO No. 24-2023 and sold in tiers through a license key. Read `docs/ARCHITECTURE.md` before changing structure, and `docs/BIR_COMPLIANCE_MATRIX.md` before touching `packages/core`.

## Hard rules (never trade away)

1. **Single taxpayer.** A client's sales data lives only on its own devices or its own hub. Never add a Monset-hosted database, API or sync target that holds invoices. Cloud backup is per client, encrypted and non-authoritative.
2. **Offline first.** Every ledger entry carries `created_offline`, `device_id`, `issued_at` and `synced_at`.
3. **The compliance core (`packages/core`) is version-pinned.** It has its own semver, and that version prints on every document. There are no silent updates: never let the service worker call `skipWaiting` automatically. `core` must not import from `modules/` or `apps/`.
4. **Never gate compliance.** `core` never reads `tier` or `features`. Gating happens only in the UI and the modules, through `hasFeature()`.
5. **No training mode and no no-sale mode.** Demo is a separate install with a watermark, and converting it means a full reset. The license mode is fixed for the life of an install.
6. **Append only.** Never `UPDATE` or `DELETE` posted ledger, journal, reading or activity rows; triggers enforce this. Corrections are made only with reversal documents that reference the original.
7. **Commit before confirm.** A sale shows as confirmed or prints only after its SQLite transaction commits.
8. **Data, not constants.** Tax rates, discount rules, payroll tables and contribution rates live in effective-dated `rule_set` rows. Never hardcode a rate.
9. **Money is integer centavos.** Never use floats for money.
10. Invoices say **"Invoice"**, never "Official Receipt". Supplementary documents carry **THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.**
11. Never fabricate accreditation numbers, TINs, a PTU or client data on samples. Use placeholders marked `[TO BE ISSUED]`.

## Working agreement

- Build in the phase order in `docs/ARCHITECTURE.md` and the kickoff brief. Each phase ends with passing tests **and** an updated compliance matrix. Stop for approval after each phase.
- Every matrix row links to at least one test (`T-` unit, `P-` property, `C-` crash, `G-` golden file).
- Regulatory claims are hypotheses. Anything uncertain goes in `docs/OPEN_QUESTIONS.md` with a default.
- The user is a beginner-to-intermediate React developer. Keep explanations of reasoning short and avoid clever abstractions.

## Stack

pnpm workspaces · TypeScript strict · React 19 + Vite + Tailwind v4 + Motion · SQLite (better-sqlite3 on the hub, sqlite-wasm with OPFS in the PWA, Capacitor SQLite on Android) · Vitest + fast-check.

## Design

- Brand from `../monset-website`: night `#0b1a2e`, film `#eef1ec`, contour orange `#e8892f`, pin red `#d23a22` (problems only), steel `#8c97a5`, Archivo Variable with `tnum` on all money. The mark is in `brand/`.
- Use the **impeccable** skill (Operate mode) and **emil-design-eng** for every UI task. Write `DESIGN.md` through impeccable new-work before the first screen in Phase 3.
- No animation in the cashier hot path (adding items, scanning, keypad). Buttons press to `scale(0.97)`. Overlays take 200–250ms with `cubic-bezier(0.23,1,0.32,1)`. Respect `prefers-reduced-motion`. Touch targets are at least 48px.
