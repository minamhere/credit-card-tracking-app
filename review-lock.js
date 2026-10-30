async function withPersonLock(pool, personId, work) {
 const id=Number(personId);
 if(!Number.isInteger(id)||id<=0)throw new Error('A valid cardholder is required');
 const client=await pool.connect();
 try {await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(72601, $1)',[id]);const result=await work(client,id);await client.query('COMMIT');return result;}
 catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
module.exports={withPersonLock};
