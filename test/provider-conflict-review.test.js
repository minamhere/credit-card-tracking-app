const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {reviewDb,serializeOffer,seedOffer}=require('./helpers/review-db');
const {createCreditReviewService}=require('../credit-review-service');
const {createReviewedEditService}=require('../reviewed-edit-service');
test('accepted provider corrections flag stale credit evidence under the cardholder lock',{skip:!process.env.PGLITE_TEST_MODULE},async()=>{
 const h=await reviewDb();try{
 await seedOffer(h.db);await h.db.exec(`INSERT INTO transactions(person_id,date,amount,merchant,categories) VALUES(1,'2026-10-03',90,'Target',ARRAY['retail']);INSERT INTO account_events(person_id,event_date,amount,description,event_type,source_hash) VALUES(1,'2026-09-28',-4.5,'Statement Credit 10/01/26 - 10/31/26','credit','correction');
 INSERT INTO financial_connections(id,person_id,provider_item_id,environment,access_token_ciphertext,access_token_nonce,access_token_auth_tag,status) VALUES(1,1,'item','production','x','y','z','healthy');
 INSERT INTO financial_accounts(id,connection_id,provider_account_id,display_name,selected) VALUES(1,1,'account','Card',TRUE);
 INSERT INTO external_transactions(id,provider_transaction_id,connection_id,financial_account_id,person_id,transaction_date,amount,raw_description,merchant_name,transaction_kind,lifecycle_status,linked_transaction_id,conflict_reason) VALUES(1,'provider',1,1,1,'2026-10-03',100,'TARGET RAW','Target','purchase','conflicted',1,'provider_modified');`);
 const creditReview=createCreditReviewService({serializeOffer});await creditReview.reviewCredits(h.db,1);
 const source=fs.readFileSync(require.resolve('../server.js'),'utf8'),start=source.indexOf("app.post('/api/plaid/conflicts/:id/resolve'");let handler;
 vm.runInNewContext(source.slice(start,source.indexOf('\n});',start)+5),{app:{post:(_,fn)=>handler=fn},requirePlaid:()=>true,pool:h.pool,positiveInteger:Number,plaidConfig:{environment:'production'},projectExternalTransaction:require('../transaction-reconciliation').projectExternalTransaction,CreditMatcher:require('../credit-matcher'),creditReview,reviewedEdits:createReviewedEditService({pool:h.pool,creditReview}),plaidRouteError:(_,e)=>{throw e}});
 await handler({body:{personId:1,action:'update'},params:{id:1}},{json(){},status(){return this}});
 const c=(await h.db.query('SELECT * FROM offer_credits')).rows[0];assert.equal(Number(c.amount),4.5);assert.equal(c.match_evidence.status,'needs_review');
 }finally{await h.close()}
});
