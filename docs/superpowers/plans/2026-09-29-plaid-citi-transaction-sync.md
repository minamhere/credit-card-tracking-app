# Plaid Citi Transaction Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add private, review-first Plaid synchronization for one selected Citi credit-card account per cardholder.

**Architecture:** Focused server-side modules own Plaid transport, token encryption, connection persistence, and cursor-based synchronization; thin Express routes expose those operations to the existing browser app. Plaid records are staged before the existing transaction-import confirmation path promotes posted purchases and account events, while an outbound NAS scheduler and manual action share the same idempotent sync service.

**Tech Stack:** Node.js 18+, Express 4, PostgreSQL 15, Plaid Node SDK, Node `crypto`, browser JavaScript, `node:test`

**Spec:** `docs/superpowers/specs/2026-09-29-plaid-citi-transaction-sync-design.md`

## Global Constraints

- The application remains private on the Synology NAS and accepts no public inbound Plaid webhook.
- Each cardholder has a separate Plaid Item and exactly one selected Citi credit-card account.
- Other and newly discovered accounts never import automatically.
- Pending transactions never enter review or offer calculations.
- Purchases require review before final import; non-purchases follow the existing account-event path.
- Plaid secrets, plaintext access tokens, and the token-encryption key stay server-side and out of logs and source control.
- Production and Sandbox configuration and records must not mix.
- Manual Citi CSV import remains available and must not duplicate Plaid-imported records.

## Review Focus

- A Plaid Item containing zero or multiple credit accounts must remain inactive until exactly one account is selected; Task 2 tests this selection boundary.
- A sync page sequence that fails or mutates midway must leave both staged data and cursor at the last committed state; Task 3 tests rollback and mutation restart.
- The same real purchase arriving through Plaid and CSV must become one transaction or an explicit ambiguous-review item, never two silent imports; Task 4 tests cross-source reconciliation.
- A modified or removed Plaid record already linked to a manually edited transaction must be flagged without overwriting or deleting user work; Task 4 tests both conflict paths.
- Sandbox credentials, Production credentials, or ciphertext encrypted under another environment/key must fail closed with no token or raw payload in the error/log output; Tasks 1 and 6 test environment and secret isolation.

---

### Task 1: Database schema, environment validation, and token encryption

**Files:**
- Modify: `migrations.sql`
- Create: `plaid-config.js`
- Create: `plaid-token-crypto.js`
- Test: `test/plaid-config.test.js`
- Test: `test/plaid-token-crypto.test.js`
- Create: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `loadPlaidConfig(env) -> { clientId, secret, environment, tokenEncryptionKey, syncIntervalMs, autoSync }`
- Produces: `encryptAccessToken(token, key, environment) -> { ciphertext, nonce, authTag, keyVersion }`
- Produces: `decryptAccessToken(record, key, environment) -> string`
- Produces: tables `financial_connections`, `financial_accounts`, and `external_transactions` with the columns and uniqueness rules in the spec.

- [ ] **Step 1: Write failing configuration and encryption tests**

Test that `loadPlaidConfig` accepts only `sandbox` or `production`, requires a 32-byte base64 encryption key when configured, parses `PLAID_AUTO_SYNC` and a bounded positive `PLAID_SYNC_INTERVAL_MS`, and never includes secret values in thrown messages. Test AES-256-GCM round trips, random nonces, tamper rejection, wrong-key rejection, and environment mismatch rejection.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `node --test test/plaid-config.test.js test/plaid-token-crypto.test.js`

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement the schema and security modules**

Add the three tables, foreign keys, lifecycle/status checks, unique provider IDs, selected-account uniqueness, and indexes required by the spec. Implement `loadPlaidConfig`, `encryptAccessToken`, and `decryptAccessToken`; use authenticated encryption and bind the Plaid environment as authenticated context.

- [ ] **Step 4: Add dependency and deployment configuration**

