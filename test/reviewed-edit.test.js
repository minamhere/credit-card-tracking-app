const test=require('node:test'),assert=require('node:assert/strict');
const {reviewDb,serializeOffer}=require('./helpers/review-db');
const {createCreditReviewService}=require('../credit-review-service');
const {createReviewedEditService}=require('../reviewed-edit-service');
test('manual category edits preserve raw source, explicitly teach rules, and trigger retry',{skip:!process.env.PGLITE_TEST_MODULE},async()=>{
 const h=await reviewDb();try{
 await h.db.exec("INSERT INTO transactions(person_id,date,amount,merchant,raw_merchant,categories) VALUES(1,'2026-10-01',20,'Cafe','RAW CAFE',ARRAY['general'])");
 let retries=0;const service=createReviewedEditService({pool:h.pool,creditReview:createCreditReviewService({serializeOffer}),onChanged:async id=>{assert.equal(id,1);retries++;}});
 await service.updateTransaction(1,{personId:1,date:'2026-10-01',amount:20,merchant:'Cafe',categories:['restaurant'],saveRule:true});
 assert.equal((await h.db.query('SELECT raw_merchant FROM transactions')).rows[0].raw_merchant,'RAW CAFE');
 assert.equal((await h.db.query('SELECT merchant_pattern FROM merchant_category_rules')).rows[0].merchant_pattern,'RAW CAFE');
 assert.equal(retries,1);assert.equal((await h.db.query('SELECT review_metadata FROM transactions')).rows[0].review_metadata.method,'manual');
 await assert.rejects(service.updateTransaction(1,{personId:2,date:'2026-10-01',amount:20,merchant:'Wrong',categories:['retail']}));
 assert.equal((await h.db.query('SELECT merchant FROM transactions')).rows[0].merchant,'Cafe');
 }finally{await h.close()}
});
