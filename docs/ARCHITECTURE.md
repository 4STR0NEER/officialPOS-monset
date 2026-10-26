# Monset POS: Architecture

Status: **Phase 0 draft, awaiting approval.** Compliance core version: `core 0.0.0` (unreleased).

Every regulatory statement here is a requirement still to verify. Anything that is in doubt is listed in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md).

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | One language for the core, UI, hub and tests. The compliance core runs unchanged in every runtime. |
| Monorepo | pnpm workspaces | Lets the core have its own version number while the rest of the app ships around it. No build orchestrator until we need one. |
| UI | React 19 + Vite + Tailwind v4 + Motion | The same stack as the Monset website, so the brand tokens carry over directly. |
| Storage | SQLite everywhere | One schema and one set of SQL. Its WAL mode with `synchronous=FULL` survives a power cut. |
| ↳ hub / Windows | `better-sqlite3` (Node) | Synchronous native SQLite: fast, and simple to make crash-safe. |
| ↳ PWA | `@sqlite.org/sqlite-wasm` with OPFS (`opfs-sahpool` VFS) in a Web Worker | The official build, and OPFS persists data. |
| ↳ Android app | Capacitor + `@capacitor-community/sqlite` | Native SQLite on the device. The UI is the same PWA. |
| Hub | Node 22 LTS, `node:http` + WebSocket (`ws`) | Serves the PWA, receives the terminals' replicated ledgers, drives printers and runs backups. Packaged as one Windows service. |
| Tests | Vitest + fast-check (property tests) + child-process kill tests | See §11. |
| Crypto | WebCrypto / `node:crypto`: SHA-256, Ed25519, AES-GCM | No third-party crypto in the core. |

**Rejected:** Electron, because it adds a second runtime to accredit. Tauri, because the compliance code would need Rust or a bridge. Supabase or any shared cloud, because it would breach the single-taxpayer rule (RMC 110-2026). PGlite (used in sample-pos), because the three runtimes would no longer share the same SQL engine.

### Deployment shapes (all single-taxpayer)

```
A. Single tablet, PWA or Android app   ──  local SQLite is the system of record
B. Store with a hub                    ──  each terminal keeps its own ledger (system of record for its MIN)
   [Tablet T1]──┐                          + the hub keeps a verified replica of every terminal,
   [Tablet T2]──┼── LAN ── [Hub mini PC]   reports across terminals, printers, encrypted backup
   [Windows T3]─┘           (client-owned)
C. Optional per-client cloud backup    ──  encrypted blob in the client's own storage, never authoritative
```

A Windows counter PC can run the hub and a terminal at the same time, with the browser pointed at `localhost`.

---

## 2. Repository layout

```
packages/
  core/          COMPLIANCE CORE: own semver, accredited, printed on invoices
    ledger/      append-only entries, hash chain, reversals
    numbering/   document series, gapless allocation, reset counters
    totals/      VAT modes, special discounts, rounding (pure functions)
    readings/    X / Z readings, accumulators
    journal/     e-journal render + export
    activity/    activity log (hash-chained)
    documents/   invoice + supplementary document model, print layout (text/ESC-POS/A4)
    seal/        QR validation seal (sign/verify)
    reports/     BIR backend books, eSales, EIS-ready export
    store/       StoragePort interface + migrations (SQL)
    license/     license verification (read-only to core: core never gates on tier)
  storage-node/  better-sqlite3 adapter
  storage-wasm/  sqlite-wasm OPFS adapter
  storage-cap/   Capacitor SQLite adapter
  modules/       BUSINESS MODULES (outside accreditation boundary, see OPEN_QUESTIONS Q2)
    inventory/ purchasing/ payroll/ forecasting/ crm/ workforce/ dashboard/
apps/
  pos/           React PWA (selling UI, back office)
  hub/           Node local hub
  android/       Capacitor shell
  license-tool/  Monset-internal CLI: issue signed license files (never shipped to clients)
  verify/        static page for monset.co/verify (QR seal verifier, no database)
docs/            plan, compliance matrix, accreditation pack
brand/           Monset mark + logo from monset-website
```

