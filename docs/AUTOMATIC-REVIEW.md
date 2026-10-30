# Automatic transaction review

Recognized posted purchases are categorized and imported after a successful Plaid sync. Saved merchant rules override built-in suggestions; conflicting equally specific rules and unfamiliar merchants remain in **Review transactions**. Pending purchases, source conflicts, other accounts/cardholders, previous connection generations, and records before the connection's import boundary are excluded.

## Teach a merchant

During CSV or Plaid review, select the purchase, enter its categories, and explicitly check **Remember**. For a purchase already imported, choose **Edit**, correct its categories, and check **Remember these categories for this merchant**. Saving retries the current cardholder's queued records. Automatic imports never create their own trusted rules, and they do not overwrite manually corrected purchases.

A merchant may have more than one category. Exclusion categories matter: Home Depot carries `home-improvement` as well as `retail`, so an offer excluding home-improvement purchases does not count it. A business category is a useful classification, not confirmation of the merchant code Citi applied.

## Credits and earned months

Only confirmed offers receive automatic assignments. The matcher checks eligible purchases, offer thresholds/caps, the unpaid reward budget, and a unique supporting purchase/day/checkpoint. Each assignment saves its explanation, supporting purchase IDs, earned month, and consumed reward evidence.

An explicit single-month range in the credit description identifies the earned month even when Citi backdates the credit. Without that range, purchase evidence must identify exactly one offer and period. Different plausible allocations, equal competing offers/months, malformed ranges, or suspected duplicates remain for review. Payments, interest, fees, and refunds are recorded as account events, not offer rewards.

Purchase and daily evidence share the same reward budget. Fixed/tiered rewards use period/checkpoint evidence: a paid first tier cannot be paid again when the next tier is reached. The same purchase may still support separate overlapping offers.

Legacy credits consume the unpaid budget too. When old evidence cannot be reconstructed confidently, the matcher reserves it conservatively. Repeated same-description/date/amount credit records are flagged, never deleted or silently combined. Compare the original bank records before changing their assignments. Deliberate manual assignments remain available and are identified separately.

Changing a purchase category, amount, earned month, or offer terms may invalidate earlier credit evidence. The credit remains posted at its original amount; its explanation requests review. The dashboard displays these results without assigning credits merely because it was opened.

## Counts, retries, and failures

The Citi connection panel shows the latest automatic review's imported purchases, matched credits, and remaining queue count. **Retry automatic review** processes the existing queue even when a bank sync has no new additions. Unknown items remain available for correction.

Plaid commits provider records and its cursor before automatic review begins. A review failure therefore does not discard a successful sync or cause provider pages to be replayed. The panel reports a separate review error; retry explicitly or allow the next successful sync to retry. Importing and assigning use a per-cardholder transaction lock to serialize automatic and manual changes.

## Configuration

`TRANSACTION_AUTO_REVIEW=true` is the default. To return to manual purchase imports, set:

```dotenv
TRANSACTION_AUTO_REVIEW=false
```

Recreate the app container after changing environment settings. Saved rules, existing imports, and credit history remain intact. Category suggestions and server-side credit reconciliation remain available; this switch disables automatic **imports**. CSV upload and confirmation always remain explicit.

Background retrieval is configured separately: `PLAID_AUTO_SYNC=true` enables scheduled bank synchronization. With it disabled, automatic review still runs after **Sync now**. Keep Sandbox/Production and existing encryption configuration unchanged when enabling review.

## Deployment and rollback

Before applying this version to an existing NAS:

1. Back up PostgreSQL and verify the current application revision and data volume.
2. Verify `app_migration_history` contains `one_time_clean_reset_2026_09_27`. The repository has an older reset migration; investigate a missing marker before starting a deployment that runs it.
3. Review the additive provenance/evidence/summary columns and the targeted legacy Home Depot rule correction in `migrations.sql`.
4. Deploy the reviewed application revision with the existing database volume and existing Plaid/M365 credentials. Start with automatic review disabled if an additional live-data preview is needed.
5. Enable automatic review, sync one selected connection, and verify counts, unresolved items, and saved credit explanations. Sync/retry again and verify no duplicate records.

Rollback by disabling automatic review or returning to the previous application image. Preserve the database volume and new evidence columns. Do not run `docker compose down -v`.

## Local validation

Run `npm test` for the normal suite. PostgreSQL-compatible integration tests require an installed PGlite module path:

```sh
PGLITE_TEST_MODULE=/path/to/node_modules/@electric-sql/pglite npm test
```

The integration tests use an isolated in-memory database and synthetic data. The test pool serializes a single database connection; production cross-process serialization is provided by PostgreSQL transaction advisory locks. Browser preview checks must also use synthetic data and must not point a development server at the live NAS database.
