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
test('removing a credit assignment survives later automatic review',{skip:!process.env.PGLITE_TEST_MODULE},async()=>{
 const h=await reviewDb();try{
 await require('./helpers/review-db').seedOffer(h.db);
 await h.db.exec(`INSERT INTO transactions(person_id,date,amount,merchant,categories) VALUES(1,'2026-10-03',90,'Target',ARRAY['retail']);INSERT INTO account_events(person_id,event_date,amount,description,event_type,source_hash) VALUES(1,'2026-09-28',-4.5,'Statement Credit 10/01/26 - 10/31/26','credit','remove-me');`);
 const creditReview=createCreditReviewService({serializeOffer});await creditReview.reviewCredits(h.db,1);
 const id=(await h.db.query('SELECT id FROM offer_credits')).rows[0].id;
 const {withPersonLock}=require('../review-lock');
 const edits=createReviewedEditService({pool:h.pool,creditReview,onChanged:personId=>withPersonLock(h.pool,personId,c=>creditReview.reviewCredits(c,personId))});
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../server.js'),'utf8'),start=source.indexOf("app.delete('/api/offers/:offerId/credits/:creditId'");let handler;
 vm.runInNewContext(source.slice(start,source.indexOf('\n});',start)+5),{app:{delete:(_,fn)=>handler=fn},reviewedEdits:edits,console});
 await handler({params:{offerId:1,creditId:id}},{json(){},status(){return this}});
 assert.equal((await h.db.query('SELECT * FROM offer_credits')).rows.length,0);
 await withPersonLock(h.pool,1,c=>creditReview.reviewCredits(c,1));
 assert.equal((await h.db.query('SELECT * FROM offer_credits')).rows.length,0);
 }finally{await h.close()}
});