Install the current Plaid Node SDK with `npm install plaid --save`. Add placeholder-only variable names to `.env.example` and pass `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `PLAID_TOKEN_ENCRYPTION_KEY`, `PLAID_AUTO_SYNC`, and `PLAID_SYNC_INTERVAL_MS` through `docker-compose.yml` without defaulting secrets.

- [ ] **Step 5: Verify schema text, dependency lock, and tests**

Run: `node --test test/plaid-config.test.js test/plaid-token-crypto.test.js && npm test && git diff --check`

Expected: all tests pass and no whitespace errors are reported.

- [ ] **Step 6: Commit**

```bash
git add migrations.sql plaid-config.js plaid-token-crypto.js test/plaid-config.test.js test/plaid-token-crypto.test.js .env.example docker-compose.yml package.json package-lock.json
git commit -m "feat: add secure Plaid connection storage"
```

### Task 2: Plaid client, Link exchange, and single-account selection

**Files:**
- Create: `plaid-client.js`
- Create: `plaid-connections.js`
- Test: `test/plaid-client.test.js`
- Test: `test/plaid-connections.test.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: `loadPlaidConfig`, `encryptAccessToken`, `decryptAccessToken`, and Task 1 tables.
- Produces: `createPlaidClient(config, sdk?)` with `createLinkToken`, `exchangePublicToken`, `getAccounts`, `getItem`, and `removeItem` methods.
- Produces: `createConnectionService({ pool, plaidClient, config })` with `createLinkToken(personId)`, `exchangeAndDiscover(personId, publicToken)`, `selectAccount(personId, connectionId, accountId)`, `getStatus(personId)`, and `disconnect(personId, connectionId)`.
- Produces routes: `POST /api/plaid/link-token`, `POST /api/plaid/exchange`, `PUT /api/plaid/connections/:id/account`, `GET /api/plaid/status`, and `DELETE /api/plaid/connections/:id`.

- [ ] **Step 1: Write failing Plaid client contract tests**

With an injected fake SDK, assert `createLinkToken` sends `products: ['transactions']`, `country_codes: ['US']`, no webhook, no redirect URI, a non-PII `client_user_id` derived from `personId`, and the configured environment. Assert SDK errors are converted to safe errors carrying only code and Plaid request ID.

- [ ] **Step 2: Run the client test and verify failure**

Run: `node --test test/plaid-client.test.js`

Expected: FAIL because `plaid-client.js` is missing.

- [ ] **Step 3: Implement `createPlaidClient(config, sdk?)`**

Use the Plaid SDK on the server and keep response mapping inside this module so downstream code receives stable, minimal objects.

- [ ] **Step 4: Write failing connection lifecycle tests**

Using a fake pool and client, test nonexistent cardholders, public-token exchange, encrypted token persistence, discovery of zero/one/multiple credit cards, rejection of accounts owned by another connection/person, exactly-one selection, unselected-account inactivity, safe status serialization, provider removal, and no token fields in returned objects.

- [ ] **Step 5: Run the connection tests and verify failure**

Run: `node --test test/plaid-connections.test.js`

Expected: FAIL because the service is missing.

- [ ] **Step 6: Implement connection lifecycle and thin Express routes**

Create `createConnectionService({ pool, plaidClient, config })`. Wire routes in `server.js` with strict integer validation for `personId`, `connectionId`, and account ownership; responses may contain account display name, subtype, mask, selection, status, and timestamps but no Plaid credentials.

- [ ] **Step 7: Verify connection tests and regression suite**

