const {withPersonLock}=require('./review-lock');
const {normalizeMerchant}=require('./transaction-reconciliation');
function createReviewedEditService({pool,creditReview,onChanged}) {
 async function retry(personId) {
  try {return await onChanged?.(Number(personId));}catch(_){const summary={reviewError:'Saved successfully, but automatic review failed; retry review',reviewedAt:new Date().toISOString()};await pool.query('UPDATE financial_connections SET last_review_summary=$1 WHERE person_id=$2',[summary,Number(personId)]).catch(()=>{});return summary;}
 }
 async function mutate(personId,work) {
  const result=await withPersonLock(pool,personId,async(client,id)=>{const value=await work(client,id);await creditReview.flagInvalidEvidence(client,id);return value;});
  const review=await retry(personId);return {result,review};
 }
 async function query(personId,sql,params) {return (await mutate(personId,client=>client.query(sql,params))).result;}
 async function forOwner(table,rowId,work) {
  if(!['offers','transactions'].includes(table))throw new Error('Invalid owner table');
  const owner=(await pool.query(`SELECT person_id FROM ${table} WHERE id=$1`,[rowId])).rows[0];
  if(!owner)throw Object.assign(new Error('Record not found'),{status:404});
  return mutate(owner.person_id,work);
 }
 async function updateTransaction(transactionId,input) {
  return (await mutate(input.personId,async(client,id)=>{
   if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date||'')||!Number.isFinite(Number(input.amount))||Number(input.amount)<=0||!String(input.merchant||'').trim()||!Array.isArray(input.categories))throw new Error('A valid date, positive amount, merchant and categories are required');
   const existing=(await client.query('SELECT * FROM transactions WHERE id=$1 AND person_id=$2 FOR UPDATE',[transactionId,id])).rows[0];
   if(!existing)throw Object.assign(new Error('Transaction not found'),{status:404});
   const categories=[...new Set(input.categories.map(c=>String(c).trim().toLowerCase()).filter(Boolean))];
   const transaction=(await client.query('UPDATE transactions SET date=$1,amount=$2,merchant=$3,categories=$4,description=$5,review_metadata=$6 WHERE id=$7 AND person_id=$8 RETURNING *',[input.date,Number(input.amount),String(input.merchant).trim(),categories,input.description||'',{method:'manual',reason:'Manually corrected'},transactionId,id])).rows[0];
   if(input.saveRule&&categories.length)await client.query(`INSERT INTO merchant_category_rules(merchant_pattern,merchant_name,match_type,categories) VALUES($1,$2,'contains',$3) ON CONFLICT(merchant_pattern,match_type) DO UPDATE SET merchant_name=EXCLUDED.merchant_name,categories=EXCLUDED.categories,updated_at=CURRENT_TIMESTAMP`,[normalizeMerchant(existing.raw_merchant||existing.merchant),transaction.merchant,categories]);
   return transaction;
  })).result;
 }
 async function removeCredit(offerId,creditId) {
  return (await forOwner('offers',offerId,async client=>{
   await client.query('UPDATE account_events SET review_suppressed=TRUE,review_reason=$1 WHERE assigned_offer_credit_id=$2 AND person_id=(SELECT person_id FROM offers WHERE id=$3)', ['Credit assignment removed manually; automatic matching is disabled for this event',creditId,offerId]);
   const result=await client.query('DELETE FROM offer_credits WHERE id=$1 AND offer_id=$2 RETURNING id',[creditId,offerId]);
   if(!result.rows.length)throw Object.assign(new Error('Offer credit not found'),{status:404});
   return result;
  })).result;
 }
 async function assignCreditMonth({personId,offerId,creditId,rewardMonth=null}) {
  return (await mutate(personId,async(client,id)=>{
   const offer=(await client.query('SELECT * FROM offers WHERE id=$1 AND person_id=$2',[offerId,id])).rows[0];
   if(!offer)throw Object.assign(new Error('Offer not found for this cardholder'),{status:404});
   if(rewardMonth&&(!offer.monthly_tracking||!/^\d{4}-(0[1-9]|1[0-2])$/.test(rewardMonth)||rewardMonth<String(offer.start_date).slice(0,7)||rewardMonth>String(offer.end_date).slice(0,7)))throw new Error('Choose an earned month within this monthly offer');
   const result=(await client.query('UPDATE offer_credits SET reward_month=$1 WHERE id=$2 AND offer_id=$3 RETURNING id',[rewardMonth,creditId,offerId])).rows[0];
   if(!result)throw Object.assign(new Error('Offer credit not found'),{status:404});
   return {id:result.id,rewardMonth};
  })).result;
 }
 return {mutate,query,forOwner,updateTransaction,assignCreditMonth,removeCredit,retry};
}
module.exports={createReviewedEditService};
