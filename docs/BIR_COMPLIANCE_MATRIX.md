# BIR Compliance Matrix

This file is the accreditation evidence pack. Each requirement maps to its module, table, function and test.

Status key: `planned` → `partial` (some of it built and tested) → `tested` → `demo-ready`.
Test files: **core** = `packages/core/test/core.test.ts`, **prop** = `packages/core/test/property.test.ts` (fast-check, 150 random business days per property), **golden** = `packages/core/test/golden.test.ts`, **dur** = `packages/storage-node/test/durability.test.ts` (real child processes on a real database file). The test name starts with the test ID.

Run everything: `npm test`. Compliance core under evaluation: **`core 0.1.0`** (pre-accreditation).

Sources are as cited in the kickoff brief and **still to be verified** (see OPEN_QUESTIONS.md). Annex F will be cross-mapped once the RDO supplies it (Q7).

---

## A. Architectural constraints

| ID | Requirement | Source | Where | Test(s) | Status |
|---|---|---|---|---|---|
| A1 | Single-taxpayer: no shared Monset system of record | RMC 110-2026 | whole core: storage is a local `Db` port only | core `T-A1-no-remote-sor` (static scan: no network client in the core) | tested |
| A2 | Offline first; offline audit flags on every transaction | Brief §2 | `ledger_entry.created_offline, device_id, issued_at` (hashed); `outbox.acked_at`; `markSynced()` | core `T-A2-offline-flags`; multi-terminal sync tests in Phase 3 | partial |
| A3 | Core version pinned and printed; no silent updates | Brief §3 | `CORE_VERSION`, `ledger_entry.core_version`, journal header | core `T-A3-core-version`. The signed manifest and service-worker test come in Phase 5. | partial |
| A4 | Tier gating only through the license; compliance never gated | Brief §4 | the core has no tier concept | core `T-A4-core-never-reads-tier` (static) | tested (core side) |
| A5 | Non-invoicing mode never issues invoices; slips carry the supplementary footer | RMO 24-2023 (SPM) | `append()` refuses INVOICE when `mode=NON_INVOICING` | core `T-A5-nonInvoicing-blocks-invoice`. The slip-footer test comes in Phase 2. | partial |
| A6 | Unique Software License Number printed on invoices | RMO 24-2023 | `terminal.sln`, snapshotted into each invoice body and journal | golden `G-EJ-01` (prints SLN). License generation comes in Phase 5. | partial |
| A7 | No training or no-sale mode; demo watermarked and not convertible | RR 11-2004 | trigger `terminal_identity_fixed`, `initTerminal` once only, `renderPlain` watermark | core `T-A7-no-mode-switch-api`, `T-A7-demo-watermark`. The demo-to-live reset comes in Phase 5. | partial |

## B. Compliance core: RMO 24-2023, Section IV(5)

