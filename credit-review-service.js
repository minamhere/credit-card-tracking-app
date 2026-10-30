const Engine=require('./offer-engine');
const Matcher=require('./credit-matcher');
const offerSnapshot=o=>JSON.stringify([o.startDate,o.endDate,o.eligibility,o.measurement,o.rewardConfig]);
const purchaseSnapshot=t=>JSON.stringify([t.id,t.date,t.amount,t.merchant,t.categories,t.transactionType]);
function createCreditReviewService({serializeOffer}) {
 async function load(client,personId) {
  const offers=(await client.query('SELECT * FROM offers WHERE person_id=$1 ORDER BY id',[personId])).rows;
  const tx=(await client.query('SELECT * FROM transactions WHERE person_id=$1 ORDER BY date,id',[personId])).rows.map(t=>({id:t.id,date:t.date,amount:Number(t.amount),merchant:t.merchant,categories:t.categories||[],transactionType:t.transaction_type||'purchase'}));
  const credits=(await client.query('SELECT oc.* FROM offer_credits oc JOIN offers o ON o.id=oc.offer_id WHERE o.person_id=$1 ORDER BY oc.id',[personId])).rows;
  return {offers,tx,credits};
 }
 const creditObject=c=>({id:c.id,amount:Number(c.amount),postedDate:c.posted_date,description:c.description,rewardMonth:c.reward_month,matchEvidence:c.match_evidence});
 async function flagInvalidEvidence(client,personId) {
  const {offers,tx,credits}=await load(client,personId);
  for(const credit of credits) {
   const evidence=credit.match_evidence;if(!evidence?.transactionIds?.length)continue;
   const row=offers.find(o=>o.id===credit.offer_id);const offer=serializeOffer(row);
   const monthly=offer.measurement.period==='monthly';
   const periodTx=tx.filter(t=>Engine.evaluateEligibility(t,offer).eligible&&(!monthly||!credit.reward_month||String(t.date).slice(0,7)===credit.reward_month));
   const metric=offer.measurement.kind==='count'?periodTx.length:periodTx.reduce((s,t)=>s+t.amount,0);
   const expected=Engine.calculateReward(metric,offer.rewardConfig).earnedReward;
   const periodCredits=credits.filter(c=>c.offer_id===row.id&&(!monthly||c.reward_month===credit.reward_month));
   const posted=periodCredits.reduce((s,c)=>s+Number(c.amount),0);
   const unchanged=(!Object.hasOwn(evidence,'rewardMonth') || evidence.rewardMonth===(credit.reward_month||null)) && (!evidence.offerSnapshot || evidence.offerSnapshot===offerSnapshot(offer)) && (!evidence.purchaseSnapshots || evidence.purchaseSnapshots.every(snapshot=>periodTx.some(t=>purchaseSnapshot(t)===snapshot)));
   const cents=value=>Math.round((Number(value)+Number.EPSILON)*100);
   const amountValid=Number.isFinite(Number(credit.amount)) && cents(evidence.creditedAmount)===cents(credit.amount);
   let allocationValid=true;
   if(offer.rewardConfig.kind==='percentage'&&evidence.assignmentMethod==='automatic') {
    const allocations=evidence.allocations||[];
    allocationValid=allocations.length>0 && allocations.every(a=>Number.isFinite(Number(a.amount))&&Number(a.amount)>0&&evidence.transactionIds.includes(a.transactionId)) && allocations.reduce((sum,a)=>sum+cents(a.amount),0)===cents(credit.amount);
    const budgets=Matcher.percentageRewardBudgets(offer,periodTx);
    for(const allocation of allocations) {
     const budget=budgets.find(b=>Number(b.transaction.id)===Number(allocation.transactionId));
     const consumed=periodCredits.flatMap(c=>c.match_evidence?.allocations||[]).filter(a=>Number(a.transactionId)===Number(allocation.transactionId)).reduce((sum,a)=>sum+cents(a.amount),0);
     if(!budget||consumed>budget.available)allocationValid=false;
    }
   }
   const valid=amountValid && allocationValid && unchanged && row.review_status==='confirmed' && cents(expected)>=cents(posted) && evidence.transactionIds.every(id=>periodTx.some(t=>Number(t.id)===Number(id)));
   if(!valid&&evidence.status!=='needs_review')await client.query("UPDATE offer_credits SET match_evidence=$1 WHERE id=$2",[{...evidence,status:'needs_review',reviewReason:'Purchase categories, offer terms, or earned month changed; review this credit'},credit.id]);
  }
 }
 async function reviewCredits(client,personId) {
  await flagInvalidEvidence(client,personId);
  const {offers,tx,credits}=await load(client,personId);
  const events=(await client.query('SELECT id,event_date AS date,amount,description,event_type AS "eventType",assigned_offer_credit_id AS "assignedOfferCreditId",review_suppressed AS "reviewSuppressed" FROM account_events WHERE person_id=$1 ORDER BY id FOR UPDATE',[personId])).rows;
  for(const event of events) {
   if(Matcher.isPotentialOfferCredit(event)&&events.some(other=>other.id!==event.id&&Matcher.eventIdentity(other)===Matcher.eventIdentity(event)))
    await client.query('UPDATE account_events SET review_reason=$1 WHERE id=$2',['Possible duplicate statement credit; compare source records before changing assignments',event.id]);
  }
  const matches=[];
  let changed;
  do {changed=false;
   for(const event of events.filter(e=>!e.assignedOfferCreditId&&!e.reviewSuppressed&&Matcher.isPotentialOfferCredit(e))) {
    const candidates=offers.filter(o=>o.review_status==='confirmed').map(row=>{const offer=serializeOffer(row,credits.filter(c=>c.offer_id===row.id).map(creditObject));return {offer,progress:Engine.calculateOfferProgress(offer,tx)};});
    const match=Matcher.findCreditMatch(event,candidates,{events});
    if(!match.matched){await client.query('UPDATE account_events SET review_reason=$1 WHERE id=$2',[match.reason,event.id]);continue;}
    const matchedOffer=candidates.find(c=>Number(c.offer.id)===Number(match.offerId)).offer;
    const evidence={...match.evidence,assignmentMethod:'automatic',status:'matched',offerSnapshot:offerSnapshot(matchedOffer),purchaseSnapshots:tx.filter(t=>match.evidence.transactionIds.includes(t.id)).map(purchaseSnapshot)};
    const saved=(await client.query('INSERT INTO offer_credits(offer_id,amount,posted_date,description,reward_month,match_evidence) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[match.offerId,Math.abs(Number(event.amount)),event.date,event.description,match.rewardMonth,evidence])).rows[0];
    await client.query('UPDATE account_events SET assigned_offer_credit_id=$1,review_reason=$2 WHERE id=$3 AND assigned_offer_credit_id IS NULL',[saved.id,match.reasons.join('; '),event.id]);
    event.assignedOfferCreditId=saved.id;credits.push(saved);changed=true;
    matches.push({eventId:event.id,creditId:saved.id,offerId:match.offerId,offerName:match.offerName,amount:Math.abs(Number(event.amount)),rewardMonth:match.rewardMonth,reasons:match.reasons});
   }
  }while(changed);
  return matches;
 }
 async function assignManually(client,{personId,eventId,offerId}) {
  const event=(await client.query('SELECT * FROM account_events WHERE id=$1 AND person_id=$2 FOR UPDATE',[eventId,personId])).rows[0];
  if(!event)throw new Error('Account event not found');if(event.assigned_offer_credit_id)throw new Error('Account event is already assigned');
  const offer=(await client.query('SELECT * FROM offers WHERE id=$1 AND person_id=$2',[offerId,personId])).rows[0];
  if(!offer)throw new Error('Offer not found for this cardholder');
  if(!Number.isFinite(Number(event.amount))||Number(event.amount)>=0||!Matcher.isPotentialOfferCredit({description:event.description,eventType:event.event_type}))throw new Error('This event is not an offer credit');
  const month=Matcher.earnedMonth({description:event.description});
  const rewardMonth=!month.invalid&&offer.monthly_tracking&&month.month>=String(offer.start_date).slice(0,7)&&month.month<=String(offer.end_date).slice(0,7)?month.month:null;
  const saved=(await client.query('INSERT INTO offer_credits(offer_id,amount,posted_date,description,reward_month,match_evidence) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[offerId,Math.abs(Number(event.amount)),event.event_date,event.description,rewardMonth,{version:1,assignmentMethod:'manual',status:'manual'}])).rows[0];
  await client.query('UPDATE account_events SET assigned_offer_credit_id=$1,review_reason=$2,review_suppressed=FALSE WHERE id=$3',[saved.id,'Manually assigned',event.id]);return saved;
 }
 return {reviewCredits,flagInvalidEvidence,assignManually};
}
module.exports={createCreditReviewService};
