# Automatic Transaction Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically categorize and import clear Plaid purchases and reconcile unique offer credits while preserving uncertain items for review.

**Architecture:** Extract merchant classification and import confirmation into shared services. A server-side credit service persists earned-month and purchase evidence under a per-cardholder lock. Invoke automatic review after committed Plaid syncs and relevant manual changes; the dashboard displays decisions without assigning credits itself.

**Tech Stack:** Existing Node.js >=18, CommonJS/browser UMD JavaScript, Express, PostgreSQL, node:test. No new production dependencies or AI service.

**Spec:** `docs/superpowers/specs/2026-10-29-automatic-transaction-review-design.md`

## Global Constraints

- Use only confirmed offers for automatic credit assignment. Draft and rejected offers cannot receive automatic credits.
- Preserve bank descriptions, provider identifiers, dates, amounts, and existing manual corrections.
- Pending, removed, ignored, invalid, ambiguous, and conflicted records are ineligible for automatic import.
- A backdated posting date must not override earned-month evidence.
- Keep the existing two-cent matching tolerance, but never use that tolerance to exceed a reward cap or remaining reward budget.
- No new AI service, automatic offer creation, bank transactions, historical data deletion, or changes to offer terms.
- CSV files retain their explicit upload and confirmation step.
- Do not commit personal transaction data; use synthetic regression fixtures.

## Review Focus

- Same-amount purchases and overlapping daily/individual payouts must not spend one offer's reward twice (Task 2).
- Legacy credits without reliable month/evidence must not free up already-paid rewards (Task 2).
- An automation failure after a successful bank sync must preserve the committed cursor and remain retryable (Task 4).
- Manual edits and automatic review racing must preserve the manual decision and avoid duplicate records (Task 3).
- A mistaken learned rule or later offer/category edit must surface stale credit evidence rather than silently rewrite financial history (Tasks 1 and 5).

---

### Task 1: Shared merchant classification

**Files:** Create `merchant-classifier.js`, `test/merchant-classifier.test.js`; modify `server.js`, `migrations.sql`.

**Interfaces:** Export `classifyMerchant(rawMerchant, rules) -> { merchant, categories, matchedRuleId, source, reason, confident }`, accepting API or database rule field names. Server previews and automatic review use this exact result. Export built-in rules from this module rather than copy them.

- [ ] Write failing tests named `saved rules override defaults`, `conflicting equally specific rules need review`, `unknown merchants remain unknown`, and `home improvement retains its exclusion`.
  Assertions: a saved Target rule can return `['retail', 'online']`; two equally specific conflicting rules return `confident === false`; an unknown shop has `categories: []`; Home Depot includes `home-improvement`.
- [ ] Run `node --test test/merchant-classifier.test.js`; confirm failures are missing implementation.
- [ ] Implement normalization, most-specific saved-rule selection, exact-match precedence at equal specificity, explicit conflict detection, and existing built-in rules with the Home Depot correction. Do not infer categories from offer profitability.
- [ ] Replace classifier duplication in both preview routes. Add an idempotent migration updating only the known legacy Home Depot rule whose categories are still exactly the old retail-only mapping; preserve unrelated overrides and existing transactions.
- [ ] Run classifier tests and existing `test/import-review.test.js`, `test/plaid-ui.test.js`, `test/purchase-reconciliation.test.js`.
- [ ] Commit the tested shared classifier and regression tests.

### Task 2: Period-aware credit evidence planner

**Files:** Modify `credit-matcher.js`, `test/credit-matcher.test.js`, `test/monthly-dashboard.test.js`; create `test/credit-evidence.test.js`.

**Interfaces:** Keep existing exported helper names compatible with dashboard callers. Extend `findCreditMatch(event, candidates, { events = [] } = {})` to return existing fields plus `rewardMonth` and `evidence` for a confident match. Evidence is versioned JSON: `{ version: 1, kind, rewardMonth, transactionIds, allocations, checkpointTransactionId, creditedAmount, reasons }`. Percentage allocations use `{ transactionId, amount }`; fixed/tiered evidence uses a period/checkpoint budget with no arbitrary per-purchase dollar allocation. Candidates contain normalized `offer` and engine-calculated `progress`.

- [ ] Add failing synthetic tests for an October $4.50 credit labeled `10/01/26 - 10/31/26`, posted in September, supported by October $75/$15 Target purchases.
  Assert unique match, October earned month, both supporting IDs, and total allocations of $4.50.
