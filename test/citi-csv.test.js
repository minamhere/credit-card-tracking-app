const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCitiTransactions } = require('../citi-csv');

test('parses Citi debit and credit columns, quoted merchants, and dates', () => {
    const csv = `Status,Date,Description,Debit,Credit\nCleared,09/21/2026,"GROCERY, MARKET",42.17,\nCleared,09/22/2026,PAYMENT THANK YOU,,100.00\n`;
    const result = parseCitiTransactions(csv);
    assert.deepEqual(result.transactions, [
        { date: '2026-09-21', merchant: 'GROCERY, MARKET', amount: 42.17, description: 'Cleared', transactionType: 'purchase', isCredit: false },
        { date: '2026-09-22', merchant: 'PAYMENT THANK YOU', amount: -100, description: 'Cleared', transactionType: 'credit', isCredit: true }
    ]);
});

test('parses Citi headerless tab exports with a BOM', () => {
    const csv = '\uFEFF09/27/2026\t$66.18\tTARGET T-1501\tpurchase\n08/29/2026\t$-75.29\tStatement Credit\tspecific credit amount adjustment';
    const result = parseCitiTransactions(csv);
    assert.equal(result.format, 'citi-tab-export');
    assert.deepEqual(result.transactions, [
        { date: '2026-09-27', amount: 66.18, merchant: 'TARGET T-1501', description: 'purchase', transactionType: 'purchase', isCredit: false },
        { date: '2026-08-29', amount: -75.29, merchant: 'Statement Credit', description: 'specific credit amount adjustment', transactionType: 'specific credit amount adjustment', isCredit: true }
    ]);
});

test('parses full statement payment and interest rows', () => {
    const csv = '\uFEFF08/24/2026\t$-304.09\tAUTOPAY PAYMENT THANK YOU IL\tpayment\n08/28/2026\t$0.00\tINTEREST CHARGE ON PURCHASES\tinterest charged';
    const result = parseCitiTransactions(csv);
    assert.equal(result.transactions[0].transactionType, 'payment');
    assert.equal(result.transactions[1].transactionType, 'interest charged');
    assert.ok(result.transactions.every(row => row.isCredit));
});

test('reports malformed rows without discarding valid rows', () => {
    const result = parseCitiTransactions('Date,Description,Debit\n09/21/2026,STORE,12.50\nbad,,x');
    assert.equal(result.transactions.length, 1);
    assert.equal(result.errors[0].row, 3);
});
