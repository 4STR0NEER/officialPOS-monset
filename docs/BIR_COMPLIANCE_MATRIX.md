# BIR Compliance Matrix

This file is the accreditation evidence pack. Each requirement maps to its module, table, function and test.

Status key: `planned` → `built` → `tested` → `demo-ready`. Test IDs are reserved now, and Phase N adds the test files at the paths shown. CI fails if any row is missing a test.

Compliance core version under evaluation: **`core 0.0.0` (unreleased)**

Sources are as cited in the kickoff brief and **still to be verified** (see OPEN_QUESTIONS.md). Annex F (the Functional and Technical Evaluation Checklist) will be cross-mapped once the RDO supplies it (Q7).

---

## A. Architectural constraints

| ID | Requirement | Source | Module | Table(s) | Function(s) | Test(s) | Phase | Status |
|---|---|---|---|---|---|---|---|---|
| A1 | Single-taxpayer infrastructure: no shared Monset system of record | RMC 110-2026 | whole system, `apps/hub` | n/a | no network client to any Monset backend exists in `core` | `T-A1-no-remote-sor` (static: core has no fetch or URL to a Monset host) | 1 | planned |
| A2 | Offline first; offline audit flags on every transaction | Brief §2, BIR offline controls | `core/ledger` | `ledger_entry.created_offline, device_id, issued_at, synced_at` | `postSale()` | `T-A2-offline-flags`, `T-SYNC-01..03` | 1, 3 | planned |
| A3 | The compliance core version is pinned, printed, and never updated silently | Brief §3 | `core`, `apps/pos/sw` | n/a | `verifyCoreManifest()`, SW without `skipWaiting` | `T-A3-manifest-mismatch-locks`, `T-A3-sw-no-autoupdate` | 1, 5 | planned |
| A4 | Tier gating only through the license; compliance is never gated | Brief §4 | `core/license`, `apps/pos` | n/a | `hasFeature()` (UI and modules only) | `T-A4-core-never-reads-tier` (static), `T-A4-all-live-tiers-same-core` | 5 | planned |
| A5 | Non-invoicing mode never prints an invoice, and its slips carry the supplementary footer | RMO 24-2023 (SPM) | `core/documents` | `doc_series` | `issueDocument()` refuses INVOICE when `mode=NON_INVOICING` | `T-A5-nonInvoicing-blocks-invoice`, `T-A5-slip-footer` | 2, 5 | planned |
| A6 | A unique Software License Number for each install, printed on invoices | RMO 24-2023 (cloned machines) | `core/license` | `terminal.sln` | `parseLicense()`, invoice header | `T-A6-sln-unique-format`, `G-INV-*` | 5 | planned |
| A7 | No training mode and no no-sale mode; demo installs are watermarked and cannot be converted | RR 11-2004 | `core/license`, `core/documents` | `terminal` | mode fixed at install; `renderWatermark()` | `T-A7-no-mode-switch-api`, `T-A7-demo-watermark`, `T-A7-demo-to-live-requires-reset` | 5 | planned |

## B. Compliance core: RMO 24-2023, Section IV(5)

