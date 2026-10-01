# Plaid Operations on Synology NAS

This app uses outbound HTTPS requests to Plaid. It does not need a public hostname, inbound webhook, reverse proxy, or router port forwarding. Keep the app available only at its local address (for example, `http://192.168.1.20:3000`).

## 1. Configure Sandbox safely

On the NAS, work in the deployed project directory. Create `.env` from the example if it does not exist and restrict it to the administrator account:

```sh
cd /volume1/docker/credit-card-tracker
cp -n .env.example .env
chmod 600 .env
openssl rand -base64 32
```

Copy the generated value once into `PLAID_TOKEN_ENCRYPTION_KEY` in `.env`, then add the Sandbox client ID and secret from the Plaid dashboard:

```dotenv
PLAID_CLIENT_ID=your-client-id
PLAID_SECRET=your-sandbox-secret
PLAID_ENV=sandbox
PLAID_TOKEN_ENCRYPTION_KEY=the-generated-32-byte-base64-value
PLAID_AUTO_SYNC=false
PLAID_SYNC_INTERVAL_MS=21600000
```

Never commit `.env`, paste its contents into logs, or put these values in `docker-compose.yml`. Back up the encryption key in the same protected password manager as the Plaid credentials. Losing or changing it makes every stored access token unreadable; recovery is to disconnect/delete the unusable connection record and reconnect each login with the new key.

Rebuild and inspect startup:

```sh
docker compose up -d --build
docker compose logs --tail=150 app
```

The log should show migrations completing and the server starting. Incomplete credentials, an invalid environment, a malformed encryption key, or an out-of-range sync interval stops startup with a configuration error. Do not work around that error by weakening validation.

## 2. Sandbox acceptance test

Keep automatic sync disabled during this test.

1. Open the app at its private LAN address and select the first cardholder.
2. In Transactions, choose **Connect Citi** and complete Plaid Link with a Sandbox institution/user.
3. Select exactly one test credit-card account. Do not select checking, savings, or additional cards.
4. Choose **Sync now**. Open **Review transactions** and inspect dates, signed transaction type, amount, merchant, pending state, and cardholder.
5. Confirm a small set. Pending purchases must not be offered for confirmation; payments, interest, fees, and credits should use the appropriate account-event path.
6. Sync again. The second sync must not create duplicates. Previously confirmed provider records should remain linked.
7. Import an overlapping Citi CSV. A unique matching Plaid/CSV record may reconcile; ambiguous records must remain for review rather than being merged automatically.
8. Repeat the sync once more and verify counts remain stable.

To inspect counts without exposing raw payloads or tokens:

```sh
docker compose exec db psql -U credit_card_user -d credit_card_tracker -c "SELECT lifecycle_status, count(*) FROM external_transactions GROUP BY lifecycle_status ORDER BY lifecycle_status;"
docker compose exec db psql -U credit_card_user -d credit_card_tracker -c "SELECT status, last_error_code, last_attempt_at, last_success_at FROM financial_connections ORDER BY id;"
```

## 3. Deliberate Production rollout

Do not reuse a Sandbox secret. Complete Plaid Production approval and confirm Transactions access in the Plaid dashboard first.

1. Take a PostgreSQL backup.
2. Disconnect all Sandbox Items in the app.
3. Stop the app, set `PLAID_ENV=production` and `PLAID_SECRET` to the Production secret. Keep the same encryption key. Rebuild and start the app.
4. Connect only the first real Citi login. Select its one relevant card and sync manually.
5. Review the staged data before confirming anything. Check cardholder, last four digits, dates, purchases, payments/credits, pending handling, and duplicate behavior.
6. After the manual checks are clean, set `PLAID_AUTO_SYNC=true`; keep the six-hour interval unless there is a specific need to change it. Rebuild and confirm a scheduled attempt appears after startup.
7. Only then connect the second Citi login under the second cardholder and repeat the same manual inspection.

The two connections are independent. A failure on one must not prevent the other from syncing. Authentication or consent failures display **Reconnect**; completing it updates the existing Plaid Item without exchanging or storing a new public token.

## 4. Routine operation and recovery

- New Citi connections request 60 days of initial history. The initial import boundary is fixed when the connection is created; subsequent cursor-based syncs retrieve all new changes, even after a long gap. It is not a rolling 60-day filter.
- Purchases, payments, credits, and other account events start unselected in review. Check only the rows you want; unselected rows are not imported. Merchant-rule saving also requires an explicit check.
- On upgrading an existing connection, staged history older than 60 days before its original connection date is hidden from review and its count. No staged or imported data is deleted, the sync cursor is preserved, and reconnecting is not necessary. Previously imported records remain unchanged and provider conflicts remain visible.
- Use **Sync now** for an immediate refresh. Normal automatic sync uses chained, non-overlapping runs.
- A transient provider or rate-limit error is retried on a later scheduled run. Do not repeatedly click Sync.
- If **Reconnect** appears, complete Citi authentication in Plaid Link and let the app sync again.
- Keep PostgreSQL backups and the encryption key backup separate from the NAS data volume.
- Logs may contain an internal connection ID and Plaid error code. They must never contain credentials, access tokens, request bodies, or raw transaction payloads.

To disable background activity without removing data, set `PLAID_AUTO_SYNC=false` and recreate the app container. To revoke a connection, use **Disconnect**; already imported transactions remain. Disconnecting also revokes the Plaid Item and makes the stored token unusable.

## 5. Rollback and CSV fallback

If Plaid is unavailable or Production behavior is questionable:

1. Set `PLAID_AUTO_SYNC=false` and recreate the app container.
2. Leave the connection in place for investigation, or use **Disconnect** if access should be revoked immediately.
3. Continue importing Citi CSV files through the existing preview/confirm workflow. Review cross-source matches carefully; the app does not silently merge ambiguous transactions.
4. To roll the application version back, restore the prior Git revision/image without deleting the PostgreSQL volume. The added Plaid tables are additive and may remain unused.

Do not run `docker compose down -v`; it deletes the database volume.

## 6. Cross-source duplicate repair

Plaid and Citi CSV often use different raw merchant descriptions. Purchases now reconcile using normalized raw descriptions within three days, or an exact same-day, same-amount, normalized display merchant match. Multiple candidates remain ambiguous; a linked CSV purchase cannot be consumed by a second Plaid provider ID. The Plaid review screen labels unique matches as **Matches existing**: select one to attach its provider record without adding a purchase or changing the original categories.

For duplicates already imported, first update/rebuild the app and take a PostgreSQL backup. Run the read-only preview:

```sh
docker compose exec app node repair-plaid-duplicates.js
```

Review the duplicate/keep IDs, cardholder, date, merchant, and amount. The preview prints a token tied to the exact snapshots. Only after approving those pairs, run:

```sh
docker compose exec app node repair-plaid-duplicates.js --apply PREVIEW_TOKEN
```

This repair handles only unique one-to-one same-day purchase pairs between original CSV rows and redundant Plaid rows. It skips pending/conflicted/provider-modified records and Plaid copies referenced by offer credits. Applying archives complete snapshots in `transaction_duplicate_repairs`, moves each provider link to the original CSV transaction, and removes only the redundant Plaid transaction. Original categories and links stay intact; provider tokens and sync cursors are untouched. Changes are atomic, and a changed preview token aborts the operation. Running the preview again should no longer list repaired pairs. Account events and ambiguous purchases are not repaired automatically. Recovery is available from the database backup or archived snapshots; there is no automatic undo command.