Run: `node --test test/plaid-client.test.js test/plaid-connections.test.js && npm test`

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add plaid-client.js plaid-connections.js test/plaid-client.test.js test/plaid-connections.test.js server.js
git commit -m "feat: connect cardholders to one Plaid account"
```

### Task 3: Atomic cursor synchronization and transaction staging

**Files:**
- Create: `plaid-transactions.js`
- Create: `plaid-sync.js`
- Test: `test/plaid-transactions.test.js`
- Test: `test/plaid-sync.test.js`
- Modify: `plaid-client.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: selected connections/accounts and decrypted token access from `createConnectionService`.
- Produces: `normalizePlaidTransaction(raw) -> ExternalTransactionInput` with stable date, amount, description, merchant, pending relationship, category, and inferred transaction kind.
- Produces: Plaid client method `syncTransactions(accessToken, cursor) -> { added, modified, removed, nextCursor, hasMore }`.
- Produces: `createSyncService({ pool, plaidClient, connectionService })` with `syncConnection(personId, connectionId) -> SyncSummary` and `syncAllHealthy() -> SyncResult[]`.
- Produces route: `POST /api/plaid/connections/:id/sync`.

- [ ] **Step 1: Write failing normalization tests**

Cover posted and pending purchases, a posted record linked by `pending_transaction_id`, payments/refunds with negative Plaid amounts, interest and fees, null merchant names, authorized versus posted dates, and malformed records that must be rejected rather than partially staged.

- [ ] **Step 2: Run normalization tests and verify failure**

Run: `node --test test/plaid-transactions.test.js`

Expected: FAIL because `plaid-transactions.js` is missing.

- [ ] **Step 3: Implement `normalizePlaidTransaction(raw)` and `syncTransactions`**

Keep Plaid's amount sign in staging and derive an explicit kind (`purchase`, `payment`, `refund`, `credit`, `interest`, or `fee`) so conversion to the application's positive-purchase convention happens only at review projection.

- [ ] **Step 4: Write failing synchronization tests**

Test multi-page added/modified/removed streams, ignoring every unselected account, upsert idempotency, cursor advancement only after commit, rollback on page or database failure, one active sync per connection, independent connection failures, and Plaid's pagination-mutation error restarting from the last committed cursor.

- [ ] **Step 5: Run synchronization tests and verify failure**

Run: `node --test test/plaid-sync.test.js`

Expected: FAIL because the sync service is missing.

- [ ] **Step 6: Implement `createSyncService` and manual sync route**

Use a database transaction plus a per-connection PostgreSQL advisory transaction lock. Fetch all Plaid pages, filter by the selected account before persistence, upsert lifecycle changes, record attempt/success/error state, and update the cursor in the same commit as staged records.

- [ ] **Step 7: Verify sync tests and regression suite**

Run: `node --test test/plaid-transactions.test.js test/plaid-sync.test.js && npm test`

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add plaid-transactions.js plaid-sync.js plaid-client.js test/plaid-transactions.test.js test/plaid-sync.test.js server.js
git commit -m "feat: stage incremental Plaid transactions"
```

### Task 4: Review projection, confirmation, and cross-source reconciliation

**Files:**
- Create: `transaction-reconciliation.js`
- Test: `test/transaction-reconciliation.test.js`
- Modify: `server.js`
- Modify: `database.js`
- Modify: `app.js`
- Test: `test/citi-csv.test.js`

**Interfaces:**
- Consumes: staged `external_transactions`, existing merchant rules, `transactionHash`, `/api/transaction-imports/preview`, and `/api/transaction-imports/confirm`.
- Produces: `reconcileCandidate(candidate, existingRows) -> { status: 'new'|'duplicate'|'ambiguous', matchId?: number }`.
- Produces routes: `GET /api/plaid/review?personId=...` and confirmation support for `externalTransactionId` on `/api/transaction-imports/confirm`.
- Produces browser method: `DatabaseManager.getPlaidReview()` returning the same review-row shape used by Citi CSV preview plus `externalTransactionId` and lifecycle status.

- [ ] **Step 1: Write failing reconciliation tests**

Assert exact provider-ID duplicates, Plaid-versus-CSV matches using person/date/absolute amount/type/normalized raw merchant within the fixed three-day window, repeated identical purchases remaining distinct by occurrence/provider ID, ambiguous candidates staying unimported, and unrelated cardholders never matching.

- [ ] **Step 2: Run reconciliation tests and verify failure**

Run: `node --test test/transaction-reconciliation.test.js`

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement `reconcileCandidate` and review projection**

Project only posted staged rows from the selected account. Convert purchases to positive application amounts, apply saved merchant rules through the existing preview logic, and represent payments/credits/interest/fees as account-event candidates.

- [ ] **Step 4: Write failing confirmation and conflict tests**

Test that confirmation links each external record exactly once, retries are idempotent, non-purchases become account events, modified imported records update untouched application rows but mark manually edited rows `conflicted`, and removed imported records are flagged without deletion. Extend CSV tests to prove Plaid-origin matches are excluded or marked ambiguous.

- [ ] **Step 5: Run the focused integration tests and verify failure**

Run: `node --test test/transaction-reconciliation.test.js test/citi-csv.test.js`

Expected: FAIL on the new integration assertions.

- [ ] **Step 6: Wire review and confirmation into existing imports**

Add `getPlaidReview()` to `database.js`. Extend confirmation payload handling in `server.js` to validate `externalTransactionId`, preserve the existing CSV contract, and atomically create/link application transactions or account events. Add an `app.js` entry point that loads Plaid rows into the existing `importPreview` and confirmation UI without duplicating rendering logic.

- [ ] **Step 7: Verify reconciliation and full tests**

Run: `node --test test/transaction-reconciliation.test.js test/citi-csv.test.js && npm test`

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add transaction-reconciliation.js test/transaction-reconciliation.test.js test/citi-csv.test.js server.js database.js app.js
git commit -m "feat: review and reconcile Plaid imports"
```