- [ ] Add failing tests asserting no match for competing offers/months, invalid or conflicting month ranges, duplicate-looking events (including an assigned twin), draft/rejected offers, non-finite/zero amounts, and payments/refunds/interest/fees.
- [ ] Add failing tests asserting a $3 and $2 purchase payout exhausts a $5 daily payout; conversely a paid $5 day exhausts both component purchases. Two indistinguishable allocations remain ambiguous.
- [ ] Add failing tests for capped percentage rewards, incremental threshold credits, historical credits without evidence/months, and $80 already paid at a $1,000 tier leaving only $80 after the $2,000/$160 tier.
  Assert allocation totals never exceed earned reward or cap, including at the two-cent tolerance boundary.
- [ ] Run `node --test test/credit-matcher.test.js test/credit-evidence.test.js`; confirm intended failures.
- [ ] Implement period inference and candidate evidence using `OfferEngine` reward calculations. Enforce period outstanding budget, consume overlapping purchase/day evidence, and reserve uncertain historical evidence conservatively. Do not use configured caps or amount equality alone as proof.
- [ ] Preserve existing checkpoint presentation helpers; update regression expectations only where the approved stricter matching intentionally changes assignment behavior.
- [ ] Run the three credit/monthly test files and `test/offer-engine.test.js`; commit when passing.

### Task 3: Shared import and credit persistence services

**Files:** Create `transaction-import-service.js`, `credit-review-service.js`, `test/transaction-import-service.test.js`, `test/credit-review-db.test.js`; modify `server.js`, `migrations.sql`, existing import/credit integration tests as necessary.

**Interfaces:**

- `createCreditReviewService({ serializeOffer }) -> { reviewCredits(client, personId), flagInvalidEvidence(client, personId), assignManually(client, { personId, eventId, offerId }) }`.
- `createTransactionImportService({ pool, creditReview }) -> { importReviewed(input, { automatic = false } = {}), importInTransaction(client, input, { automatic = false } = {}) }`.
- `input` retains the existing confirmation body `{ personId, transactions, accountEvents, importMetadata }`; return existing import response fields plus `remainingReviewCount` and review explanations.
- All modifying entry points acquire `SELECT pg_advisory_xact_lock(72601, $1)` for the cardholder before row locks. `importInTransaction` and credit methods require the caller to hold that lock; public wrappers own BEGIN/COMMIT/ROLLBACK.

- [ ] Write failing integration tests for existing CSV/Plaid imports, cross-source links, repeated identical legitimate purchases, stale previews, selected-account/environment/generation/cutoff scope, and rollback.
- [ ] Write failing tests for repeated and concurrent manual/automatic processing: one provider item produces one imported record, one event receives one credit, and combined allocations do not exceed one earned budget. Include a manual category edit racing the automatic worker.
- [ ] Write failing tests for persistent evidence/month/reasons and conservative handling of repeated legacy account events. Verify raw descriptions, amounts, existing manual categories, and original dates remain intact.
- [ ] Run the new tests against a PostgreSQL-compatible isolated database; ensure the integration suite actually runs rather than skips. Use an existing `PGLITE_TEST_MODULE` if available; otherwise use local PostgreSQL or install a test-only PGlite package outside the repository with the required network approval.
- [ ] Extract confirmation logic without changing hash, source occurrence, provider lifecycle, cross-source reconciliation, or stale-preview safeguards. Apply the shared classifier only for the automatic path; manual reviewed categories stay authoritative.
- [ ] Add additive `review_metadata JSONB` on transactions, `match_evidence JSONB` on offer credits, and `review_reason TEXT` on account events. Store assignment method inside evidence. Add a unique partial index on `account_events.assigned_offer_credit_id` only after testing for existing conflicting links; if conflicts exist, preserve them for review and enforce assignment by locked service logic rather than deleting data.
- [ ] Route confirmation, auto-match, and manual assignment through the services. Persist evidence and assignment atomically; repeated legacy events are flagged rather than deleted. Lock transaction/category and offer-edit paths consistently before writes.
- [ ] Run import, reconciliation, earned-month, and new persistence/concurrency tests; commit when passing.

### Task 4: Automatic review after committed syncs

**Files:** Create `transaction-review-service.js`, `test/transaction-review.test.js`; modify `plaid-sync.js`, `server.js`, `test/plaid-sync.test.js`, `.env.example`, `docker-compose.yml`.

**Interfaces:** `createTransactionReviewService({ pool, importService, creditReview, enabled }) -> { reviewPerson(personId, { connectionId = null } = {}) }` returns `{ imported, creditsMatched, remainingReviewCount, reasons }`. Extend `createSyncService` with optional `afterSync` callback invoked after committed sync, outside provider retry logic. Return review result or a separate `reviewError` without altering provider sync success.

