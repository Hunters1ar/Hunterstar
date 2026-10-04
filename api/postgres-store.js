const { Pool } = require('pg');
const crypto = require('crypto');

const schema = `
CREATE TABLE IF NOT EXISTS documents (
  collection text NOT NULL, id text NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS documents_data_idx ON documents USING gin(data);
CREATE TABLE IF NOT EXISTS users (
  uid text PRIMARY KEY, email text UNIQUE NOT NULL, disabled boolean NOT NULL DEFAULT false,
  password_hash text, password_salt text, hash_config jsonb, profile jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  path text PRIMARY KEY, metadata jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS migration_state (key text PRIMARY KEY, data jsonb NOT NULL);
`;

function decode(value) {
  if (value?.__firestoreType === 'timestamp') return { ...value, toDate:()=>new Date(value.seconds*1000+value.nanoseconds/1e6), toJSON:()=>value };
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decode(v)]));
  return value;
}
function snapshot(ref, data) {
  return { id: ref.id, ref, exists: data !== undefined, data: () => decode(data) };
}

class Document {
  constructor(store, collection, id = crypto.randomBytes(15).toString('hex')) {
    if (typeof id !== 'string' || !id || id.includes('/')) throw new Error('Invalid document ID');
    this.store = store; this.collection = collection; this.id = id;
    this.parent = {id:collection.split('/').at(-1)};
  }
  async get() {
    const result = await this.store.pool.query('SELECT data FROM documents WHERE collection=$1 AND id=$2', [this.collection, this.id]);
    return snapshot(this, result.rows[0]?.data);
  }
  async set(data, options = {}) {
    await this.store.pool.query(`INSERT INTO documents(collection,id,data) VALUES($1,$2,$3)
      ON CONFLICT(collection,id) DO UPDATE SET data=${options.merge ? 'documents.data || EXCLUDED.data' : 'EXCLUDED.data'}`,
    [this.collection, this.id, JSON.stringify(data)]);
  }
  async update(data) {
    const result = await this.store.pool.query('UPDATE documents SET data=data || $3::jsonb WHERE collection=$1 AND id=$2', [this.collection,this.id,JSON.stringify(data)]);
    if (!result.rowCount) throw new Error('Document does not exist');
  }
  async delete() { await this.store.pool.query('DELETE FROM documents WHERE collection=$1 AND id=$2', [this.collection,this.id]); }
}

class Collection {
  constructor(store, name, filters = [], order = null, max = null) {
    this.store=store; this.name=name; this.filters=filters; this.order=order; this.max=max;
  }
  doc(id) { return new Document(this.store, this.name, id); }
  async add(data) { const ref=this.doc(); await ref.set(data); return ref; }
  where(field, operator, value) {
    if (operator !== '==') throw new Error('Unsupported comparison');
    return new Collection(this.store,this.name,[...this.filters,{field,value}],this.order,this.max);
  }
  orderBy(field, direction='asc') {
    if (!['asc','desc'].includes(direction)) throw new Error('Invalid ordering');
    return new Collection(this.store,this.name,this.filters,{field,direction},this.max);
  }
  limit(max) {
    if (!Number.isInteger(max) || max < 1) throw new Error('Invalid limit');
    return new Collection(this.store,this.name,this.filters,this.order,max);
  }
  async get() {
    const args=[this.name];
    let sql='SELECT id,data FROM documents WHERE collection=$1';
    for (const {field,value} of this.filters) {
      args.push(field,JSON.stringify(value));
      sql+=` AND data -> $${args.length-1}::text = $${args.length}::jsonb`;
    }
    if (this.order) {
      args.push(this.order.field);
      sql+=` AND data ? $${args.length}::text ORDER BY data -> $${args.length}::text ${this.order.direction}, id`;
    } else sql+=' ORDER BY id';
    if (this.max) { args.push(this.max); sql+=` LIMIT $${args.length}`; }
    const result=await this.store.pool.query(sql,args);
    const docs=result.rows.map(row=>snapshot(this.doc(row.id),row.data));
    return {docs, size:docs.length, empty:!docs.length, forEach:fn=>docs.forEach(fn)};
  }
}

function createStore(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const pool = new Pool({connectionString, max:10, connectionTimeoutMillis:10000});
  pool.on('error', error=>console.error('PostgreSQL pool error:',error.message));
  const store = {pool, initialize:()=>pool.query(schema), collection:name=>new Collection(store,name), batch:()=>{
    const refs=[];
    return {delete:ref=>refs.push(ref), commit:async()=>{
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        for (const ref of refs) await client.query('DELETE FROM documents WHERE collection=$1 AND id=$2',[ref.collection,ref.id]);
        await client.query('COMMIT');
      } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    }};
  }};
  return store;
}
module.exports={createStore,schema};
