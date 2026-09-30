# Plaid Citi Transaction Sync Design

## Purpose

Add reliable Citi credit-card transaction synchronization to the Credit Card Offer Tracker through Plaid Transactions. The integration serves two cardholders, each with a separate Citi login and one relevant credit-card account. The application remains private on the Synology NAS and does not accept inbound internet traffic.

Success means that either cardholder can connect the relevant Citi card, retrieve posted transactions without sharing Citi credentials with this application, review transactions before import, and synchronize repeatedly without duplicates or cross-cardholder data leakage.

## Scope

The first release will:

- Connect one Plaid Item for each cardholder through Plaid Link and Citi OAuth.
- Select exactly one relevant Citi credit-card account from each Item.
- Retrieve incremental Transactions updates with `/transactions/sync`.
- Run synchronization on demand and on an outbound NAS schedule.
- Stage pending and posted records while preserving Plaid's raw values and lifecycle.
- Send posted purchases through the existing merchant normalization, category-rule, review, and offer-matching flow.
- Treat payments, credits, interest, and fees as account events, consistent with the existing Citi CSV import.
- Reconcile Plaid and CSV sources without creating duplicate application transactions.
- Show connection health and recovery actions separately for each cardholder.

The first release will not expose a public webhook, import transactions from unselected accounts, count pending transactions toward offers, or automatically finalize purchases without review. Balance, Auth, Identity, Liabilities, and payment products are outside scope.

## Operating Constraints

- The application is accessed through a private local-network HTTP address.
- Plaid Link will initially use its desktop popup OAuth behavior without a redirect URI.
- The NAS can make outbound HTTPS requests to Plaid.
- There is no application login layer. The private network remains the access boundary for this release.
- Plaid client credentials and the token-encryption key must exist only in NAS container environment variables.
- Manual Citi CSV import remains available for historical backfill, outages, and reconciliation.

## Architecture

The browser asks the application server for a short-lived Plaid Link token associated with the selected cardholder. Plaid Link handles Citi authentication and returns a temporary public token. The browser sends that token to the server, which exchanges it for a Plaid Item ID and access token. The access token is encrypted before storage and never returned to the browser.

After Link completes, the server fetches the Item's accounts. The operator selects the single relevant Citi credit-card account. Only that account ID is enabled for synchronization. Other returned accounts are recorded only as discovery metadata or discarded; they are never imported. If Plaid later reports a new account, it remains disabled until deliberately selected.

Synchronization is initiated by a UI action or an internal scheduler. The server decrypts the access token, calls `/transactions/sync` with the saved cursor, processes every page, and commits the data and new cursor atomically. Plaid's regular institution refresh supplies changes to `/transactions/sync`; the private NAS does not require inbound webhooks.

## Components

### Plaid client

A focused server-side module will own Plaid API construction and calls. It will expose operations for creating Link tokens, exchanging public tokens, listing accounts, synchronizing transactions, retrieving Item health, and removing a connection. The rest of the application will depend on this interface rather than on Plaid response shapes directly.

### Connection service

The connection service will map each Plaid Item to one `person_id`, encrypt and decrypt access tokens, enforce the selected-account allowlist, track connection state, and translate recoverable Plaid errors into application statuses. A connection belonging to one cardholder cannot be addressed through another cardholder's routes.

### Synchronization service

The synchronization service will page through `/transactions/sync`, normalize added, modified, and removed records, and persist the result in one database transaction. It will advance the cursor only after all pages and downstream staging changes succeed. Concurrent sync attempts for the same connection will be serialized.

### Review integration

Posted purchases will be transformed into the existing import-preview shape and run through saved merchant/category rules. They will remain reviewable before confirmation. Non-purchase records will use the existing account-event and offer-credit matching behavior. Plaid-specific metadata stays in the staging layer rather than leaking into offer calculations.

### Scheduler

An in-process scheduler will periodically request synchronization for healthy connections. The exact interval will be configurable and conservative because Plaid generally refreshes institution data only a few times per day. Manual **Sync now** uses the same idempotent service. A process restart may delay a run but cannot corrupt sync state.

## Data Model

### `financial_connections`

One row represents one cardholder's Plaid Item:

- Internal ID and `person_id`
- Provider (`plaid`)
- Plaid Item ID
- Encrypted Plaid access token plus encryption version/metadata
- Current sync cursor
- Status and last error classification
- Last attempted and last successful sync timestamps
- Consent-expiration timestamp when supplied
- Created and updated timestamps

Plaid Item IDs will be unique. The application will initially permit one active Citi Item per cardholder while keeping the schema capable of supporting more providers or Items later.

### `financial_accounts`

An account row belongs to a connection and stores:

- Plaid account ID
- Display name, official name, subtype, mask, and persistent account ID when available
- Selection state
- Discovery and update timestamps

Exactly one account per Citi connection may be selected in this release. A database constraint or transactional validation will enforce the invariant. Account numbers are neither requested nor stored.

### `external_transactions`

The staging record stores:

- Provider and Plaid transaction ID
- Connection and account IDs
- `person_id`
- Pending transaction relationship
- Posted/pending state
- Date, authorized date, amount, raw description, merchant, category, and transaction type
- Raw provider payload needed for audit and future remapping
- Lifecycle state: staged, awaiting review, imported, ignored, removed, or conflicted
- Associated application transaction or account-event ID
- First-seen and last-updated timestamps

