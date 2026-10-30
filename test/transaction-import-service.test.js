const test=require('node:test'),assert=require('node:assert/strict');
const {reviewDb,serializeOffer}=require('./helpers/review-db');
const {createCreditReviewService}=require('../credit-review-service');
const {createTransactionImportService}=require('../transaction-import-service');
test('reviewed CSV imports preserve original data and repeated runs are idempotent',{skip:!process.env.PGLITE_TEST_MODULE},async()=>{
 const h=await reviewDb();try {
 const service=createTransactionImportService({pool:h.pool,creditReview:createCreditReviewService({serializeOffer}),environment:'production'});
 const item={date:'2026-10-03',amount:75,merchant:'Target',originalMerchant:'TARGET RAW',categories:['retail'],saveRule:true};
 const input={personId:1,transactions:[item],accountEvents:[]};
 assert.equal((await service.importReviewed(input)).imported,1);
 assert.equal((await service.importReviewed(input)).imported,0);
 assert.equal((await h.db.query('SELECT raw_merchant FROM transactions')).rows[0].raw_merchant,'TARGET RAW');
 assert.equal((await h.db.query('SELECT * FROM merchant_category_rules')).rows.length,1);
 const both=await Promise.all([service.importReviewed({...input,transactions:[{...item,amount:15}]}),service.importReviewed({...input,transactions:[{...item,amount:15}]})]);
 assert.equal(both.reduce((s,r)=>s+r.imported,0),1);
 assert.equal((await h.db.query('SELECT * FROM transactions')).rows.length,2);
 await assert.rejects(service.importReviewed({...input,transactions:null}));
 assert.equal((await h.db.query('SELECT * FROM transactions')).rows.length,2);
 }finally{await h.close()}
});
test('provider imports enforce stale-preview and generation boundaries and retain manual cross-source categories',{skip:!process.env.PGLITE_TEST_MODULE},async()=>{
 const h=await reviewDb();try {
 await h.db.exec(`INSERT INTO financial_connections(id,person_id,provider_item_id,environment,access_token_ciphertext,access_token_nonce,access_token_auth_tag,status,import_start_date) VALUES(1,1,'item','production','x','y','z','healthy','2026-09-01');
 INSERT INTO financial_accounts(id,connection_id,provider_account_id,display_name,account_type,account_subtype,selected) VALUES(1,1,'account','Card','credit','credit card',TRUE);
 INSERT INTO external_transactions(id,provider_transaction_id,connection_id,financial_account_id,person_id,transaction_date,amount,raw_description,merchant_name,transaction_kind,lifecycle_status) VALUES(1,'provider-1',1,1,1,'2026-10-03',75,'TARGET RAW','Target','purchase','awaiting_review');`);
 const service=createTransactionImportService({pool:h.pool,creditReview:createCreditReviewService({serializeOffer}),environment:'production'});
 const current=(await h.db.query('SELECT updated_at FROM external_transactions')).rows[0].updated_at;
 const input={personId:1,transactions:[{externalTransactionId:1,externalUpdatedAt:'2000-01-01',date:'2026-10-03',amount:75,merchant:'Target',categories:['retail']}]};
 assert.equal((await service.importReviewed(input)).imported,0);
 input.transactions[0].externalUpdatedAt=current;
 await h.db.exec('UPDATE external_transactions SET item_generation=2');
 assert.equal((await service.importReviewed(input)).imported,0);
 await h.db.exec("UPDATE external_transactions SET item_generation=1; INSERT INTO transactions(person_id,date,amount,merchant,raw_merchant,categories,source) VALUES(1,'2026-10-03',75,'Target','TARGET RAW',ARRAY['online'],'manual')");
 assert.equal((await service.importReviewed(input)).imported,0);
 assert.equal((await h.db.query('SELECT * FROM transactions')).rows.length,1);
 assert.deepEqual((await h.db.query('SELECT categories FROM transactions')).rows[0].categories,['online']);
 assert.equal((await h.db.query('SELECT linked_transaction_id FROM external_transactions')).rows[0].linked_transaction_id,1);
 }finally{await h.close()}
});