### Task 5: Citi connection and review user interface

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `database.js`
- Modify: `app.js`
- Create: `test/plaid-ui.test.js`

**Interfaces:**
- Consumes: Task 2 status/link/account routes, Task 3 sync route, and Task 4 review route.
- Produces: `DatabaseManager` methods `createPlaidLinkToken`, `exchangePlaidToken`, `selectPlaidAccount`, `getPlaidStatus`, `syncPlaidConnection`, `disconnectPlaidConnection`.
- Produces: `CreditCardOfferApp.renderPlaidConnection()`, `connectPlaid()`, `selectPlaidAccount()`, `syncPlaid()`, and `reviewPlaidTransactions()`.

- [ ] **Step 1: Write failing DOM contract tests**

Use lightweight fake DOM/fetch objects to assert cardholder-required behavior, Connect/Sync/Reconnect button states, account mask escaping, exactly-one selection, ignored extra-account messaging, last-success versus last-attempt display, attention-required recovery copy, and no secret fields rendered.

- [ ] **Step 2: Run UI tests and verify failure**

Run: `node --test test/plaid-ui.test.js`

Expected: FAIL because the UI methods and markup are missing.

- [ ] **Step 3: Add Plaid Link and connection panel markup**

Load Plaid Link's official browser script from its documented CDN. Add the connection panel beside Citi CSV import with accessible status text, account selection, Connect, Sync now, Reconnect, Disconnect, and Review controls; keep CSV import unchanged as the fallback.

- [ ] **Step 4: Implement browser API and UI methods**

Bind every action to the currently selected `personId`, pass the short-lived Link token only to Plaid Link, exchange only the returned public token, refresh status after each operation, and reuse `renderImportPreview` for review rows.

- [ ] **Step 5: Verify UI tests and browser-neutral regressions**

Run: `node --test test/plaid-ui.test.js && npm test && git diff --check`

