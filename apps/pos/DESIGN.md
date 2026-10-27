---
name: Monset POS
description: A point of sale for Philippine restaurants and shops, drawn as a night survey sheet.
colors:
  night: "#0b1a2e"
  night-2: "#12243b"
  night-3: "#1d3352"
  film: "#eef1ec"
  film-2: "#e5eae3"
  well: "#dbe2d9"
  paper: "#f9fbf7"
  line: "#c6cfc4"
  ink: "#0b1a2e"
  ink-soft: "#3d4a5a"
  steel: "#8c97a5"
  mist: "#c3ccd6"
  contour: "#e8892f"
  contour-hover: "#f0994a"
  contour-deep: "#a65410"
  contour-wash: "#f8e3cf"
  pin: "#c4321c"
  pin-wash: "#f7dcd5"
  ok: "#2a7550"
typography:
  display:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 112"
  title:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "0.12em"
    fontVariation: "'wdth' 125"
  figures:
    fontFamily: "Archivo Variable, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    fontFeature: "'tnum' 1"
  receipt:
    fontFamily: "ui-monospace, Cascadia Mono, Roboto Mono, Consolas, monospace"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  sm: "4px"
  pill: "9999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.contour}"
    textColor: "{colors.night}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.contour-hover}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "48px"
  button-night:
    backgroundColor: "{colors.night}"
    textColor: "{colors.film}"
    rounded: "{rounded.sm}"
    height: "48px"
  option-selected:
    backgroundColor: "{colors.contour-wash}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "48px"
  rail:
    backgroundColor: "{colors.night}"
    textColor: "{colors.mist}"
    width: "76px"
  check-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "10px"
  lane:
    backgroundColor: "{colors.well}"
    rounded: "{rounded.sm}"
  drawer:
    backgroundColor: "{colors.paper}"
    width: "clamp(352px, 34vw, 420px)"
---

# Design System: Monset POS

## Overview

**Creative North Star: "The Night Survey"**

Monset's website draws the company's two peaks as a contour survey: night-navy ground, drafting film, orange contour ink. The POS carries that world onto a working counter screen and takes only what a tool can afford from it: the palette, Archivo with its expanded survey lettering, calm density, and one signature move. Navy is the structure, drafting film is where work happens, orange is the one thing to do next (or what is chosen), and red is held back for trouble.

It is a tool first. A cashier who has used any POS knows where everything is before noticing the brand: standard tabs, steppers, fields, buttons and tables, all 48px or more for thumbs on a 10-inch tablet and equally fine with a mouse on a Windows PC. The world shows in the details: tracked caps on lane heads, tabular figures on every peso, and contour rings that tell a server which table has waited longest.

Nothing in the order-entry hot path moves. Adding items, scanning and PIN entry respond instantly. Motion is limited to the drawer sliding in (220ms) and a 0.97 press on buttons.

**Key Characteristics:**
- Night-navy shell, drafting-film work surface, paper cards.
- Contour orange for the primary action and for selection; pin red only for late, void and error, always with words.
- Archivo Variable throughout; expanded tracked caps for survey labels; tabular figures for all money.
- Near-square 4px corners, hairline dividers, soft lift only on cards and the drawer.
- Signature: contour age rings around each table's name.

## Colors

A restrained survey palette: one navy for structure, two near-whites for work, one orange for intent, one red for trouble.

