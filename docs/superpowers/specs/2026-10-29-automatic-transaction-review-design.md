# Automatic transaction review and credit reconciliation

## Intent and agreed behavior

The user wants current transactions reviewed first, then future transactions handled automatically using what the review taught us. They approved this behavior: remember merchant categories, apply them to future purchases, check credits against offer terms, purchases, and earned month, prevent reuse of reward evidence, and leave uncertain cases for review.

The current review imported 31 purchases, saved 18 additional merchant rules, matched a $4.50 credit to two October Target purchases, assigned earned months from statement descriptions, and corrected a Home Depot exclusion. Five purchases remain uncertain. Existing repeated credit records require investigation; this feature must not delete or silently reassign them.

## Approaches

1. **Saved rules and purchase evidence — selected by the user.** Extend the existing JavaScript/PostgreSQL application. Deterministic, explainable decisions, no new external service, and uncertainty remains visible.
2. **AI classification on every sync — considered but not selected.** Could suggest unfamiliar merchants, but introduces service configuration, recurring cost, and additional handling of transaction data.

## Scope and constraints

- Build on Express, PostgreSQL, the existing Plaid scheduler, CSV importer, offer engine, and shared merchant rules.
- Process only the selected account for the current cardholder, environment, and connection generation, within its existing import-start boundary.
- Pending, removed, ignored, invalid, ambiguous, and conflicted records are ineligible for automatic import.
- Preserve bank descriptions, provider identifiers, dates, amounts, and existing manual corrections. Merchant categories are classification evidence, not proof of bank merchant coding.
- Use only confirmed offers for automatic credit assignment. Draft and rejected offers cannot receive automatic credits.
- No new AI service, automatic offer creation, bank transactions, historical data deletion, or changes to offer terms.

## Merchant classification and learning

Extract one shared classifier for CSV previews, Plaid previews, and automatic review. Saved merchant rules take precedence over built-in suggestions. Prefer the most specific matching pattern; conflicting equally specific rules stay in review. Unknown merchants remain uncategorized.

An explicit correction saved with the existing Remember option teaches future imports. Merely importing a guess must not create a new trusted rule. Automatic imports use existing trusted rules without teaching themselves. Preserve multiple categories and exclusions; Home Depot must carry the home-improvement exclusion category as well as any broader retail category. Correct the known legacy Home Depot mapping without overwriting unrelated merchant rules or manual purchases.

## Processing flow

1. Plaid sync stages provider data and commits its cursor as today.
2. A server-side automatic-review service processes eligible queued rows after a successful manual or scheduled sync. Processing errors do not undo a successful provider sync; report the review failure separately and retry on the next run.
3. Recognized purchases are imported through the same shared import/reconciliation service used by manual confirmation. Unknown and ambiguous purchases remain in the queue.
4. Recognized account events are recorded separately from purchases. Payments, interest, fees, and refunds never become offer credits. Unrecognized event types stay in review.
5. After imports, retry unassigned possible offer credits against all currently available eligible purchases and confirmed offers for that cardholder. Also retry after a manual import, a saved merchant correction, or a confirmed offer change.
6. The dashboard displays server decisions and explanations. Remove its independent matching-and-assignment loop so simply viewing the dashboard cannot apply a second matching policy.

Automatic review is enabled by default for this requested behavior. Provide a documented server configuration switch to disable automatic imports and return to manual review while keeping saved classifications and history. CSV files retain their explicit upload and confirmation step; the same categorization and credit checks run during confirmation.

## Credit matching

Identify the earned month from an explicit rewardMonth or a valid, single-month date range in the bank description. A backdated posting date must not override this evidence. Without an explicit month, assign automatically only when purchase and reward evidence identifies exactly one possible offer and period. Conflicting, invalid, or multiple-month evidence stays in review.

For each candidate offer and period, use the existing offer engine to enforce dates, transaction types, included and excluded categories, minimum spend, activation thresholds, reward tiers, and caps. Match a unique supported payout: an individual purchase, a day of purchases, a cumulative threshold/checkpoint payout, or the remaining earned reward. Amount equality alone or resemblance to a configured cap is insufficient. Keep the existing two-cent matching tolerance, but never use that tolerance to exceed a reward cap or remaining reward budget.