| ID | Requirement | Module | Table(s) | Function(s) | Test(s) | Phase | Status |
|---|---|---|---|---|---|---|---|
| B1 | Accumulated Grand Total: at least 12 digits plus 2 decimals, never reset or reduced; rolls over and increments the reset counter | `core/readings` | `accumulator.grand_total, reset_counter` | `applyToAccumulators()` | `P-B1-gt-monotonic` (property), `T-B1-rollover-increments-reset` | 1 | planned |
| B2 | Tamper free: append-only ledger, reversals only, integrity breaks detected | `core/ledger` | `ledger_*` (triggers) | `postReversal()`, `verifyChain()` | `T-B2-update-trigger-aborts`, `T-B2-delete-trigger-aborts`, `T-B2-chain-detects-edit`, `P-B2-reversal-refs-original` | 1 | planned |
| B3 | Activity log: create, edit or delete attempts, export, print, reprint, transmit, login, permission and settings changes, each with user, device, time and before/after values | `core/activity` | `activity_log` | `logActivity()` | `T-B3-each-action-logged`, `T-B3-log-chain` | 1 | planned |
| B4 | Non-volatile memory: no sale lost on a crash; backup and restore keep numbering and the grand total | `core/store`, `storage-*` | all | `postSale()` (commit before confirm), `backup()`, `restore()` | `C-B4-kill-during-post` (crash), `T-B4-restore-preserves-seq-gt`, `T-B4-restore-refuses-rewind` | 1 | planned |
| B5 | Electronic journal: complete, exportable, human readable, printable | `core/journal` | `journal` | `exportJournal(range, fmt)` | `T-B5-journal-every-doc`, `G-EJ-01` | 1, 2 | planned |
| B6a | X reading: mid-shift, does not close the day | `core/readings` | `reading` | `xReading()` | `T-B6-x-not-closing`, `G-X-01` | 1 | planned |
| B6b | Z reading: every field in §6, Z counter that can never be reset | `core/readings` | `reading`, `accumulator.z_counter` | `zReading()` | `P-B6-z-reconciles-ledger`, `T-B6-z-counter-monotonic`, `G-Z-01` | 1 | planned |
| B7 | Backend reports: sales book, a separate book per special discount type (SC, PWD, NAAC, Solo Parent), and void, refund, return and discount reports, all exportable | `core/reports` | read-only views | `salesBook()`, `discountBook(type)`, `voidReport()`… | `T-B7-books-reconcile`, `G-RPT-*` | 4 | planned |
| B8 | Sequential numbering: at least 6 digits, per terminal, no gaps, reset counter; invoice series separate from transaction and order series; supplementary documents in their own series | `core/numbering` | `doc_series` | `allocateNumber()` | `P-B8-gapless-under-interleaving`, `C-B8-gapless-after-crash`, `T-B8-separate-series` | 1 | planned |
| B9 | Reprint marked as such, and logged | `core/documents` | `reprint` | `reprint(entryId)` | `T-B9-reprint-banner`, `T-B9-reprint-logged` | 2 | planned |
| B10 | Push functionality (on-demand sales data push) | `core/reports` | `outbox` | `exportSalesSince(cursor)`, `PushTransport` | `T-B10-push-export-shape` | 4 | planned (Q4) |
| B11 | Validation seal: QR that verifies offline without a shared database | `core/seal`, `apps/verify` | n/a | `signInvoice()`, `verifySeal()` | `T-B11-seal-roundtrip`, `T-B11-tamper-fails`, `T-B11-qr-fits-58mm` | 2 | planned |
| B12 | Data retention for the legal period; client can export any time; no lock-in | `core/store`, `core/journal` | all | `exportAll()` (SQLite + CSV) | `T-B12-full-export`, `T-B12-no-purge-of-tax-records` | 4 | planned (Q5) |
| B13 | Monthly eSales; data model ready for EIS JSON | `core/reports` | `ledger_*` | `eSalesMonthly()`, `toEisInvoice()` (mapping only) | `T-B13-esales-reconciles`, `T-B13-eis-fields-complete` | 4 | planned |

## C. Invoice content