**Boundary rules, enforced by `dependency-cruiser` in CI:**
- `core` imports nothing from `modules`, `apps` or any UI.
- `modules` can use only `core`'s public API (`postSale`, `postReversal`, the read queries and the events). They never write core tables directly.
- Only `core` may write core tables. SQLite triggers block `UPDATE`/`DELETE` on posted rows, so nothing can bypass this, not even a buggy module (see §4).

---

## 3. Compliance core version pinning

- `packages/core/package.json` holds the version we accredit. At build time a `CORE_MANIFEST` is generated, containing `{version, sha256 of core bundle}`, and Monset signs it with its root key.
- At startup the app recomputes the hash of the loaded core bundle. If it does not match the signed manifest, the app refuses to issue documents, writes a `CORE_INTEGRITY_FAIL` entry to the activity log and shows a lock screen.
- The core version prints on every invoice and reading (`Monset POS Core v1.0.0`).
- **No silent updates.** The PWA service worker never calls `skipWaiting()` automatically. A new release installs only when an admin chooses **Install update**, and only after the day's Z reading. The install is logged with the old and new versions. The hub serves assets from versioned paths (`/v/1.0.0/…`).
- Business modules ship in separate chunks with their own versions. A change to a module never changes the core hash. Whether BIR accepts this split is open question Q2.

---

## 4. Data model (core)

Money is stored as **integer centavos** (`INTEGER`). The largest grand total, 999,999,999,999.99, is about 10¹⁴ centavos, safely below 2⁵³. Quantities are stored as integer thousandths so weighed items work. Timestamps are ISO-8601 UTC plus the device's local offset.

| Table | Purpose | Key columns |
|---|---|---|
| `terminal` | This device's identity | `terminal_id`, `device_id`, `min`, `serial`, `sln` (Software License Number), `ptu_no`, `ptu_date`, `vat_mode` |
| `doc_series` | One row for each (terminal, doc_type) | `doc_type` (INVOICE, ORDER, VOID, REFUND, RETURN, CANCEL, ACK, COLLECTION, X, Z, TXN), `prefix`, `next_no`, `width ≥ 6`, `reset_counter` |
| `ledger_entry` | **Append only.** One row per issued document | `entry_id`, `seq` (per terminal, gapless), `doc_type`, `doc_no`, `reverses_entry_id`, `business_date`, `issued_at`, `created_offline`, `device_id`, `synced_at`, `user_id`, `totals_json`, `prev_hash`, `hash` |
| `ledger_line` | Items | `entry_id`, `line_no`, `sku`, `description`, `qty_milli`, `unit_price`, `vat_class` (VATABLE, EXEMPT, ZERO), `line_total`, `discount_alloc` |
| `ledger_payment` | Tenders | `entry_id`, `method`, `amount`, `provider_ref` |
| `ledger_special_discount` | SC, PWD, NAAC and Solo Parent capture | `entry_id`, `discount_type`, `holder_name`, `id_no`, `tin`, `rate_bp`, `vat_exempt_amount`, `discount_amount`, `share_basis` (whole, portion or group pro-rata), `channel` (in-store or online) |
| `buyer` (on the entry) | Buyer details | `name`, `address`, `tin`, `business_style` |
| `accumulator` | Running totals, one row per terminal | `grand_total` (gross, never decreases), `reset_counter`, `z_counter`, plus running sums for voids, refunds and returns |
| `reading` | X and Z readings (also ledger entries of type X or Z) | the snapshot fields from §6 |
| `journal` | E-journal: exact rendered text of each document | `entry_id`, `rendered_text`, `layout_version` |
| `activity_log` | **Append only, hash-chained** | `at`, `user_id`, `device_id`, `action`, `object`, `before_json`, `after_json`, `prev_hash`, `hash` |
| `reprint` | Reprint register | `entry_id`, `at`, `user_id`, `reprint_no` |
| `manual_invoice` | Fallback manual invoices | `manual_series`, `manual_no`, `linked_entry_id`, `amounts`, `reason` |
| `rule_set` | Rules that change over time | `kind` (VAT_RATE, DISCOUNT_TYPE, …), `effective_from`, `effective_to`, `payload_json`, `source_ref` |
| `outbox` | Replication to the hub | `entry_id`, `pushed_at`, `ack_at` |