`(provider, provider_transaction_id)` will be unique. The service must apply Plaid's added, modified, and removed streams rather than treating every result as a new row.

## Transaction Rules

- Pending transactions are staged but do not enter the import review queue or offer calculations.
- When a pending transaction posts, the posted record supersedes its linked pending record.
- Posted positive purchases enter the review queue with existing merchant and category rules applied.
- Payments, refunds, statement credits, interest, and fees follow the existing account-event path.
- Plaid transaction IDs are the primary provider identity.
- Cross-source reconciliation will compare selected account, date, amount, transaction type, and normalized raw merchant within a constrained window before importing a CSV row. Ambiguous matches are shown for review rather than silently merged.
- A removed Plaid record that has not been imported is marked removed. If already imported, it is flagged for review; the application does not silently delete user-visible financial history.
- A modified Plaid record updates staging automatically. If its imported application transaction was manually edited, the discrepancy is flagged instead of overwriting the edit.

## API and User Interface

Server routes will support:

- Creating a Link token for a specified cardholder
- Exchanging a Link public token and discovering accounts
- Selecting the one relevant account
- Reading connection/account health without exposing secrets
- Starting an idempotent sync
- Listing staged transactions for the existing review UI
- Reconnecting an Item through Link update mode
- Disconnecting an Item after explicit confirmation

The cardholder interface will show a compact Citi connection panel with connection status, the selected card name and last four digits, last successful sync, pending review count, and **Connect Citi**, **Sync now**, and **Reconnect** actions. Newly discovered or additional accounts will appear as unselected and will never begin importing automatically.

## Security

- Citi credentials and MFA responses remain inside Citi's OAuth flow.
- Plaid secrets, access tokens, and the encryption key never enter browser responses, logs, source control, or database plaintext.
- Access tokens will use authenticated encryption with a random nonce and an application-held key.
- Server routes validate `person_id`, connection ownership, account ownership, expected Plaid environment, and request shape.
- Logs include internal connection IDs and Plaid request IDs where useful, but exclude credentials, tokens, and raw financial payloads.
- Disconnect removes the Plaid Item through the provider when possible, then makes the local encrypted token unusable while retaining necessary audit records.
- Production and Sandbox credentials and records cannot be mixed.

## Failure Handling

Sync is retry-safe. Rate limits, Plaid outages, network failures, invalid responses, and database errors leave the prior cursor intact. A later attempt resumes from the last committed cursor.

Authentication or consent errors set the affected connection to `attention_required` and offer a reconnect action using Plaid Link update mode. One failed connection does not block the other. The UI distinguishes last attempt from last successful update so stale data is visible.

Pagination will restart from the last committed cursor if transaction mutations cause Plaid to reject an in-progress paginated sync. Repeated automated failures back off rather than creating a tight retry loop. Manual CSV import remains available throughout provider outages.

## Testing

Automated tests will cover:

- Link-token requests bound to the correct cardholder
- Public-token exchange and encrypted token persistence
- No secrets or access tokens in API responses and logs
- One selected account per connection and rejection of cross-cardholder account selection
- Ignoring unselected and newly discovered accounts
- Cursor pagination, atomic advancement, retries, and concurrent sync serialization
- Added, modified, removed, pending, and posted transaction streams
- Pending-to-posted relationships
- Purchases, payments, refunds, credits, interest, and fees
- User-edited imported transactions and provider conflicts
- Plaid-to-CSV duplicate reconciliation
- Independent failure and recovery for both cardholders
- Scheduler and manual sync using the same service

Integration verification will first use Plaid Sandbox. The first controlled Production test will connect one Citi login and select its single relevant card. The operator will inspect account identity, raw merchant descriptions, signs, transaction types, pending behavior, and review results before enabling scheduled synchronization or connecting the second Citi login.

## Deployment Sequence

1. Add the Plaid client, encryption configuration, schema, and migrations.
2. Implement Sandbox Link and token exchange.
3. Implement account discovery and single-account selection.
4. Implement staged `/transactions/sync` ingestion and automated tests.
5. Integrate the existing review, merchant-rule, account-event, and deduplication flows.
6. Add connection health, reconnect, and manual sync UI.
7. Verify one Sandbox connection end to end.
8. Configure NAS Sandbox environment variables and validate the deployed flow.
9. Switch deliberately to Production credentials and connect one Citi login.
10. Validate real data before enabling the scheduler and second Citi connection.

## Acceptance Criteria

- Each cardholder can independently connect one selected Citi credit-card account.
- No transaction from an unselected account is staged or imported.
- Posted purchases arrive in the review flow with existing merchant/category rules applied.
- Pending records do not affect offer progress.
- Repeated and interrupted syncs do not duplicate records or lose cursor progress.
- Plaid modifications and removals are visible and reconciled safely.
- CSV fallback does not duplicate transactions already imported from Plaid.
- A broken connection is visible and recoverable without affecting the other cardholder.
- Secrets and decrypted access tokens remain server-side and out of logs and source control.
- The application requires no public inbound network route.