| ID | Requirement | Module / function | Test(s) | Phase | Status |
|---|---|---|---|---|---|
| C1 | Header: registered name, business name or style, address, "VAT REG TIN" or "NON VAT REG TIN" with 9-digit TIN and 5-digit branch, MIN, SLN, serial | `core/documents.renderHeader()` | `T-C1-tin-format`, `G-INV-VAT`, `G-INV-NONVAT` | 2 | planned |
| C2 | The word "Invoice", never "Official Receipt" | `renderBody()` | `T-C2-no-official-receipt` (scans every golden file) | 2 | planned |
| C3 | Invoice number, date and time | `renderBody()` | `G-INV-*` | 2 | planned |
| C4 | Buyer name, address, TIN and business style (required for VAT buyers) | `validateBuyer()` | `T-C4-vat-buyer-required` | 2 | planned |
| C5 | Lines: quantity, description, unit cost, line total | `renderLines()` | `G-INV-*` | 2 | planned |
| C6 | VAT amount; mixed VATable, exempt and zero-rated shown separately | `core/totals.computeTotals()` | `P-C6-split-sums`, `G-INV-MIXED` | 2 | planned |
| C7 | Non-VAT seller: sales subject to percentage tax vs exempt sales | `computeTotals()`, `vat_mode=NONVAT` | `G-INV-NONVAT` | 2 | planned |
| C8 | "EXEMPT" printed prominently for exempt sellers | `renderBody()` | `G-INV-EXEMPT` | 2 | planned |
| C9 | Special discount types driven by data (SC, PWD, NAAC, Solo Parent) | `rule_set(kind=DISCOUNT_TYPE)` | `T-C9-new-type-via-config` | 2 | planned |
| C10 | Capture name, ID number, TIN, rate, VAT-exemption breakdown and signature line | `ledger_special_discount`, `renderDiscountBlock()` | `G-INV-SC`, `G-INV-PWD`, `G-INV-NAAC`, `G-INV-SOLO` | 2 | planned |
| C11 | No signature line for online or app transactions; ID, TIN and breakdown still required | `channel=ONLINE` | `T-C11-online-no-sig` | 2 | planned |
| C12 | Digital National Senior Citizen ID accepted | ID-type list in the rule set | `T-C12-digital-id` | 2 | planned |
| C13 | No purchase booklet required for medicine | rule set | `T-C13-no-booklet` | 2 | planned |
| C14 | Computation order: remove VAT, then discount | `computeTotals()` | `T-C14-order-of-ops` (worked examples), `P-C14-bounds` | 2 | planned |
| C15 | F&B group meal with a partial senior or PWD share | `allocateSpecialDiscount()` | `T-C15-group-prorata`, `T-C15-identified-items` | 2 | planned |
| C16 | No double discounting (promo plus special) | `applyStacking()` | `P-C16-no-double` | 2, 9 | planned |
| C17 | Footer: Monset name, address, TIN with branch, accreditation number, date issued and valid until | `renderFooter()` + `supplier.json` | `G-INV-*` | 2 | planned (Q8) |
| C18 | Footer: client PTU or Acknowledgement Certificate number and date | `terminal.ptu_no` | `G-INV-*` | 2 | planned (Q6) |
| C19 | Supplementary documents carry the bold footer "THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX." | `renderFooter(supplementary)` | `T-C19-footer-on-all-supp` | 2 | planned |
| C20 | Manual invoice fallback: record it, link it, adjust eSales | `core/ledger.recordManualInvoice()` | `T-C20-manual-link`, `T-C20-esales-adjust` | 2, 4 | planned |

## D. Testing obligations (brief §Testing)

| ID | Obligation | Test(s) |
|---|---|---|
| D1 | Grand total never decreases | `P-B1-gt-monotonic` |
| D2 | No numbering gaps under concurrency or crashes | `P-B8-gapless-under-interleaving`, `C-B8-gapless-after-crash` |
| D3 | Reversals always reference originals | `P-B2-reversal-refs-original` |
| D4 | Z totals reconcile with the ledger | `P-B6-z-reconciles-ledger` |
| D5 | Crash and power-loss simulation | `C-B4-*`, `C-B8-*` |
| D6 | Offline then sync, multiple terminals | `T-SYNC-01` (replica equals source), `T-SYNC-02` (gap rejected), `T-SYNC-03` (bad hash rejected) |
| D7 | Golden files for printed layouts | `G-*` at 32 and 48 columns plus A4 |

Test ID prefixes: `T-` unit, `P-` property (fast-check), `C-` crash (child-process SIGKILL), `G-` golden file.