| ID | Requirement | Where | Test(s) | Status |
|---|---|---|---|---|
| B1 | Accumulated Grand Total: 12+2 digits, never reset or reduced, rolls over with a reset counter | `accumulator`, `addGrandTotal()`, trigger `accumulator_forward_only` | prop `P-B1-gt-monotonic`; core `T-B1-rollover-increments-reset`, `T-B1-gt-cannot-decrease` | tested |
| B2 | Tamper free: append-only, reversals only, integrity breaks detected | append-only triggers, `postReversal()`, `verifyAll()` hash chain, `LOCKED` and `INTEGRITY_ACK` | core `T-B2-update/delete-trigger-aborts`, `T-B2-chain-detects-edit`; prop `P-B2-reversal-refs-original`, `P-B2-reversals-bounded` | tested |
| B3 | Activity log of everything, with user, device, time and before/after | `activity_log` (hash-chained), `log()`, `record()`, refused attempts logged as `REJECTED` | core `T-B3-each-action-logged`, `T-B3-log-chain` | tested |
| B4 | No sale lost on a crash; backup and restore keep numbering and the grand total | WAL + `synchronous=FULL`, one transaction per posting, `backup()` / `restore()` / `checkRestore()` | dur `C-B4-kill-during-post` (10 SIGKILLs mid-write), `T-B4-restore-preserves-seq-gt`, `T-B4-restore-refuses-rewind` | tested |
| B5 | Electronic journal: complete, exportable, human readable, printable | `journal` (written in the same transaction), `exportJournal()` | core `T-B5-journal-every-doc`; golden `G-EJ-01`. The printable 58mm, 80mm and A4 layouts come in Phase 2. | partial |
| B6a | X reading: mid-shift, does not close the day | `xReading()` → ledger entry type X | core `T-B6-x-not-closing` | tested |
| B6b | Z reading: all §6 fields, Z counter that can never be reset | `zReading()` → ledger entry type Z, `summarize()`, verify-before-Z | prop `P-B6-z-reconciles-ledger`; core `T-B6-...z-counter-monotonic`; golden `G-Z-01` | tested |
| B7 | Backend reports and special discount books | Phase 4 (reads `body` through `json_each`) | n/a | planned |
| B8 | Sequential numbering: 6+ digits, per terminal, gapless, reset counter, separate series | `doc_series`, `nextNumber()`, `UNIQUE(doc_type, series_reset, doc_no)`, trigger `doc_series_forward_only` | prop `P-B8-gapless`; dur `P-B8-gapless-under-concurrency` (3 processes), `C-B8-gapless-after-crash`; core `T-B8-separate-series`, `T-B8-series-rollover` | tested |
| B9 | Reprint marked and logged | Phase 2 | n/a | planned |
| B10 | Push functionality | `outbox` exists; export and transport come in Phase 4 | n/a | planned (Q4) |
| B11 | Validation seal (QR) | Phase 2 | n/a | planned |
| B12 | Data retention; client can export any time; no lock-in | append-only triggers mean nothing in the core can purge tax records; `exportJournal()`; the backup is a plain SQLite file once decrypted | core `T-B2-...` (no deletes). The full export comes in Phase 4. | partial (Q5) |
| B13 | Monthly eSales; EIS-ready data model | Phase 4 | n/a | planned |

## C. Invoice content

Phase 2 builds the invoice engine. Phase 1 already covers:

| ID | Requirement | Where | Test(s) | Status |
|---|---|---|---|---|
| C2 | "Invoice", never "Official Receipt" | `renderPlain()` | core `T-B5-supplementary-footer` | partial |
| C5 | Lines: quantity, description, unit cost, total | `priceSale()`, journal | golden `G-EJ-01` | partial |
| C6 | VAT amount; VATable, exempt and zero-rated shown separately | `priceSale()`, `splitByClass()` | core `totals: extracts 12% VAT…`; prop `P-B6` (the split always sums to net) | partial |
| C7 / C8 | Non-VAT (percentage tax) and exempt sellers | `vat_mode` NONVAT and EXEMPT | core `totals: non-VAT and exempt sellers` | partial |
| C19 | Supplementary footer on reversal documents | `renderPlain()` | core `T-B5-supplementary-footer` | partial |
| (rates) | VAT rate is effective-dated data, not a constant | `rule_set`, `addRule()`, `rule()` | core `totals: VAT rate comes from effective-dated rules` | tested |
| C1, C3, C4, C9–C18, C20 | Header, buyer, special discounts, footer, manual invoice | Phase 2 | n/a | planned |

## D. Testing obligations (brief §Testing)

| ID | Obligation | Test(s) | Status |
|---|---|---|---|
| D1 | Grand total never decreases | prop `P-B1-gt-monotonic` | tested |
| D2 | No numbering gaps under concurrency or crashes | prop `P-B8`, dur `P-B8-gapless-under-concurrency`, dur `C-B8-gapless-after-crash` | tested |
| D3 | Reversals always reference originals | prop `P-B2-reversal-refs-original` | tested |
| D4 | Z totals reconcile with the ledger | prop `P-B6-z-reconciles-ledger` (independent re-summing) | tested |
| D5 | Crash and power-loss simulation | dur `C-B4-*` (SIGKILL; a true power cut relies on SQLite's documented WAL + FULL fsync guarantees) | tested |
| D6 | Offline then sync, multiple terminals | Phase 3 | planned |
| D7 | Golden files for printed layouts | golden `G-EJ-01` (Phase 1 plain journal); invoice layouts come in Phase 2 | partial |

## Phase 1 findings worth showing the TWG

- The concurrency test found a real bug: `verifyAll` read the ledger and the accumulators in separate statements, so it raised a false integrity break while another process was writing. It now reads one SQLite snapshot. The test stays in as a regression guard.
- Clock control: issuing is refused when the device clock is more than 5 seconds behind the last document (`CLOCK_BEHIND`, logged). Smaller drift is allowed and logged as `CLOCK_ANOMALY`.