**Tamper controls**
1. SQLite `BEFORE UPDATE` and `BEFORE DELETE` triggers on `ledger_*`, `journal`, `activity_log` and `reading` call `RAISE(ABORT)`. The schema itself refuses edits.
2. **Hash chain:** `hash = SHA-256(prev_hash ‖ canonical_json(entry + lines + payments + discounts))`. Verification runs at startup, before every Z reading and on demand. A broken link logs `INTEGRITY_BREAK` with the first bad sequence number and locks issuing until a supervisor acknowledges it.
3. **Clock guard:** a document cannot carry a timestamp earlier than the last posted one. Any skew is logged as `CLOCK_ANOMALY`, and the monotonic `seq` is the order of truth.
4. The core never exposes a `delete` or `update` API. Corrections are made only with reversal documents that carry `reverses_entry_id`.

**Posting a sale is one SQLite transaction:** allocate the number, then insert the entry and its lines, compute and store the hash, add to the accumulators, insert the journal row and insert the outbox row. The transaction then **commits, and only after that** does anything print or show as confirmed. A crash at any point leaves either the whole sale or none of it, and so no gap in the numbers.

---

## 5. Numbering

- Each **terminal owns its own series** and never asks the hub for numbers, so it can issue offline. This fits BIR's per-MIN model.
- The invoice series is separate from the order and transaction series. Every supplementary document type (order slip, void, refund, return, cancellation, acknowledgement receipt, collection receipt) has its own series.
- Numbers are at least 6 digits (`width` is configurable and the floor is 6). When a series runs out, it rolls over and increments `reset_counter`, which prints on the documents and readings where required.
- Gapless by construction: `next_no` is read and incremented inside the posting transaction, and SQLite's single writer serializes concurrent sales on the same device.

## 6. Readings

- **X reading**: a snapshot since the last Z. It does not close the day. Each X reading gets its own number and a journal entry.
- **Z reading**: closes the business day and increments `z_counter`, which can never be reset. It records:
  - the beginning and ending invoice numbers, and the beginning and ending grand totals;
  - gross sales, VATable sales, VAT amount, VAT-exempt sales and zero-rated sales;
  - discounts by type, plus voids, returns and refunds (count and amount);
  - the payment breakdown, the reset counter and the Z counter.
- **Invariant:** every Z total equals the sum of the ledger rows for that day. A property test checks this, and the system recomputes it before printing.

## 7. Tax and discount engine (`core/totals`, pure functions)

- **VAT modes:** VAT-registered (12%, configurable through `rule_set`), Non-VAT under percentage tax (shows sales subject to percentage tax and exempt sales separately), and Exempt (prints "EXEMPT" prominently).
- **Mixed sales:** each line carries a `vat_class`, and the totals split into VATable, VAT-exempt and zero-rated.
- **Special discounts:** the discount types are data in `rule_set` (SC, PWD, NAAC, Solo Parent, plus whatever is added later), each with its rate, whether it waives VAT, which item categories qualify, any purchase caps, required fields and `effective_from`.
  - **Order of operations:** take the VAT-inclusive price ÷ (1 + VAT rate) to get the net, apply the discount to the net, then compute the amount due.
  - **Group meals:** when only part of an order belongs to the cardholder, apply the discount either to the items identified as theirs or to a pro-rata share (total ÷ number of diners) as the rules say. Record the share basis on `ledger_special_discount`.
  - **No double discounts:** promotions and special discounts follow the rule set's `stacking` policy. By default only the greater one applies, never both.
  - **Online and app orders:** no signature line, but the ID number, TIN and breakdown are still required.
  - The Digital National Senior Citizen ID is accepted as an ID type. No purchase booklet is required for medicine.
- **Rounding:** half-up to the centavo at the line level and then at the document level. Any rounding difference is recorded explicitly so totals always reconcile.

## 8. Documents and printing