- [ ] Write failing tests that known posted purchases import after both scheduled and manual sync, unknown/conflicting merchants remain queued, and the correct cardholder/account/environment/current generation/import-start boundary is enforced.
- [ ] Add failure/retry tests: afterSync failure preserves committed cursor and provider success; the next run can process the existing queue even when the provider returns no additions. Repeated retries are idempotent.
- [ ] Add a configuration test: `TRANSACTION_AUTO_REVIEW=false` skips automatic import, while the default enables it. CSV confirmation remains explicit.
- [ ] Run new automation and existing sync/scheduler tests; confirm expected failures.
- [ ] Implement queue selection and classification under the shared cardholder lock, then call `importInTransaction` and credit review. Record recognized account events separately; leave unsupported types queued. Wire the callback in server startup with default enabled configuration and an explicit Docker environment passthrough.
- [ ] Run the automation, sync, scheduler, import, and credit tests; commit when passing.

### Task 5: Retry triggers and visible review outcomes

**Files:** Modify `server.js`, `database.js`, `app.js`, `plaid-ui.js`, `index.html`, relevant existing stylesheet; create `test/automatic-review-ui.test.js`; extend `test/plaid-ui.test.js`.

**Interfaces:** Add `POST /api/transactions/review` with `{ personId }` calling `reviewPerson`; add `DatabaseManager.reviewTransactions()`. Preview/account-event responses include saved review reasons; transaction/offer-credit serialization includes evidence metadata. The manual assignment API remains available and records manual provenance. Existing earned-month edits persist and invalidate inconsistent evidence.

- [ ] Write failing UI/route tests that dashboard rendering never assigns credits, automatic outcome counts are shown, uncertain/duplicate-looking cases display escaped reasons, and manual corrections remain available.
- [ ] Add tests that category corrections, Remember rules, confirmed offer changes, and explicit review retry invoke server review for that cardholder. Category/offer/month changes flag invalidated credit evidence without changing the posted amount or silently moving the credit.
- [ ] Run these tests; confirm intended failures.
- [ ] Remove the browser matching-and-assignment loop from `renderDashboard`. Display server evidence/reasons and sync review summaries in the existing Transactions/account-events/credit sections. Add a retry-review action and keep dashboard rendering read-only.
- [ ] Wire post-change retries after committed manual imports, category/rule edits, and confirmed offer changes. Respect the disable switch for automatic imports while retaining manual credit review capability.
- [ ] Run UI tests and the credit/import/automation suites; inspect a local browser with synthetic fixtures for counts, explanations, category correction, and review persistence; commit when passing.

### Task 6: Whole-feature verification and operating instructions

**Files:** Modify `README.md`, `ARCHITECTURE.md`, `docs/PLAID-OPERATIONS.md`; add `docs/AUTOMATIC-REVIEW.md` if the operating instructions need a standalone home.

- [ ] Document default behavior, `TRANSACTION_AUTO_REVIEW=false`, saved-rule learning, conservative historical-credit treatment, failure/retry behavior, and manual investigation of uncertain merchants or duplicate credits.
- [ ] Run `npm test` plus the full PostgreSQL-compatible integration suite with its test module configured; report exact passes/failures/skips. Run `git diff --check` and `node --check` on changed JavaScript.
- [ ] Request an independent whole-change review against the approved spec, including all five Review Focus cases. Resolve material findings and rerun affected tests.
- [ ] Verify locally that two runs on the same synthetic staged records create no extra purchases, events, credits, or allocations and that disabling automation restores manual imports.
- [ ] Commit tested code/docs on the isolated feature branch. Keep deployment separate from local implementation: establish access and migration safety before changing the NAS. Never run the repository's historical clean-reset migration on an unverified live database.
- [ ] Deliver the changes, test evidence, unresolved user-owned merchant/duplicate questions, and exact deployment status. If deployment is authorized and access is available, deploy and verify live API/UI behavior before claiming automation is running.

## Plan self-review

The six tasks cover the approved classifier, learning, scope filters, post-sync/manual retry triggers, earned-month evidence, percentage and tier budgets, duplicate handling, persistence, concurrency, read-only dashboard, failure recovery, and operations. Task interfaces use one import service and one lock ordering. Each Review Focus item has an owning regression test above. Remaining implementation choices are module internals and UI styling, as allowed by the spec.
