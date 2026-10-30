const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {renderPlaidConnections}=require('../plaid-ui');
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
test('sync panel reports automatic outcomes and escaped failure reasons',()=>{
 const html=renderPlaidConnections([{id:1,status:'healthy',accounts:[],lastReview:{imported:3,creditsMatched:1,remainingReviewCount:2,reviewError:'<bad>'}}],escape);
 assert.match(html,/3 purchases/);assert.match(html,/1 credit/);assert.match(html,/2.*review/);assert.doesNotMatch(html,/<bad>/);assert.match(html,/&lt;bad&gt;/);
});
test('dashboard rendering never assigns credits even when a browser matcher would match',async()=>{
 const container={innerHTML:''};let writes=0;
 const context=vm.createContext({document:{getElementById:()=>container},console,CreditMatcher:{findCreditMatch:()=>({matched:true,offerId:1})},MonthlyDashboard:require('../monthly-dashboard')});
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8');vm.runInContext(source.slice(0,source.lastIndexOf('const tracker = new OfferTracker();'))+'\nglobalThis.Tracker=OfferTracker;',context);
 const tracker=Object.create(context.Tracker.prototype);tracker.escapeHtml=escape;
 tracker.dataManager={getSimplifiedOfferList:async()=>[],dbManager:{getAccountEvents:async()=>[{id:1,amount:-5}],assignAccountEvent:async()=>{writes++;throw new Error('dashboard wrote')}}};
 await tracker.renderDashboard();assert.equal(writes,0);
});
test('transaction API serializes database numeric values as numbers',async()=>{
 let handler,body;const source=fs.readFileSync(require.resolve('../server.js'),'utf8');const start=source.indexOf("app.get('/api/transactions'");
 vm.runInNewContext(source.slice(start,source.indexOf('\n});',start)+5),{app:{get:(_,fn)=>handler=fn},pool:{query:async()=>({rows:[{id:1,amount:'75.00',person_id:1,categories:['retail']}]})},console});
 await handler({query:{personId:1}},{json:value=>{body=value},status(){return this}});assert.equal(body[0].amount,75);
});
test('automatic purchase explanations are visible and escaped',async()=>{
 const container={innerHTML:''};const context=vm.createContext({document:{getElementById:()=>container},console});
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8');vm.runInContext(source.slice(0,source.lastIndexOf('const tracker = new OfferTracker();'))+'\nglobalThis.Tracker=OfferTracker;',context);
 const tracker=Object.create(context.Tracker.prototype);tracker.escapeHtml=escape;tracker.transactionsPerPage=20;tracker.currentTransactionPage=1;
 tracker.dataManager={getTransactions:async()=>[{id:1,date:'2026-10-01',merchant:'<shop>',amount:20,categories:['retail'],reviewMetadata:{method:'automatic',reason:'Saved rule <known>'}}],getMatchingOffersForTransaction:async()=>[]};
 await tracker.renderTransactions();assert.match(container.innerHTML,/Saved rule &lt;known&gt;/);assert.doesNotMatch(container.innerHTML,/<shop>/);
});
