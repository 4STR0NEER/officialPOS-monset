# Open Questions

These go to our CPA and the BIR RDO. Each one records an **owner**, a **status** and a **default** (what we build until we have an answer). Defaults are chosen so they can be reversed without a schema change.

Status: `open` · `asked (date, who)` · `answered (date, ref)`

---

## Regulatory (BIR / RDO)

**Q1. Is a tier change by license a "change of parameter settings"?** · open · Owner: Monset → RDO
Default: tiers only toggle business-module features and the core stays identical (ARCHITECTURE §12). If BIR says yes, we would notify BIR of each tier change, or accredit only "Premium" and treat the lower tiers as the same accredited software with features hidden.

**Q2. Does an update to a business module (payroll tables, forecasting) or to a rule pack (VAT or discount rates) count as an enhancement of the accredited version?** · open · Owner: Monset → RDO
Default: modules and rule packs are versioned and signed separately from the core hash. Tax and discount rule packs that affect invoices are treated as needing BIR notice until we are told otherwise.

**Q3. Does a PWA with per-client local storage and optional per-client encrypted cloud backup stay outside RMC 110-2026 (the ESP rules)?** · open · Owner: Monset → RDO + CPA
Default: no Monset-operated system of record, and backups are client-owned and non-authoritative. The verify page holds no data.
**Q3a.** Is a PWA-only install acceptable (an iPad with no hub, where browser storage can be evicted)? Default: allowed only once `navigator.storage.persist()` is granted, otherwise the hub or the Android app is required. **Technical risk:** iOS Safari's handling of OPFS persistence.

**Q4. What exactly is "push functionality"?** · open · Owner: RDO
Default: an on-demand export of the sales data since a cursor, through a pluggable transport (manual file now, EIS API later).

**Q5. What is the current data retention period?** · open · Owner: CPA
Our understanding is that the EOPT Act amended NIRC Sec. 235 to **5 years**, and that RR 17-2013 had set 10 years. We need to confirm this for electronic records and e-journals. Default: retain everything indefinitely, never purge tax records, and set the retention setting to apply to CRM personal data only.

**Q6. Does the client's registration produce a PTU or an Acknowledgement Certificate (AC), and which number prints?** · open · Owner: RDO
Default: a configurable label (`PTU No.` or `AC No.`) plus the number and date of issue.

**Q7. Does the current Annex F (the Functional and Technical Evaluation Checklist) add requirements?** · waiting on the user to get it from the RDO
Action: put it in `docs/annex-f/` and cross-map every line into the compliance matrix.

**Q8. Monset's supplier details for the footer.** · open · Owner: Monset
Monset's registered legal entity name (DTI or SEC), address, and TIN with branch code, and whether "Monset.co" is the registered name. Default: placeholders marked `[TO BE ISSUED]` on every sample document. **Never fabricate these.**

**Q9. Is the accumulated grand total gross (before voids and returns) or net?** · open · Owner: CPA / RDO
Default: gross and monotonic, with voids, returns and refunds kept in separate accumulators. Readings show both.

**Q10. Group meal discount formula.** · open · Owner: CPA
We need to confirm the current DOF, DTI and DOH guidance on pro-rata sharing when the senior's or PWD's own portion can't be identified, and how this interacts with service charge. Default: two methods, configurable (identified items, or total ÷ number of diners).

**Q11. Validation seal expectations.** · open · Owner: RDO
Is a signed QR that verifies offline (proving authenticity, not ledger presence) enough, or does BIR expect a lookup service? Default: signed QR only (ARCHITECTURE §9).

**Q12. Special discount rates and scope.** · open · Owner: CPA
The brief says "5% or 20%". Our understanding: SC and PWD get 20% plus VAT exemption on qualifying goods and services, and 5% on basic necessities and prime commodities (capped). NAAC gets 20% plus VAT exemption. Solo Parent under RA 11861 gets 10% plus VAT exemption on specific items, with eligibility conditions. All of this is configurable data. Confirm the current rates, caps and item categories.

**Q13. Do RR 8-2023 (online transactions need no signature) and FDA Circular 2025-005 (no purchase booklet) still apply as cited?** · open · Owner: CPA

**Q14. RMC 110-2026.** · open · Owner: CPA
The brief says it took effect on 2026-10-13. Get the full text and confirm the single-taxpayer exclusion wording, which exists only in the brief so far.

**Q15. Language on invoices.** · open · Owner: RDO
Is Filipino allowed on printed invoices, or English only? Default: the UI is in Filipino and English, and documents are in English.

**Q16. Reading and Z-counter rules for a terminal replaced after a hardware failure.** · open · Owner: RDO
Does the new device keep the old MIN's series (our restore preserves it), or does it need a new MIN? Default: the restore preserves the series, and the RDO is notified.

**Q17. Mode upgrade path.** · open · Owner: RDO
When a NON_INVOICING (Special Purpose Machine) install upgrades to LIVE, does that count as a new registration? Default: yes. The install starts a fresh database, and the device gets a MIN and a PTU.

## Product and technical

**Q18. Payment providers for phase 3.** · open · Owner: user
Which comes first: PayMongo (already used on Monset projects), GCash or Maya directly, or a card terminal brand?

**Q19. Printer hardware for the BIR demo.** · open · Owner: user
Which 58mm and 80mm ESC/POS models will we demo on? Golden files are byte-exact, so pin the printers early.

**Q20. Accreditation demo hardware.** · open · Owner: user
Which tablet model and which hub mini PC? These determine the device serial format on invoices.

## Raised in Phase 1

**Q21. Clock tolerance.** · open · Owner: RDO
The terminal refuses to issue when its clock is more than 5 seconds behind the last document, and logs smaller drift. Does BIR prescribe a tolerance or an approved time source (for example PAGASA or NTP)? Default: 5 seconds, configurable.

**Q22. VAT mode change mid-day.** · open · Owner: CPA
When a client becomes VAT-registered, should the switch be allowed only right after a Z reading? Default: the change is allowed and logged with before and after values. Phase 2 will require a Z reading first.

**Q23. Rounding on partial refunds.** · open · Owner: CPA
Partial refunds are prorated cumulatively, so the last one lands exactly on the original amount. In rare rounding cases up to 1 centavo of line discount can stay unreversed. Is that acceptable, or should the final refund always clear the remainder?
