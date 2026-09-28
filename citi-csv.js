(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.CitiCsv = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    function parseDelimited(text, delimiter = ',') {
        const rows = [];
        let row = [];
        let field = '';
        let quoted = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const next = text[i + 1];
            if (char === '"' && quoted && next === '"') {
                field += '"';
                i++;
            } else if (char === '"') {
                quoted = !quoted;
            } else if (char === delimiter && !quoted) {
                row.push(field.trim());
                field = '';
            } else if ((char === '\n' || char === '\r') && !quoted) {
                if (char === '\r' && next === '\n') i++;
                row.push(field.trim());
                if (row.some(value => value !== '')) rows.push(row);
                row = [];
                field = '';
            } else {
                field += char;
            }
        }
        row.push(field.trim());
        if (row.some(value => value !== '')) rows.push(row);
        return rows;
    }

    function parseCsv(text) {
        return parseDelimited(text, ',');
    }

    function normalizeHeader(value) {
        return value.replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function parseMoney(value) {
        if (value == null || String(value).trim() === '') return null;
        const raw = String(value).trim();
        const negative = /^\(.*\)$/.test(raw) || /^\$?-/.test(raw);
        const amount = Number(raw.replace(/[$,()\s]/g, '').replace(/^[+-]/, ''));
        return Number.isFinite(amount) ? (negative ? -amount : amount) : null;
    }

    function normalizeDate(value) {
        const raw = String(value || '').replace(/^\uFEFF/, '').trim();
        let match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
        if (match) {
            let year = Number(match[3]);
            if (year < 100) year += year >= 70 ? 1900 : 2000;
            return `${year}-${String(match[1]).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`;
        }
        match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        return match ? `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}` : null;
    }

    function findColumn(headers, candidates) {
        const normalized = headers.map(normalizeHeader);
        for (const candidate of candidates) {
            const index = normalized.indexOf(normalizeHeader(candidate));
            if (index >= 0) return index;
        }
        return -1;
    }

    // Stable non-cryptographic fallback for HTTP deployments where browsers do
    // not expose crypto.subtle. This fingerprint is for import audit/deduping,
    // not password or security use.
    function fingerprintText(text) {
        let hash = 0x811c9dc5;
        const value = String(text || '');
        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`;
    }

    function parseCitiTransactions(text) {
        const firstLine = String(text || '').split(/\r?\n/, 1)[0];
        const isHeaderlessTabExport = firstLine.includes('\t');
        const rows = parseDelimited(text, isHeaderlessTabExport ? '\t' : ',');
        if (!rows.length) throw new Error('The CSV does not contain any transaction rows.');

        if (isHeaderlessTabExport) {
            const transactions = [];
            const errors = [];
            rows.forEach((row, rowIndex) => {
                const date = normalizeDate(row[0]);
                const amount = parseMoney(row[1]);
                const merchant = String(row[2] || '').trim();
                const transactionType = String(row[3] || '').trim().toLowerCase();
                if (row.length !== 4 || !date || amount == null || !merchant || !transactionType) {
                    errors.push({ row: rowIndex + 1, message: 'Expected date, amount, merchant, and transaction type.' });
                    return;
                }
                transactions.push({
                    date,
                    amount,
                    merchant,
                    description: transactionType,
                    transactionType,
                    isCredit: amount < 0 || transactionType !== 'purchase'
                });
            });
            return { transactions, errors, headers: [], format: 'citi-tab-export' };
        }

        if (rows.length < 2) throw new Error('The CSV does not contain any transaction rows.');

        const headers = rows[0];
        const dateIndex = findColumn(headers, ['Date', 'Transaction Date', 'Posted Date']);
        const descriptionIndex = findColumn(headers, ['Description', 'Merchant', 'Transaction Description']);
        const debitIndex = findColumn(headers, ['Debit', 'Debit Amount']);
        const creditIndex = findColumn(headers, ['Credit', 'Credit Amount']);
        const amountIndex = findColumn(headers, ['Amount', 'Transaction Amount']);
        const statusIndex = findColumn(headers, ['Status']);

        if (dateIndex < 0 || descriptionIndex < 0 || (debitIndex < 0 && amountIndex < 0)) {
            throw new Error(`Unsupported CSV columns. Found: ${headers.join(', ')}`);
        }

        const transactions = [];
        const errors = [];
        rows.slice(1).forEach((row, rowIndex) => {
            const date = normalizeDate(row[dateIndex]);
            const merchant = String(row[descriptionIndex] || '').trim();
            const debit = debitIndex >= 0 ? parseMoney(row[debitIndex]) : null;
            const credit = creditIndex >= 0 ? parseMoney(row[creditIndex]) : null;
            let amount = debit != null ? Math.abs(debit) : parseMoney(row[amountIndex]);
            const isCredit = debit == null && credit != null;
            if (isCredit) amount = -Math.abs(credit);

            if (!date || !merchant || amount == null) {
                errors.push({ row: rowIndex + 2, message: 'Missing or invalid date, description, or amount.' });
                return;
            }
            transactions.push({
                date,
                merchant,
                amount,
                description: statusIndex >= 0 ? String(row[statusIndex] || '').trim() : '',
                transactionType: isCredit ? 'credit' : 'purchase',
                isCredit
            });
        });

        return { transactions, errors, headers, format: 'citi-column-export' };
    }

    return { parseCsv, parseDelimited, parseMoney, normalizeDate, fingerprintText, parseCitiTransactions };
});
