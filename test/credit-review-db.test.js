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
test('changed credit amounts and earlier cap-consuming purchases invalidate the allocation ledger',{skip:!process.env.PGLITE_TEST_MODULE},async()=>{
 const h=await reviewDb();try{
 await seedOffer(h.db);await h.db.exec(`UPDATE offers SET reward_config='{"kind":"percentage","rate":5,"cap":5}';INSERT INTO transactions(person_id,date,amount,merchant,categories) VALUES(1,'2026-10-10',100,'Target',ARRAY['retail']);INSERT INTO account_events(person_id,event_date,amount,description,event_type,source_hash) VALUES(1,'2026-09-28',-5,'Statement Credit 10/01/26 - 10/31/26','credit','budget');`);
 const service=createCreditReviewService({serializeOffer});await service.reviewCredits(h.db,1);
 const original=(await h.db.query('SELECT * FROM offer_credits')).rows[0];
 await h.db.exec('UPDATE offer_credits SET amount=4');await service.flagInvalidEvidence(h.db,1);
 assert.equal((await h.db.query('SELECT match_evidence FROM offer_credits')).rows[0].match_evidence.status,'needs_review');
 await h.db.query('UPDATE offer_credits SET amount=5,match_evidence=$1',[original.match_evidence]);
 await h.db.exec("INSERT INTO transactions(person_id,date,amount,merchant,categories) VALUES(1,'2026-10-01',100,'Target',ARRAY['retail'])");await service.flagInvalidEvidence(h.db,1);
 const updated=(await h.db.query('SELECT * FROM offer_credits')).rows[0];assert.equal(updated.match_evidence.status,'needs_review');assert.equal(Number(updated.amount),5);assert.deepEqual(updated.match_evidence.allocations,original.match_evidence.allocations);
 }finally{await h.close()}
});
test('Home Depot legacy repair runs once and preserves exact and later manual overrides',{skip:!process.env.PGLITE_TEST_MODULE},async()=>{
 const h=await reviewDb();try{
 const sql=require('node:fs').readFileSync(require('node:path').join(__dirname,'../migrations.sql'),'utf8');
 await h.db.exec("DELETE FROM app_migration_history WHERE migration_key='home_depot_exclusion_2026_10_29'; INSERT INTO merchant_category_rules(merchant_pattern,merchant_name,match_type,categories) VALUES('THE HOME DEPOT #1510','Home Depot','contains',ARRAY['retail']),('HOME DEPOT ONLINE','Home Depot','exact',ARRAY['retail'])");
 await h.db.exec(sql);
 const rules=(await h.db.query('SELECT * FROM merchant_category_rules ORDER BY id')).rows;
 assert.deepEqual(rules[0].categories,['retail','home-improvement']);assert.deepEqual(rules[1].categories,['retail']);
 await h.db.exec("UPDATE merchant_category_rules SET categories=ARRAY['retail']");await h.db.exec(sql);
 assert.deepEqual((await h.db.query('SELECT categories FROM merchant_category_rules ORDER BY id')).rows[0].categories,['retail']);
 }finally{await h.close()}
});
test('cent-exact posted totals do not invalidate valid decimal allocations',{skip:!process.env.PGLITE_TEST_MODULE},async()=>{
 const h=await reviewDb();try{
 await seedOffer(h.db);await h.db.exec(`UPDATE offers SET reward_config='{"kind":"percentage","rate":10,"cap":80}';INSERT INTO transactions(person_id,date,amount,merchant,categories) VALUES(1,'2026-10-01',1,'Target',ARRAY['retail']),(1,'2026-10-02',1,'Target',ARRAY['retail']),(1,'2026-10-03',1,'Target',ARRAY['retail']);`);
 for(const id of [1,2,3])await h.db.query('INSERT INTO offer_credits(offer_id,amount,reward_month,match_evidence) VALUES(1,0.10,$1,$2)',['2026-10',{version:1,assignmentMethod:'automatic',status:'matched',creditedAmount:.1,rewardMonth:'2026-10',transactionIds:[id],allocations:[{transactionId:id,amount:.1}]}]);
 await createCreditReviewService({serializeOffer}).flagInvalidEvidence(h.db,1);
 assert.equal((await h.db.query("SELECT * FROM offer_credits WHERE match_evidence->>'status'='needs_review'")).rows.length,0);
 }finally{await h.close()}
});