- There is one **document model**, and three renderers produce output from it: a fixed-width text layout (32 columns for 58mm, 48 columns for 80mm), which is also the e-journal text and the golden-test target; ESC/POS bytes; and an A4 HTML page converted to PDF.
- Every field in the header, body and footer comes from the requirements and is configured per client, with layout data versioned in `layout_version`.
- Supplementary documents carry the bold footer **THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.**
- A reprint repeats the original body and adds a `REPRINT #n` banner plus the date and time of the reprint, and it is logged.
- A demo license adds a watermark line to every document: **DEMO, NOT FOR LIVE USE, NOT A VALID INVOICE**.
- Printer transport depends on the device: the hub drives USB and network printers, the PWA uses WebUSB or Web Bluetooth where it can and otherwise goes through the hub, and the Android app uses a Capacitor plugin.

## 9. Validation seal (QR) without a shared database

```
Monset root key (offline, Monset only)
   └─ signs → install certificate {SLN, terminal pubkey, client TIN+branch, MIN, valid}
                  └─ terminal key signs → invoice digest {SLN, doc_no, date, total, VAT, buyer TIN?, hash}
QR = base45( cbor{ cert, digest, sig } )  ≈ 250–350 bytes, fits a QR version 10–12 on 58mm
```

The page at `monset.co/verify` is **static**. It holds only Monset's root public key, checks the certificate chain and signature in the browser, and shows what the invoice claims. Nothing is stored, and no client data reaches Monset. A valid seal proves the invoice came from a licensed install unaltered. It does not prove the invoice exists in the client's ledger, and the pack says so plainly. Q11 asks whether BIR wants more.

## 10. Sync, offline and the hub

- **Offline flags on every entry:** `created_offline` (whether the hub was unreachable when the entry was posted), `device_id`, `issued_at` (the device clock) and `synced_at` (when the hub acknowledged it).
- **Replication is one way, terminal to hub.** The terminal pushes its outbox in `seq` order. The hub re-verifies the hash chain for each terminal and stores the replica read-only. A gap or a bad hash is rejected and logged on both sides. Because every terminal owns its own number series, there are no write conflicts to resolve.
- **Master data** (items, prices, staff, rule sets) flows from the hub to the terminals as versioned snapshots. A sale records the price and rule-set version that were actually applied, so a later price change never rewrites history.
- **PWA durability:** the PWA calls `navigator.storage.persist()` on first run and shows a warning when the browser refuses. In shape B the hub copy is the durable backup. Q3a asks whether a PWA-only install (shape A on an iPad) is acceptable.

## 11. Recovery and backup

- WAL mode, `synchronous=FULL`, and the "commit before confirm" rule from §4.
- **Backup:** a SQLite online backup, encrypted with AES-GCM using a key derived from a client passphrase through PBKDF2 or Argon2. Backups can go to a USB drive, the hub, or the client's own cloud folder.
- **Restore guard:** a restore is refused if the backup's `(seq, grand_total, z_counter)` is behind data the BIR could already have seen, for example the last printed Z or the hub replica, because that would rewind the numbering. Restoring onto a new device keeps the same series and totals, needs a supervisor, and is logged.

## 12. Licensing and tiers

- **License file:** JSON signed with Monset's root Ed25519 key, containing `{sln, client_tin, branch, tier, features[], terminals, mode: LIVE|DEMO|NON_INVOICING, issued, expires?}`. It is verified offline.
- **Software License Number (SLN):** `MPOS-<yy>-<6 base32>-<check>`, unique for each installation and printed on invoices.
- **Gating** happens only in the UI and the business modules, through `hasFeature(f)`. The core never reads `tier` or `features`. That separation is how "never gate compliance" is enforced, and a static test fails the build if `core/` references either one.
- **Draft tiers**, aligned with Monset's Starter, Business and Premium packages, with the final split up to sales:

| Tier | Mode | Includes |
|---|---|---|
| Order | NON_INVOICING (a Special Purpose Machine) | Ordering, kitchen display, inventory and sales tracking. Prints only supplementary slips with the footer. Cannot issue invoices. |
| Starter | LIVE | The full compliance core, retail or F&B selling, basic reports |
| Business | LIVE | Everything in Starter, plus inventory, purchasing, recipes, multiple terminals with the hub, and CRM and loyalty |
| Premium | LIVE | Everything, including payroll, forecasting and multiple branches |
| Demo | DEMO | Everything, watermarked. Converting it to LIVE wipes the database. |

