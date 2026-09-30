class PlaidServiceError extends Error {
  constructor(code, requestId) {
    super(code ? `Plaid request failed (${code}).` : 'Plaid request failed.');
    this.name = 'PlaidServiceError';
    this.code = code || 'PLAID_ERROR';
    this.requestId = requestId || null;
  }

  toJSON() {
    return { name: this.name, code: this.code, requestId: this.requestId };
  }
}

function safeError(error) {
  const data = error && error.response && error.response.data;
  return new PlaidServiceError(data && data.error_code, data && data.request_id);
}

function createPlaidClient(config, sdk = require('plaid')) {
  const basePath = sdk.PlaidEnvironments[config.environment];
  if (!basePath) throw new Error('Plaid environment is not supported.');
  const configuration = new sdk.Configuration({
    basePath,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': config.clientId,
        'PLAID-SECRET': config.secret
      }
    }
  });
  const api = new sdk.PlaidApi(configuration);

  async function call(fn) {
    try {
      return await fn();
    } catch (error) {
      throw safeError(error);
    }
  }

  return {
    async createLinkToken(personId) {
      const response = await call(() => api.linkTokenCreate({
        user: { client_user_id: `person-${personId}` },
        client_name: 'Credit Card Offer Tracker',
        products: ['transactions'],
        transactions: { days_requested: 730 },
        country_codes: ['US'],
        language: 'en'
      }));
      return { linkToken: response.data.link_token, expiration: response.data.expiration, requestId: response.data.request_id };
    },

    async createUpdateLinkToken(accessToken, personId) {
      const response = await call(() => api.linkTokenCreate({
        user: { client_user_id: `person-${personId}` },
        client_name: 'Credit Card Offer Tracker',
        access_token: accessToken,
        country_codes: ['US'],
        language: 'en'
      }));
      return { linkToken: response.data.link_token, expiration: response.data.expiration, requestId: response.data.request_id };
    },

    async exchangePublicToken(publicToken) {
      const response = await call(() => api.itemPublicTokenExchange({ public_token: publicToken }));
      return { accessToken: response.data.access_token, itemId: response.data.item_id, requestId: response.data.request_id };
    },

    async getAccounts(accessToken) {
      const response = await call(() => api.accountsGet({ access_token: accessToken }));
      return response.data.accounts.map(account => ({
        accountId: account.account_id,
        name: account.name,
        officialName: account.official_name || null,
        type: account.type,
        subtype: account.subtype || null,
        mask: account.mask || null,
        persistentAccountId: account.persistent_account_id || null
      }));
    },

    async getItem(accessToken) {
      const response = await call(() => api.itemGet({ access_token: accessToken }));
      return {
        itemId: response.data.item.item_id,
        consentExpirationTime: response.data.item.consent_expiration_time || null,
        lastSuccessfulUpdate: response.data.status?.transactions?.last_successful_update || null,
        requestId: response.data.request_id
      };
    },

    async removeItem(accessToken) {
      const response = await call(() => api.itemRemove({ access_token: accessToken }));
      return { removed: Boolean(response.data.removed), requestId: response.data.request_id };
    },

    async syncTransactions(accessToken, cursor = null) {
      const request = { access_token: accessToken, count: 500 };
      if (cursor) request.cursor = cursor;
      const response = await call(() => api.transactionsSync(request));
      return {
        added: response.data.added || [],
        modified: response.data.modified || [],
        removed: response.data.removed || [],
        nextCursor: response.data.next_cursor,
        hasMore: Boolean(response.data.has_more),
        requestId: response.data.request_id
      };
    }
  };
}

module.exports = { createPlaidClient, PlaidServiceError };
