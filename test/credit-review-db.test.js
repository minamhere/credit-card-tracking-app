const test=require('node:test'),assert=require('node:assert/strict');
const {reviewDb,serializeOffer,seedOffer}=require('./helpers/review-db');
const {createCreditReviewService}=require('../credit-review-service');
test('credits persist earned month and evidence exactly once; duplicate twins stay visible',{skip:!process.env.PGLITE_TEST_MODULE},async()=>{
 const h=await reviewDb();try {
 await seedOffer(h.db);
 await h.db.exec(`INSERT INTO transactions(person_id,date,amount,merchant,categories) VALUES(1,'2026-10-03',75,'Target',ARRAY['retail']),(1,'2026-10-03',15,'Target',ARRAY['retail']);
 INSERT INTO account_events(person_id,event_date,amount,description,event_type,source_hash) VALUES(1,'2026-09-28',-4.50,'Statement Credit 10/01/26 - 10/31/26','credit','credit-1');`);
 const service=createCreditReviewService({serializeOffer});
 await h.db.exec('BEGIN');const first=await service.reviewCredits(h.db,1);await h.db.exec('COMMIT');assert.equal(first.length,1);
 const saved=(await h.db.query('SELECT * FROM offer_credits')).rows[0];assert.equal(saved.reward_month,'2026-10');assert.deepEqual(saved.match_evidence.transactionIds,[1,2]);
 assert.equal((await service.reviewCredits(h.db,1)).length,0);
 await h.db.exec(`INSERT INTO account_events(person_id,event_date,amount,description,event_type,source_hash) VALUES(1,'2026-09-28',-4.50,'Statement Credit 10/01/26 - 10/31/26','credit','duplicate');`);
 assert.equal((await service.reviewCredits(h.db,1)).length,0);
 assert.match((await h.db.query("SELECT review_reason FROM account_events WHERE source_hash='duplicate'")).rows[0].review_reason,/duplicate/i);
 assert.equal((await h.db.query('SELECT * FROM offer_credits')).rows.length,1);
 await h.db.exec("UPDATE transactions SET categories=ARRAY['healthcare'] WHERE id=1");await service.flagInvalidEvidence(h.db,1);
 assert.equal((await h.db.query('SELECT match_evidence FROM offer_credits')).rows[0].match_evidence.status,'needs_review');
 }finally{await h.close()}
});
test('offer changes invalidate earlier evidence even when the new reward is larger',{skip:!process.env.PGLITE_TEST_MODULE},async()=>{
 const h=await reviewDb();try{
 await seedOffer(h.db);await h.db.exec(`INSERT INTO transactions(person_id,date,amount,merchant,categories) VALUES(1,'2026-10-03',90,'Target',ARRAY['retail']);INSERT INTO account_events(person_id,event_date,amount,description,event_type,source_hash) VALUES(1,'2026-09-28',-4.50,'Statement Credit 10/01/26 - 10/31/26','credit','c1');`);
 const service=createCreditReviewService({serializeOffer});await service.reviewCredits(h.db,1);
 await h.db.exec(`UPDATE offers SET reward_config='{"kind":"percentage","rate":10,"cap":80}'`);await service.flagInvalidEvidence(h.db,1);
 const c=(await h.db.query('SELECT amount,match_evidence FROM offer_credits')).rows[0];assert.equal(c.match_evidence.status,'needs_review');assert.equal(Number(c.amount),4.5);
 }finally{await h.close()}
});