- **Mode is fixed for the life of an installation.** Upgrading DEMO or NON_INVOICING to LIVE means a fresh database, terminal registration and a MIN. Going from LIVE to NON_INVOICING is impossible, because that would amount to a "no-sale mode" (RR 11-2004). Changing tier within LIVE only changes `features`. See Q1.

## 13. Business modules

They read core events (`SalePosted`, `ReversalPosted`, `ZClosed`) and keep their own tables, which they are free to mutate: inventory, purchasing, recipes and bills of materials, workforce and payroll, forecasting, CRM, loyalty and reservations, dashboards. Payment providers are plug-ins behind a `PaymentProvider` interface. Every rate (SSS, PhilHealth, Pag-IBIG, withholding tax, overtime and holiday premiums) lives in that module's own effective-dated rule tables. Forecasting uses moving averages, seasonal decomposition and Holt-Winters exponential smoothing, with confidence bands and a Philippine holiday calendar. Its maths runs in pure functions so it can be tested, with no black-box models.

**Personal data (Data Privacy Act):** customer profiles live in CRM tables, separate from the ledger. Deleting a profile anonymizes the CRM record. Buyer fields on invoices stay, because tax records must be retained (Q5).

## 14. UI and brand

The look comes from the Monset website, with tokens copied from `monset-website/src/index.css`:

| Token | Value | POS use |
|---|---|---|
| night | `#0b1a2e` | App chrome and dark mode |
| film / film-2 | `#eef1ec` / `#dfe5dd` | Default **light** work surface. Counters are bright, so light reads better under glare. |
| contour / contour-deep | `#e8892f` / `#a65410` | Primary action (Pay or Charge), focus ring, selection |
| pin | `#d23a22` | Voids, integrity alerts, errors, always paired with a text label |
| steel | `#8c97a5` | Secondary text and dividers |
| font | Archivo Variable, `tnum` turned on for every amount | |

- The design follows **impeccable** in Operate mode: scannable, consistent, with the brand showing in precise details such as the `map-label` caps for section labels and the peaks mark on the lock and sign-in screens. `DESIGN.md` will be written in Phase 3 through impeccable's new-work flow, before any screen is built.
- Motion follows **emil-design-eng**. There is no animation in the hot path: adding an item, scanning, or typing a quantity or PIN responds instantly. Buttons press to `scale(0.97)` in 160ms. Drawers and modals use 200–250ms with `--ease-out`. Everything respects `prefers-reduced-motion`. Hover effects are gated behind `(hover: hover)`.
- Touch targets are at least 48px, and the layouts are tuned for 8–11 inch tablets in landscape.
- The client's own logo and name go in the invoice header. The Monset name prints in the accredited-supplier footer and appears in the app's "About" screen.

## 15. Update strategy

| Component | Channel | Rule |
|---|---|---|
| Compliance core | A deliberate signed release that an admin chooses to install after the Z reading | A new core version needs BIR notice or re-accreditation before release (Q2) |
| Business modules | Signed module bundles | Never touch the core hash |
| Rule sets (VAT, discount, payroll tables) | Signed data packs with `effective_from` | Q2: confirm whether a tax or discount rule pack counts as a "parameter change" |
| License | A new signed license file | Changes tier and features only |

## 16. Testing (detail in the compliance matrix)

- **Property tests:** the grand total never decreases, numbering stays gapless under random interleavings, every reversal references an existing original, Z reconciles with the ledger, and discount maths stays within bounds.
- **Crash tests:** a child process posting sales is killed with SIGKILL at random points, and after reopening the test asserts the invariants still hold.
- **Sync tests:** N simulated terminals work offline, then sync, and the replicas must equal the sources.
- **Golden files:** the text layout of every document type at 32 and 48 columns, compared byte for byte.
- Every row in the matrix has a test ID, and CI fails if any row is missing one.