Persist the matched earned month, explanation, supporting transaction IDs, and consumed reward budget. For percentage rewards, record reward amounts allocated to purchases, applying the offer's cap chronologically and its activation threshold before allocating. A transaction may support separate overlapping offers, but its reward budget within one offer and period cannot be spent twice. Consuming a daily payout also consumes its constituent purchase evidence, and consuming individual payouts reduces the day's remaining evidence. Incremental threshold payments may consume only the uncredited remainder. If different purchase allocations are plausible, leave the credit for manual review.

For fixed and tiered rewards, store period/checkpoint evidence rather than inventing a percentage allocation to purchases. Identify the chronological purchase that reaches the qualifying threshold and the supporting transaction IDs through that checkpoint; consume the reward increase in that offer/period's ledger. For example, after an $80 payment for the $1,000 tier, reaching a $160 total reward at $2,000 leaves at most $80 more payable. Reusing supporting purchases for the higher tier is allowed only to establish cumulative qualifying spend, never to pay the earlier tier again. This representation is a builder decision made during design review.

Historical credits without stored evidence still consume their period's posted reward budget. Reconstruct purchase allocations only when unambiguous. Otherwise conservatively reserve potentially used evidence and flag it rather than attaching another credit to it. Do not invent evidence for old credits.

Flag repeated account events with the same cardholder, bank description, posting date, and amount as possible duplicates before matching. Legitimate equal credits may exist, so flag rather than delete or silently combine them. Existing repeated assigned credits remain visible for manual investigation. Matching must check all relevant events, including previously assigned ones.

## Persistence and concurrency

Extract import and credit-assignment operations from route handlers into reusable server services; do not call the application's HTTP endpoints internally. Preserve the existing raw-source hashes, cross-source reconciliation, lifecycle checks, and stale-preview checks.

Use a transaction and a consistent per-cardholder lock for importing and assigning credits from both automatic and manual paths. Recheck lifecycle and assignments while holding the lock. Keep database uniqueness protections for provider identity, source hashes, external links, and account-event assignment. A repeated run or concurrent sync must produce no duplicate purchases, account events, credits, or reward allocations.

Add additive migrations for review provenance and credit evidence as needed. Store evidence in PostgreSQL, scoped to the offer, cardholder, and earned period. The builder may choose JSON metadata or normalized evidence rows, provided remaining allocated reward is checked under the same lock and survives restart.

## Review experience and operation

The Transactions section reports how many purchases were handled automatically, credits matched, and items still need review. Each automatic decision includes its merchant-rule or reward explanation. Keep the existing manual category correction and credit assignment flows available, with deliberate manual assignments identified separately from automatic ones.

Keep uncertain merchant rows, suspected duplicate credits, ambiguous offer/period matches, and provider conflicts visible with a reason. Changing a category does not automatically rewrite a previously assigned credit; flag invalidated evidence for review.

Document the configuration switch, retry behavior, deployment migration, and how to inspect unresolved items. Validate locally before deployment. Deployment access and procedure must be established separately; do not claim the running NAS has the new feature until it has actually been deployed and verified.

## Validation and acceptance

- A known merchant imports on manual and scheduled Plaid sync; an unfamiliar merchant remains queued.
- Learning a manually reviewed rule lets a later run process that merchant, without erasing a manual correction.
- Pending records, stale previews, conflicts, excluded accounts, other cardholders, environments, and generations cannot leak into automatic imports.
- The October $4.50 Target reward matches the two $75/$15 purchases and October despite its September posting date.
- Equal amounts in two offers or months, invalid month descriptions, draft offers, and duplicate-looking events remain unassigned.
- Single-purchase and daily payouts cannot reuse the same underlying reward; incremental percentage and threshold credits remain possible within caps.
- Historical credits, including ones without a month or evidence, cannot unlock duplicate payouts.
- Repeated runs, simultaneous automatic/manual processing, failures, and retries preserve amounts, identities, and uniqueness.
- Dashboard reads do not silently assign credits. Explanations and remaining review items are visible.
- Run relevant unit tests and PostgreSQL-compatible integration tests for imports, credit allocation, earned-month persistence, rollback, and concurrency; then run the existing test suite. Use synthetic regression fixtures rather than commit personal transaction data.

## Builder decisions

The builder chooses module boundaries, evidence storage representation, and concise UI placement within the existing app. Preserve the agreed behavior above. The five unresolved merchant purchases and questionable historical duplicate credits remain user decisions; they do not block building the automation.