### Primary
- **Contour Orange** (#e8892f): The primary action (New check, Pay, Complete sale, Apply discount) as a fill with navy text; the active rail icon; age rings after 15 minutes. Never text on light grounds.
- **Contour Deep** (#a65410): Orange as text or line on film: focus rings, the selected-option keyline, warning minutes.
- **Contour Wash** (#f8e3cf): The fill of whatever is chosen in a group (tender, discount type, table, filter, selected check).

### Secondary
- **Pin Red** (#c4321c): Late checks (30+ min), voids, refunds, errors. Always with a word. White text on it passes contrast.
- **Paid Green** (#2a7550): Only the invoice-issued mark.

### Neutral
- **Night Survey** (#0b1a2e): Rail, pay header, login and setup panels; also body text (Ink).
- **Night 2 / Night 3** (#12243b / #1d3352): Rail hover and active item.
- **Drafting Film** (#eef1ec): Work-surface ground.
- **Film 2** (#e5eae3): Toolbars and quiet info rows.
- **Column Well** (#dbe2d9): Board lanes.
- **Paper** (#f9fbf7): Cards, drawer, fields, secondary buttons, receipts.
- **Hairline** (#c6cfc4): Dividers and field strokes.
- **Ink Soft** (#3d4a5a): Secondary text on light grounds.
- **Steel** (#8c97a5): Calm rings and decorative strokes only; too light for text on film.
- **Mist** (#c3ccd6): Secondary text on navy.

### Named Rules
**The One Next Thing Rule.** At most one filled Contour Orange button per screen: the action most likely needed next.

**The Words-With-Red Rule.** Pin Red never appears without a word saying what is wrong.

**The Orange Means Chosen Rule.** A chosen option is Contour Wash with a 2px inset Contour Deep keyline. Navy fills are for actions, never selection.

## Typography

**Display Font:** Archivo Variable (with system-ui)
**Body Font:** Archivo Variable (with system-ui)
**Receipt Font:** system monospace, only for printed-document previews

**Character:** One workhorse grotesque. The width axis does the expressive work: labels widen to 125%, display to 112%, body stays normal.

### Hierarchy
- **Display** (800, 1.5–3rem, 1.1, width 112%, -0.02em): Screen titles, table names, amount due, invoice number.
- **Title** (700, 1.125rem, 1.25): Card totals, drawer headings, key figures.
- **Body** (400–600, 1rem, 1.5): Item names, form labels, explanations.
- **Label** (650, 0.75rem, 0.12em, uppercase, width 125%): Lane heads and data labels beside or above a value. Never an eyebrow over a heading.
- **Figures** (tabular-nums): Every amount, quantity, count and document number.

### Named Rules
**The Tabular Money Rule.** Every peso figure is tabular and right-aligned in lists.

**The Monospace Is a Receipt Rule.** Monospace appears only where the UI shows a document exactly as printed and journaled.

## Layout

A fixed 76px navy rail on the left, the work area on the right. The Board has a 56px header over four equal stage lanes (Seated, Ordered, Served, Bill out) that always fit on screen and never scroll sideways: the whole room stays visible. A selected check opens a paper drawer on the right (clamp(352px, 34vw, 420px)); lanes compress beside it, never under it. Each lane is a container-query context: under 200px cards stack (rings on top), 200–440px they run side by side, 440px+ they go two-up.

Adding items swaps the lanes for the menu picker while the drawer keeps the check. Quick sale uses the same split (menu left, cart right). Readings and Journal are two-column work screens; Settings is a sub-navigation beside one readable column (max 42rem).

Spacing runs on a 4px base, mostly 8 / 12 / 16 / 20. Touch targets are 48px+, payment actions 56px. Target screens: landscape 1024×768 tablets to 1920×1080 PCs.

## Elevation & Depth

Flat by default; tonal layering does the work (film ground, well lanes, paper cards). Only cards and the drawer lift.

### Shadow Vocabulary
- **Card** (`box-shadow: 0 1px 2px rgb(11 26 46 / 0.08), 0 4px 12px -4px rgb(11 26 46 / 0.12)`): Check cards, menu tiles, readings summary, receipt preview.
- **Drawer** (`box-shadow: -12px 0 32px -16px rgb(11 26 46 / 0.35)`): Check and cart drawer, supervisor PIN dialog.

### Named Rules
**The Two Lifts Rule.** Only cards and the drawer cast shadows; everything else separates by tone or hairline.

## Shapes

Near-square 4px corners on every control, card, lane, field and receipt. Pills only for lane counts and late badges. Circles only for the contour rings and the user avatar. Dividers are 1px Hairline.

## Components

### Buttons
- **Shape:** 4px corners, 48px+ tall, semibold Archivo at 104% width.
- **Primary:** Contour Orange fill, navy text; hover (fine pointers only) #f0994a.
- **Secondary:** Paper fill, Hairline stroke, Ink text; stroke darkens to Steel on hover.
- **Night:** Navy fill, film text, for strong neutral actions (Z reading, menu Done).
- **Danger:** Pin Red fill, white text, only to issue a void, refund, return or cancellation.
- **Press:** scale 0.97 over 160ms (cubic-bezier(0.23, 1, 0.32, 1)); removed under reduced motion.

### Option groups (tenders, discount types, tables, filters)
- **Style:** Secondary buttons in a grid.
- **Selected:** Contour Wash fill with 2px inset Contour Deep keyline.

### Check card
- **Corner style:** 4px. **Background:** Paper. **Shadow:** Card.
- **Content:** age rings (60px) and long label, bold tabular total, guests and server, minutes open (Contour Deep from 15, Pin Red with "late" from 30).
- **Selected:** Contour Wash fill with 2px Contour Deep ring; the ring summit takes the card fill.

### Inputs / Fields
- **Style:** Paper fill, 1px Hairline stroke, 4px corners, 48px tall.
- **Focus:** 2px Contour Deep outline replaces the stroke; caret is Contour Deep.
- **Search:** the menu search doubles as the barcode field; a scanner's Enter adds the item.

### Navigation (rail)
- 76px navy rail, icon-over-label items (Lucide, 1.75 stroke, 24px). Inactive Mist; active Night 3 fill with Contour Orange icon. Bottom: hub/offline status, EN/FIL switch, signed-in initials (tap to sign out).

### Contour Age Rings (signature)
The table's short name ("T5", "B1", "TO3") sits on a paper summit (32% of the size). Concentric contour lines fill the band outside it, one more every 6 minutes up to 6; the band stays the same width, so more rings sit tighter and age reads as steepness. Steel when calm, Contour Orange from 15 minutes, Pin Red from 30 (outer ring 2px). Static, no animation. Lane heads and the Board header add a Pin Red "N late" badge so a late table is never missed off-screen.

## Do's and Don'ts

### Do:
- **Do** keep one filled Contour Orange action per screen, bottom right of the drawer.
- **Do** use tabular, right-aligned figures for every amount.
- **Do** keep all four stage lanes visible whenever the drawer is open.
- **Do** pair Pin Red with words, every time.
- **Do** give touch targets 48px+ and payment actions 56px.
- **Do** keep order entry instant: no animation on adding items, scanning or keypads.

### Don't:
- **Don't** use orange as text on film; use Contour Deep (#a65410).
- **Don't** fill a selected option with navy.
- **Don't** put an uppercase label above a heading as an eyebrow.
- **Don't** use monospace anywhere except a printed-document preview.
- **Don't** add shadows beyond the Card and Drawer lifts.
- **Don't** let toasts cover a receipt or document; they sit bottom-left of the work area and clear on navigation.