Expected: all tests pass and no whitespace errors are reported.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css database.js app.js test/plaid-ui.test.js
git commit -m "feat: add Citi connection controls"
```

### Task 6: Reconnect flow, safe errors, and outbound scheduler

**Files:**
- Create: `plaid-scheduler.js`
- Test: `test/plaid-scheduler.test.js`
- Modify: `plaid-connections.js`
- Modify: `plaid-client.js`
- Modify: `server.js`
- Modify: `app.js`
- Test: `test/plaid-connections.test.js`

**Interfaces:**
- Consumes: `syncAllHealthy`, connection status persistence, and Plaid Link UI from earlier tasks.
- Produces: `createPlaidScheduler({ syncService, intervalMs, setTimeoutFn, clearTimeoutFn })` with `start()` and `stop()`.
- Produces: `createUpdateLinkToken(personId, connectionId)` and route `POST /api/plaid/connections/:id/update-link-token`.

- [ ] **Step 1: Write failing scheduler and recovery tests**

Test disabled auto-sync, delayed first run, non-overlapping cycles, backoff after repeated failures, continuation when one connection fails, clean shutdown, `ITEM_LOGIN_REQUIRED`/consent errors becoming `attention_required`, rate limits remaining retryable, and safe errors excluding tokens, secrets, and raw payloads.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test test/plaid-scheduler.test.js test/plaid-connections.test.js`

Expected: FAIL on scheduler and update-mode cases.

- [ ] **Step 3: Implement scheduler and Link update mode**

Use chained timeouts rather than `setInterval` so runs cannot overlap. Start only after migrations complete and only when Plaid is configured and `PLAID_AUTO_SYNC=true`. Stop on `SIGTERM`/`SIGINT`. Create update Link tokens using the stored Item access token without exchanging a new public token.

- [ ] **Step 4: Wire recovery UI and safe operational logging**

Show Reconnect only for recoverable attention states. Log internal connection ID, safe Plaid error code, and Plaid request ID; never serialize request bodies, access tokens, secrets, or raw transactions.

- [ ] **Step 5: Verify recovery and full suite**

Run: `node --test test/plaid-scheduler.test.js test/plaid-connections.test.js && npm test`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add plaid-scheduler.js test/plaid-scheduler.test.js plaid-connections.js plaid-client.js server.js app.js test/plaid-connections.test.js
git commit -m "feat: schedule and recover Plaid synchronization"
```

### Task 7: Deployment documentation and end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `DOCKER-DEPLOYMENT.md`
- Create: `docs/PLAID-OPERATIONS.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: exact Sandbox-to-Production NAS setup, key-generation, connection, validation, rollback, disconnect, and CSV-fallback procedures.

- [ ] **Step 1: Document secret generation and NAS configuration**

Document generating a 32-byte base64 token-encryption key, setting Sandbox variables without placing values in Git, rebuilding the container, confirming migrations, and recognizing configuration failures. State that changing or losing the encryption key makes stored Plaid tokens unreadable and requires reconnection.

- [ ] **Step 2: Document the staged verification runbook**

Include Sandbox Link, one selected test credit account, initial sync, review, confirmation, retry/idempotency check, pending exclusion, and CSV reconciliation. Then document the deliberate switch to Production credentials, first Citi login only, raw-data inspection, scheduler enablement, and second Citi login.

- [ ] **Step 3: Run automated verification**

Run: `npm test && git diff --check && npm audit --omit=dev`

Expected: all tests pass, no whitespace errors, and no high/critical production dependency vulnerabilities. Record and assess any lower-severity audit findings rather than silently ignoring them.

- [ ] **Step 4: Build and validate the Docker configuration**

Run: `docker compose config`

Expected: configuration renders successfully with Plaid variable names present and no real secret values committed.

- [ ] **Step 5: Perform Sandbox smoke test on the deployed NAS**

Follow `docs/PLAID-OPERATIONS.md` to connect one Sandbox Item, select one account, sync twice, review transactions, and confirm the second sync creates no duplicates. This step requires the operator's NAS and Plaid credentials; do not record tokens in test output.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md DOCKER-DEPLOYMENT.md docs/PLAID-OPERATIONS.md
git commit -m "docs: add Plaid operations runbook"
```

- [ ] **Step 7: Request final code review before Production Citi connection**

Review the complete branch against the design spec, with special attention to token exposure, person/account ownership checks, cursor atomicity, reconciliation false positives, and NAS-only operation. Do not connect a real Citi Item until review findings and the full test suite are clean.
