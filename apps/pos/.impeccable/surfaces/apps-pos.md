---
version: 1
slug: "apps-pos"
primary_target: "apps/pos"
related_targets: []
---

# Surface: Monset POS selling screen (apps/pos)

Mode: Operate. Landscape tablet (10-11"), Windows touchscreen PC and laptop: touch and mouse/keyboard equally. Restaurant/F&B leads; retail quick sale shares the shell. Payments are recorded tenders (plug-in interface; gateways later).

Audience and job: cashiers and servers under queue pressure, supervisors approving voids and discounts, owners closing the day. Read the room, open a check, add items, apply SC/PWD correctly, take payment, issue the invoice.

Constraints: no animation on adding items, keypad or scanner input; 48px minimum targets; works offline; never shows anything resembling an invoice in ordering-only mode.

## Direction contract

THESIS: The room is one live board. Every open check sits in its stage column, and late tables cannot be missed. This refuses the category default of a floor-plan landing page plus a modal order screen.

OWN-WORLD: Monset "Survey". The shell rail and header are night navy #0b1a2e, and the work ground is drafting film #eef1ec with #dfe5dd column wells. Contour orange #e8892f is only for the primary action, selection and focus. Pin red #d23a22 is only for late, void and error, always paired with a label. Steel #8c97a5 is for secondary text. The type is Archivo Variable: expanded tracked caps for column heads, tabular figures for every amount. Corners are 4px, dividers are hairlines, and the only raise is on cards.

STORY: The cashier sees the whole room. A late table's rings go red, so they open that check in the drawer. They add items from the menu, which takes over the board area while the drawer holds the check. Then they apply a senior discount and take payment. The invoice prints, and the card leaves the board.

FIRST VIEWPORT: On the left, a 72px navy rail: Board, Quick sale, Readings, Journal, Settings, then the signed-in user, with the hub and offline status at the bottom. Across the top, a 56px header: business date, open-check count, net sales so far, and an orange New check button. Four columns fill the centre: Seated, Ordered, Served, Bill out, each with a caps head and a count. Each check card shows a large table name, guests, server, total and minutes open. The card's signature is contour rings around the table name that tighten with age, turning orange at 15 minutes and pin red at 30. A 400px check drawer slides in on the right when a card is selected.

FORM: Service Board, position 5 on the ordered list, seed key 1b7f1c6f.

SIGNATURE: contour age rings on each check card (concentric rings drawn as an SVG, ring count and colour from minutes open); reduced motion keeps them static.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
