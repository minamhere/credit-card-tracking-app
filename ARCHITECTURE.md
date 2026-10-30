# Credit Card Offer Tracker Architecture

## Core principles

- PostgreSQL is the system of record; the browser does not own financial calculations.
- Raw imported values are preserved separately from normalized merchant names and categories.
- Every offer and transaction belongs to one card holder (`person_id`). Merchant classification rules are global because merchant coding does not change between cardholders.
- Offer eligibility, measurement, rewards, and posted credits are independent concepts.
- A transaction may qualify for any number of offers.
- Imported or email-derived offers can enter as drafts and require review before affecting the dashboard.

## Offer rules engine

Each offer has three versioned JSON configurations:

- `eligibility`: transaction types, included/excluded categories and merchants, and amount limits.
- `measurement`: spend or transaction count, measured over the entire offer or per calendar month.
- `reward_config`: percentage with activation threshold/cap, fixed threshold reward, or fixed tiers.

Actual statement credits are rows in `offer_credits`. They are not mixed with expected rewards. The dashboard can therefore display expected, posted, and outstanding amounts independently.

Legacy offer columns remain during migration and are translated by `offer-engine.js`. New and edited offers persist the normalized rule configuration.

## Transaction imports

An import preserves the original Citi merchant string, transaction type, source, and stable duplicate fingerprint. The normalized merchant and category assignments drive offer eligibility. Merchant rules are shared by every card holder and can be corrected without changing the raw source.

## Automatic review and evidence

`merchant-classifier.js` is shared by previews and automatic processing. `transaction-import-service.js` preserves hashes, raw source, lifecycle checks, and cross-source reconciliation for both manual and automatic imports. `transaction-review-service.js` selects only eligible current-account/current-generation rows after a committed Plaid sync.

`credit-matcher.js` plans period-aware assignments; `credit-review-service.js` persists their earned month and versioned JSON evidence. Percentage allocations share purchase/day budgets; fixed and tiered rewards use period/checkpoint budgets. Unknown legacy evidence is reserved conservatively. `reviewed-edit-service.js` preserves manual corrections and flags affected historical evidence before retrying queued review.

All import/assignment/edit services serialize financial changes using `review-lock.js` and PostgreSQL transaction advisory lock `(72601, personId)` before row locks. Automatic-review failures are separate from successful provider syncs. The browser reads decisions and explanations; rendering the dashboard does not assign credits. See [Automatic review operations](docs/AUTOMATIC-REVIEW.md).

## Future Microsoft 365 ingestion

Microsoft Graph OAuth should be implemented as a server-side integration with the minimum mail permissions required. Refresh tokens must be encrypted and must never reach the browser.

The ingestion pipeline should:

1. Store the Graph message ID and source metadata.
2. Parse the offer into a structured draft associated with a card holder.
3. Use configurable routing rules to distinguish the mailbox owner from forwarded offers belonging to another card holder.
4. Deduplicate using the Graph message ID and a normalized offer fingerprint.
5. Require confirmation when card holder, dates, categories, thresholds, or reward terms are uncertain.
6. Promote the draft to `confirmed` only after review; only confirmed offers affect progress.

Forwarding headers and sender identity are evidence for routing, not authentication. The UI must show why an offer was assigned to a person and allow reassignment before confirmation.
