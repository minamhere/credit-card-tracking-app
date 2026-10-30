const test = require('node:test');
const assert = require('node:assert/strict');
const {findCreditMatch} = require('../credit-matcher');
const E = require('../offer-engine');
const tx=(id,amount,date='2026-10-03')=>({id,amount,date,merchant:'Target',categories:['retail'],transactionType:'purchase'});
const offer=(overrides={})=>({id:1,name:'Retail',reviewStatus:'confirmed',startDate:'2026-09-01',endDate:'2026-10-31',eligibility:{includeCategories:['retail']},measurement:{kind:'spend',period:'monthly'},rewardConfig:{kind:'percentage',rate:5,cap:80},credits:[],...overrides});
const event=(amount=4.5,overrides={})=>({id:20,date:'2026-09-28',amount:-amount,description:'Statement Credit 10/01/26 - 10/31/26',eventType:'credit',...overrides});
const candidate=(o,rows)=>({offer:o,progress:E.calculateOfferProgress(o,rows)});
test('backdated credit records October and both purchase allocations',()=>{
 const m=findCreditMatch(event(),[candidate(offer(),[tx(1,75),tx(2,15)])]);
 assert.equal(m.rewardMonth,'2026-10');assert.deepEqual(m.evidence.transactionIds,[1,2]);
 assert.equal(m.evidence.allocations.reduce((s,a)=>s+a.amount,0),4.5);
});
test('invalid, conflicting and multi-month reward descriptions stay for review',()=>{
 for(const overrides of [{description:'Statement Credit 10/40/26 - 10/31/26'},{description:'Statement Credit 09/01/26 - 10/31/26'},{rewardMonth:'2026-09'},{rewardMonth:'2026-13'}])
 assert.equal(findCreditMatch(event(4.5,overrides),[candidate(offer(),[tx(1,90)])]).matched,false);
});
test('same reward in competing months or offers is ambiguous',()=>{
 const c=candidate(offer(),[tx(1,90),tx(2,90,'2026-09-03')]);
 assert.equal(findCreditMatch(event(4.5,{description:'Statement Credit'}),[c]).matched,false);
 assert.equal(findCreditMatch(event(),[c,candidate(offer({id:2}),[tx(3,90)])]).matched,false);
});
test('assigned twin, drafts and non-finite amounts cannot match automatically',()=>{
 const c=candidate(offer(),[tx(1,90)]), e=event();
 assert.equal(findCreditMatch(e,[c],{events:[e,{...e,id:21,assignedOfferCreditId:5}]}).matched,false);
 for(const reviewStatus of ['draft','rejected'])assert.equal(findCreditMatch(e,[candidate(offer({reviewStatus}),[tx(1,90)])]).matched,false);
 for(const n of [NaN,Infinity,0])assert.equal(findCreditMatch(event(n),[c]).matched,false);
});
test('paid individual purchases exhaust their daily reward',()=>{
 const o=offer({credits:[{amount:3,rewardMonth:'2026-10'},{amount:2,rewardMonth:'2026-10'}]});
 assert.equal(findCreditMatch(event(5),[candidate(o,[tx(1,60),tx(2,40),tx(3,200,'2026-10-04')])]).matched,false);
});
test('paid daily reward consumes both underlying purchases',()=>{
 const o=offer({credits:[{amount:5,rewardMonth:'2026-10',matchEvidence:{kind:'day',allocations:[{transactionId:1,amount:3},{transactionId:2,amount:2}]}}]});
 assert.equal(findCreditMatch(event(3),[candidate(o,[tx(1,60),tx(2,40),tx(3,200,'2026-10-04')])]).matched,false);
});
test('equal purchase allocations remain ambiguous',()=>{
 assert.equal(findCreditMatch(event(3),[candidate(offer(),[tx(1,60),tx(2,60)])]).matched,false);
});
test('credit cannot exceed remaining capped reward even within tolerance',()=>{
 const o=offer({rewardConfig:{kind:'percentage',rate:5,cap:5},credits:[{amount:4.99,rewardMonth:'2026-10'}]});
 assert.equal(findCreditMatch(event(.02),[candidate(o,[tx(1,200)])]).matched,false);
});
test('tier ledger allows only incremental reward after first tier is paid',()=>{
 const o=offer({rewardConfig:{kind:'tiers',tiers:[{threshold:1000,reward:80},{threshold:2000,reward:160}]},credits:[{amount:80,rewardMonth:'2026-10'}]});
 const m=findCreditMatch(event(80),[candidate(o,[tx(1,1000),tx(2,1000,'2026-10-04')])]);
 assert.equal(m.matched,true);assert.equal(m.evidence.kind,'checkpoint');assert.equal(m.evidence.creditedAmount,80);
});
test('historical credit with unknown month reserves possible reward evidence',()=>{
 const o=offer({credits:[{amount:4.5}]});
 assert.equal(findCreditMatch(event(),[candidate(o,[tx(1,90),tx(2,90,'2026-09-03')])]).matched,false);
});
test('explicit month rejects a nonmonthly offer outside that month and retains compatible month evidence',()=>{
 const o=offer({startDate:'2026-09-01',endDate:'2026-09-30',measurement:{kind:'spend',period:'offer'}});
 assert.equal(findCreditMatch(event(5),[candidate(o,[tx(1,100,'2026-09-03')])]).matched,false);
 const valid=findCreditMatch(event(5,{description:'Statement Credit 09/01/26 - 09/30/26'}),[candidate(o,[tx(1,100,'2026-09-03')])]);
 assert.equal(valid.matched,true);assert.equal(valid.rewardMonth,'2026-09');
});
test('ordinary percentage rewards retain unique chronological checkpoint payouts',()=>{
 const m=findCreditMatch(event(7.5),[candidate(offer(),[tx(1,50,'2026-10-01'),tx(2,100,'2026-10-02'),tx(3,200,'2026-10-03')])]);
 assert.equal(m.matched,true);assert.deepEqual(m.evidence.transactionIds,[1,2]);
});
