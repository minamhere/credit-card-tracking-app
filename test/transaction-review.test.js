const test=require('node:test'),assert=require('node:assert/strict');
const {reviewDb,serializeOffer}=require('./helpers/review-db');
const {createCreditReviewService}=require('../credit-review-service');
const {createTransactionImportService}=require('../transaction-import-service');
const {createTransactionReviewService}=require('../transaction-review-service');
test('automatic review imports trusted current-account rows, leaves uncertainty, and is repeatable',{skip:!process.env.PGLITE_TEST_MODULE},async()=>{
 const h=await reviewDb();try{
 await h.db.exec(`INSERT INTO financial_connections(id,person_id,provider_item_id,environment,access_token_ciphertext,access_token_nonce,access_token_auth_tag,status,import_start_date) VALUES(1,1,'item','production','x','y','z','healthy','2026-09-01');
 INSERT INTO financial_accounts(id,connection_id,provider_account_id,display_name,selected) VALUES(1,1,'account','Card',TRUE),(2,1,'other','Other',FALSE);
 INSERT INTO external_transactions(id,provider_transaction_id,connection_id,financial_account_id,person_id,transaction_date,amount,raw_description,transaction_kind,lifecycle_status,pending,item_generation) VALUES
 (1,'known',1,1,1,'2026-10-03',75,'TARGET #1','purchase','awaiting_review',FALSE,1),
 (2,'unknown',1,1,1,'2026-10-03',15,'UNKNOWN SHOP','purchase','awaiting_review',FALSE,1),
 (3,'pending',1,1,1,'2026-10-03',15,'TARGET #1','purchase','staged',TRUE,1),
 (4,'other-account',1,2,1,'2026-10-03',15,'TARGET #1','purchase','awaiting_review',FALSE,1),
 (5,'old-generation',1,1,1,'2026-10-03',15,'TARGET #1','purchase','awaiting_review',FALSE,2),
 (6,'before-cutoff',1,1,1,'2026-08-03',15,'TARGET #1','purchase','awaiting_review',FALSE,1),
 (7,'other-person',1,1,2,'2026-10-03',15,'TARGET #1','purchase','awaiting_review',FALSE,1);`);
 const creditReview=createCreditReviewService({serializeOffer}),importService=createTransactionImportService({pool:h.pool,creditReview,environment:'production'});
 const service=createTransactionReviewService({pool:h.pool,importService,creditReview,environment:'production'});
 const first=await service.reviewPerson(1);assert.equal(first.imported,1);assert.equal(first.remainingReviewCount,1);
 assert.match(first.reasons[0].reason,/Unknown/);
 assert.equal((await service.reviewPerson(1)).imported,0);
 await h.db.exec("INSERT INTO merchant_category_rules(merchant_pattern,merchant_name,categories) VALUES('UNKNOWN SHOP','Known shop',ARRAY['retail'])");
 assert.equal((await service.reviewPerson(1)).imported,1);
 assert.equal((await h.db.query('SELECT * FROM merchant_category_rules')).rows.length,1);
 assert.equal((await h.db.query('SELECT * FROM transactions')).rows.length,2);
 assert.equal((await h.db.query('SELECT review_metadata FROM transactions LIMIT 1')).rows[0].review_metadata.method,'automatic');
 await h.db.exec("INSERT INTO external_transactions(id,provider_transaction_id,connection_id,financial_account_id,person_id,transaction_date,amount,raw_description,transaction_kind,lifecycle_status) VALUES(8,'disabled',1,1,1,'2026-10-05',20,'TARGET #1','purchase','awaiting_review')");
 const disabled=createTransactionReviewService({pool:h.pool,importService,creditReview,environment:'production',enabled:false});assert.equal((await disabled.reviewPerson(1)).imported,0);
 }finally{await h.close()}
});
