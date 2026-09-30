(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PlaidUi = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    function renderPlaidConnections(connections, escapeHtml) {
        if (!connections.length) return '<button type="button" class="btn-primary" data-action="connect">Connect Citi</button>';
        return connections.map(connection => {
            if (connection.status === 'account_selection') {
                const choices = connection.accounts.filter(account => account.type === 'credit' && account.subtype === 'credit card').map(account => `
                    <label class="plaid-account-choice"><input type="radio" name="plaid-account-${connection.id}" value="${account.id}">
                    ${escapeHtml(account.name)} •••• ${escapeHtml(account.mask || '----')}</label>`).join('');
                return `<div class="plaid-connection" data-connection-id="${connection.id}"><p>Select the one Citi card to track.</p>${choices}<button type="button" data-action="select-account">Use selected card</button></div>`;
            }
            if (connection.status === 'attention_required') {
                return `<div class="plaid-connection warning" data-connection-id="${connection.id}"><p>This Citi connection needs attention${connection.lastErrorCode ? ` (${escapeHtml(connection.lastErrorCode)})` : ''}.</p><button type="button" data-action="reconnect">Reconnect</button></div>`;
            }
            const selected = connection.accounts.find(account => account.selected);
            const ignored = connection.accounts.filter(account => !account.selected).length;
            const reviewCount = Number(connection.reviewCount || 0);
            return `<div class="plaid-connection" data-connection-id="${connection.id}">
                <strong>${selected ? `${escapeHtml(selected.name)} •••• ${escapeHtml(selected.mask || '----')}` : 'Citi connection'}</strong>
                <p>Last successful sync: ${connection.lastSuccessAt ? escapeHtml(connection.lastSuccessAt) : 'Not yet synced'}</p>
                ${ignored ? `<p>${ignored} additional account${ignored === 1 ? ' is' : 's are'} ignored.</p>` : ''}
                <p>${reviewCount} transaction${reviewCount === 1 ? '' : 's'} awaiting review</p>
                <div class="plaid-actions"><button type="button" data-action="sync">Sync now</button><button type="button" data-action="review">Review transactions</button><button type="button" data-action="disconnect" class="btn-secondary">Disconnect</button></div>
            </div>`;
        }).join('');
    }
    return { renderPlaidConnections };
});
