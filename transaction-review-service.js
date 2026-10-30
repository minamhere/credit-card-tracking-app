const {withPersonLock}=require('./review-lock');
const {classifyMerchant}=require('./merchant-classifier');
const {projectExternalTransaction}=require('./transaction-reconciliation');
function createTransactionReviewService({pool,importService,creditReview,environment='production',enabled=process.env.TRANSACTION_AUTO_REVIEW!=='false'}) {
 async function reviewPerson(personId,{connectionId=null}={}) {
  return withPersonLock(pool,personId,async(client,id)=>{
   const rules=(await client.query('SELECT * FROM merchant_category_rules ORDER BY id')).rows;
   const rows=(await client.query(`SELECT et.* FROM external_transactions et
    JOIN financial_connections c ON c.id=et.connection_id AND c.person_id=et.person_id
    JOIN financial_accounts a ON a.id=et.financial_account_id AND a.connection_id=c.id
    WHERE et.person_id=$1 AND c.environment=$2 AND c.status IN ('healthy','error')
      AND a.selected=TRUE AND a.available=TRUE AND et.item_generation=c.item_generation
      AND et.pending=FALSE AND et.lifecycle_status='awaiting_review'
      AND et.transaction_date>=c.import_start_date AND ($3::integer IS NULL OR c.id=$3)
    ORDER BY et.transaction_date,et.id FOR UPDATE OF et`,[id,environment,connectionId])).rows;
   const purchases=[],events=[],reasons=[];
   for(const row of rows) {
    const item=projectExternalTransaction(row);
    if(!item||!/^\d{4}-\d{2}-\d{2}$/.test(item.date)||!Number.isFinite(item.amount)){reasons.push({externalTransactionId:row.id,reason:'Invalid provider record'});continue;}
    if(row.transaction_kind==='purchase') {
     const classification=classifyMerchant(row.raw_description,rules);
     if(!classification.confident||item.amount<=0){reasons.push({externalTransactionId:row.id,reason:classification.reason});continue;}
     purchases.push({...item,merchant:classification.merchant,categories:classification.categories,matchedRuleId:classification.matchedRuleId,reviewReason:classification.reason});
    } else if(['payment','refund','credit','interest','fee'].includes(row.transaction_kind))events.push(item);
    else reasons.push({externalTransactionId:row.id,reason:'Unrecognized account event'});
   }
   let result={imported:0,eventsImported:0,skipped:0,autoMatchedCredits:[]};
   if(enabled&&(purchases.length||events.length))result=await importService.importInTransaction(client,{personId:id,transactions:purchases,accountEvents:events,importMetadata:{source:'plaid',recordCount:purchases.length+events.length}},{automatic:true});
   else result.autoMatchedCredits=await creditReview.reviewCredits(client,id);
   const importedIds=(await client.query("SELECT id FROM external_transactions WHERE id=ANY($1::int[]) AND lifecycle_status='awaiting_review'",[rows.map(r=>r.id)])).rows;
   for(const row of importedIds)if(!reasons.some(r=>r.externalTransactionId===row.id))reasons.push({externalTransactionId:row.id,reason:enabled?'Possible duplicate or source changed; review before importing':'Automatic import is disabled'});
   const summary={imported:result.imported,eventsImported:result.eventsImported,creditsMatched:result.autoMatchedCredits.length,remainingReviewCount:importedIds.length,reasons,automaticImportEnabled:enabled,reviewedAt:new Date().toISOString()};
   await client.query(`UPDATE financial_connections SET last_review_summary=$1 WHERE person_id=$2 AND environment=$3 AND ($4::integer IS NULL OR id=$4)`,[summary,id,environment,connectionId]);
   return summary;
  });
 }
 return {reviewPerson};
}
module.exports={createTransactionReviewService};
