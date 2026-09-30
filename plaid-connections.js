const { encryptAccessToken, decryptAccessToken } = require('./plaid-token-crypto');

function mapAccount(row) {
  return {
    id: row.id,
    accountId: row.id,
    providerAccountId: row.provider_account_id,
    name: row.display_name,
    officialName: row.official_name || null,
    type: row.account_type || null,
    subtype: row.account_subtype || null,
    mask: row.mask || null,
    selected: Boolean(row.selected)
  };
}

function encryptedRecord(row) {
  return {
    ciphertext: row.access_token_ciphertext,
    nonce: row.access_token_nonce,
    authTag: row.access_token_auth_tag,
    keyVersion: row.access_token_key_version,
    environment: row.environment
  };
}

function createConnectionService({ pool, plaidClient, config }) {
  async function requirePerson(personId) {
    const result = await pool.query('SELECT id FROM people WHERE id = $1', [personId]);
    if (!result.rows.length) throw new Error('Cardholder not found.');
  }

  async function withTransaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    async createLinkToken(personId) {
      await requirePerson(personId);
      return plaidClient.createLinkToken(personId);
    },

    async createUpdateLinkToken(personId, connectionId) {
      const connection = await this.getActiveConnection(personId, connectionId);
      return plaidClient.createUpdateLinkToken(connection.accessToken, personId);
    },

    async exchangeAndDiscover(personId, publicToken) {
      await requirePerson(personId);
      if (typeof publicToken !== 'string' || !publicToken) throw new Error('A Plaid public token is required.');
      const exchange = await plaidClient.exchangePublicToken(publicToken);
      const [accounts, item] = await Promise.all([
        plaidClient.getAccounts(exchange.accessToken),
        plaidClient.getItem(exchange.accessToken)
      ]);
      const encrypted = encryptAccessToken(exchange.accessToken, config.tokenEncryptionKey, config.environment);

      return withTransaction(async client => {
        const connectionResult = await client.query(`
          INSERT INTO financial_connections
            (person_id, provider_item_id, environment, access_token_ciphertext,
             access_token_nonce, access_token_auth_tag, access_token_key_version,
             consent_expiration_at, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'account_selection')
          ON CONFLICT (person_id, provider, environment) DO UPDATE SET
            provider_item_id = EXCLUDED.provider_item_id,
            access_token_ciphertext = EXCLUDED.access_token_ciphertext,
            access_token_nonce = EXCLUDED.access_token_nonce,
            access_token_auth_tag = EXCLUDED.access_token_auth_tag,
            access_token_key_version = EXCLUDED.access_token_key_version,
            consent_expiration_at = EXCLUDED.consent_expiration_at,
            sync_cursor = NULL,
            status = 'account_selection',
            updated_at = CURRENT_TIMESTAMP
          RETURNING id
        `, [personId, exchange.itemId, config.environment, encrypted.ciphertext, encrypted.nonce,
          encrypted.authTag, encrypted.keyVersion, item.consentExpirationTime]);
        const connectionId = connectionResult.rows[0].id;
        const discovered = [];
        for (const account of accounts) {
          const accountResult = await client.query(`
            INSERT INTO financial_accounts
              (connection_id, provider_account_id, persistent_account_id, display_name,
               official_name, account_type, account_subtype, mask, selected)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE)
            ON CONFLICT (connection_id, provider_account_id) DO UPDATE SET
              persistent_account_id = EXCLUDED.persistent_account_id,
              display_name = EXCLUDED.display_name,
              official_name = EXCLUDED.official_name,
              account_type = EXCLUDED.account_type,
              account_subtype = EXCLUDED.account_subtype,
              mask = EXCLUDED.mask,
              selected = FALSE,
              updated_at = CURRENT_TIMESTAMP
            RETURNING id
          `, [connectionId, account.accountId, account.persistentAccountId, account.name,
            account.officialName, account.type, account.subtype, account.mask]);
          discovered.push({
            id: accountResult.rows[0]?.id,
            providerAccountId: account.accountId,
            name: account.name,
            officialName: account.officialName,
            type: account.type,
            subtype: account.subtype,
            mask: account.mask,
            selected: false
          });
        }
        return { connection: { id: connectionId, status: 'account_selection', environment: config.environment }, accounts: discovered };
      });
    },

    async selectAccount(personId, connectionId, accountId) {
      return withTransaction(async client => {
        const result = await client.query(`
          SELECT a.id AS account_id, a.account_type, a.account_subtype
          FROM financial_accounts a
          JOIN financial_connections c ON c.id = a.connection_id
          WHERE a.id = $1 AND c.id = $2 AND c.person_id = $3 AND c.status <> 'disconnected'
          FOR UPDATE
        `, [accountId, connectionId, personId]);
        if (!result.rows.length) throw new Error('Account not found for this cardholder connection.');
        const account = result.rows[0];
        if (account.account_type !== 'credit' || account.account_subtype !== 'credit card') {
          throw new Error('Select a credit-card account.');
        }
        await client.query('UPDATE financial_accounts SET selected = FALSE, updated_at = CURRENT_TIMESTAMP WHERE connection_id = $1', [connectionId]);
        const selectedResult = await client.query(`
          UPDATE financial_accounts SET selected = TRUE, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND connection_id = $2
          RETURNING id, provider_account_id, display_name, official_name, account_type, account_subtype, mask, selected
        `, [accountId, connectionId]);
        await client.query("UPDATE financial_connections SET status = 'healthy', last_error_code = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND person_id = $2", [connectionId, personId]);
        return mapAccount(selectedResult.rows[0]);
      });
    },

    async getStatus(personId) {
      const result = await pool.query(`
        SELECT c.id AS connection_id, c.status, c.environment, c.last_attempt_at,
               c.last_success_at, c.consent_expiration_at, c.last_error_code,
               a.id AS account_id, a.provider_account_id, a.display_name, a.official_name,
               a.account_type, a.account_subtype, a.mask, a.selected,
               COUNT(et.id) FILTER (WHERE et.lifecycle_status = 'awaiting_review') AS review_count
        FROM financial_connections c
        LEFT JOIN financial_accounts a ON a.connection_id = c.id
        LEFT JOIN external_transactions et ON et.connection_id = c.id
        WHERE c.person_id = $1
        GROUP BY c.id, a.id
        ORDER BY c.id, a.id
      `, [personId]);
      const connections = new Map();
      for (const row of result.rows) {
        if (!connections.has(row.connection_id)) {
          connections.set(row.connection_id, {
            id: row.connection_id,
            status: row.status,
            environment: row.environment,
            lastAttemptAt: row.last_attempt_at,
            lastSuccessAt: row.last_success_at,
            consentExpirationAt: row.consent_expiration_at,
            lastErrorCode: row.last_error_code,
            reviewCount: Number(row.review_count || 0),
            accounts: []
          });
        }
        if (row.account_id) connections.get(row.connection_id).accounts.push(mapAccount({ ...row, id: row.account_id }));
      }
      return [...connections.values()];
    },

    async getActiveConnection(personId, connectionId, queryable = pool) {
      const result = await queryable.query(`
        SELECT c.*, a.id AS financial_account_id, a.provider_account_id
        FROM financial_connections c
        JOIN financial_accounts a ON a.connection_id = c.id AND a.selected = TRUE
        WHERE c.id = $1 AND c.person_id = $2 AND c.status IN ('healthy', 'error', 'attention_required')
      `, [connectionId, personId]);
      if (!result.rows.length) throw new Error('Active Plaid connection not found.');
      const row = result.rows[0];
      return {
        id: row.id,
        personId: row.person_id,
        financialAccountId: row.financial_account_id,
        providerAccountId: row.provider_account_id,
        cursor: row.sync_cursor,
        accessToken: decryptAccessToken(encryptedRecord(row), config.tokenEncryptionKey, config.environment)
      };
    },

    async disconnect(personId, connectionId) {
      const result = await pool.query(`
        SELECT id, environment, access_token_ciphertext, access_token_nonce,
               access_token_auth_tag, access_token_key_version
        FROM financial_connections
        WHERE id = $1 AND person_id = $2 AND status <> 'disconnected'
      `, [connectionId, personId]);
      if (!result.rows.length) throw new Error('Plaid connection not found.');
      const accessToken = decryptAccessToken(encryptedRecord(result.rows[0]), config.tokenEncryptionKey, config.environment);
      await plaidClient.removeItem(accessToken);
      const update = await pool.query(`
        UPDATE financial_connections SET
          status = 'disconnected', access_token_ciphertext = '', access_token_nonce = '',
          access_token_auth_tag = '', sync_cursor = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND person_id = $2
        RETURNING id
      `, [connectionId, personId]);
      return { id: update.rows[0].id, status: 'disconnected' };
    }
  };
}

module.exports = { createConnectionService };
