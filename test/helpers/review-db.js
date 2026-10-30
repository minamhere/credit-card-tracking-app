const fs = require('node:fs');
const path = require('node:path');
async function reviewDb() {
 const {PGlite}=require(process.env.PGLITE_TEST_MODULE);
 const db=new PGlite();
 await db.exec(`CREATE TABLE people (id SERIAL PRIMARY KEY,name TEXT);
 CREATE TABLE offers (id SERIAL PRIMARY KEY,person_id INTEGER REFERENCES people(id),name TEXT,type TEXT,start_date TEXT,end_date TEXT,spending_target REAL,transaction_target INTEGER,min_transaction REAL,categories TEXT[] DEFAULT '{}',reward REAL DEFAULT 0,bonus_reward REAL,tiers JSONB DEFAULT '[]',description TEXT,monthly_tracking BOOLEAN DEFAULT FALSE);
 CREATE TABLE transactions (id SERIAL PRIMARY KEY,person_id INTEGER REFERENCES people(id),date TEXT,amount NUMERIC,merchant TEXT,categories TEXT[] DEFAULT '{}',description TEXT);
 CREATE TABLE app_migration_history(migration_key TEXT PRIMARY KEY,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
 INSERT INTO app_migration_history(migration_key) VALUES ('one_time_clean_reset_2026_09_27');
 INSERT INTO people(id,name) VALUES(1,'Person A'),(2,'Person B');`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../../migrations.sql'),'utf8'));
 let tail=Promise.resolve();
 const query=async(...args)=>{const result=await db.query(...args);for(const row of result.rows||[])for(const field of result.fields||[])if(field.dataTypeID===1082&&row[field.name] instanceof Date)row[field.name]=row[field.name].toISOString().slice(0,10);return result;};
 const pool={query,async connect(){let unlock;const previous=tail;tail=new Promise(r=>{unlock=r});await previous;return {query,release:unlock};}};
 return {db,pool,close:()=>db.close()};
}
function serializeOffer(row,credits=[]) {return {id:row.id,personId:row.person_id,name:row.name,startDate:row.start_date,endDate:row.end_date,reviewStatus:row.review_status,eligibility:row.eligibility,measurement:row.measurement,rewardConfig:row.reward_config,credits};}
async function seedOffer(db) {
 await db.query(`INSERT INTO offers(id,person_id,name,type,start_date,end_date,monthly_tracking,eligibility,measurement,reward_config) VALUES(1,1,'Retail','percent-back','2026-09-01','2026-10-31',TRUE,$1,$2,$3)`,[{transactionTypes:['purchase'],includeCategories:['retail']},{kind:'spend',period:'monthly'},{kind:'percentage',rate:5,cap:80}]);
}
module.exports={reviewDb,serializeOffer,seedOffer};
