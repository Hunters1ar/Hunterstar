// One-time copy tool. Firebase is only loaded by this migration, never by server.js.
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const admin=require('firebase-admin');
const {createStore}=require('./postgres-store');
const {createBucket,resolveObject}=require('./local-bucket');
for(const line of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split(/\r?\n/)) {
  const match=line.match(/^([A-Z_0-9]+)=(.*)$/);
  if(match && process.env[match[1]]===undefined) process.env[match[1]]=match[2].replace(/^(['"])(.*)\1$/,'$2');
}

function encode(value) {
  if(value===null || value===undefined) return value ?? null;
  if(value instanceof admin.firestore.Timestamp) return {__firestoreType:'timestamp',seconds:value.seconds,nanoseconds:value.nanoseconds};
  if(value instanceof admin.firestore.GeoPoint) return {__firestoreType:'geopoint',latitude:value.latitude,longitude:value.longitude};
  if(value instanceof admin.firestore.DocumentReference) return {__firestoreType:'reference',path:value.path};
  if(Buffer.isBuffer(value)) return {__firestoreType:'bytes',base64:value.toString('base64')};
  if(Array.isArray(value)) return value.map(encode);
  if(typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]));
  return value;
}

async function run() {
  const sa=require(path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT || path.join(__dirname,'service-account.json')));
  admin.initializeApp({credential:admin.credential.cert(sa),storageBucket:'portfolio-9b8a5.firebasestorage.app',databaseURL:`https://${sa.project_id}-default-rtdb.firebaseio.com`});
  const db=createStore(); await db.initialize();
  const local=createBucket(db.pool);
  const backup=process.env.MIGRATION_BACKUP_DIR;
  if(!backup) throw new Error('MIGRATION_BACKUP_DIR is required');
  await fs.promises.mkdir(backup,{recursive:true,mode:0o700});
  const source=admin.storage().bucket();
  const [files]=await source.getFiles();
  const urls=new Map();
  const manifest=[];
  for(const file of files) {
    const [metadata]=await file.getMetadata();
    const target=resolveObject(local.root,file.name);
    await fs.promises.mkdir(path.dirname(target),{recursive:true,mode:0o700});
    let valid=false;
    if(fs.existsSync(target)) {
      const hash=crypto.createHash('md5');
      for await(const chunk of fs.createReadStream(target)) hash.update(chunk);
      valid=hash.digest('base64')===metadata.md5Hash;
    }
    if(!valid) {
      const temp=target+'.migration.tmp';
      await file.download({destination:temp});
      const hash=crypto.createHash('md5');
      for await(const chunk of fs.createReadStream(temp)) hash.update(chunk);
      if(hash.digest('base64')!==metadata.md5Hash) throw new Error(`Checksum mismatch: ${file.name}`);
      await fs.promises.chmod(temp,0o600);
      await fs.promises.rename(temp,target);
    }
    metadata.metadata ||= {};
    metadata.metadata.downloadTokens=metadata.metadata.firebaseStorageDownloadTokens || crypto.randomBytes(32).toString('hex');
    await db.pool.query('INSERT INTO files(path,metadata) VALUES($1,$2) ON CONFLICT(path) DO UPDATE SET metadata=EXCLUDED.metadata',[file.name,JSON.stringify(metadata)]);
    urls.set(file.name,local.url(file.name,metadata.metadata.downloadTokens.split(',')[0]));
    manifest.push({path:file.name,size:Number(metadata.size),md5:metadata.md5Hash,metadata});
    console.log('Verified file',file.name,metadata.size);
  }
  const rawDocuments=[];
  async function walk(collection) {
    // listDocuments includes missing parent documents that have subcollections.
    for(const ref of await collection.listDocuments()) {
      const doc=await ref.get();
      if(doc.exists) rawDocuments.push({collection:collection.path,id:doc.id,data:encode(doc.data())});
      for(const child of await ref.listCollections()) await walk(child);
    }
  }
  for(const collection of await admin.firestore().listCollections()) await walk(collection);
  const users=[]; let pageToken;
  do {
    const result=await admin.auth().listUsers(1000,pageToken);
    users.push(...result.users.map(user=>user.toJSON())); pageToken=result.pageToken;
  } while(pageToken);
  const token=await admin.app().options.credential.getAccessToken();
  const fetch=require('node-fetch');
  const response=await fetch(`https://identitytoolkit.googleapis.com/admin/v2/projects/${sa.project_id}/config`,{headers:{Authorization:`Bearer ${token.access_token}`}});
  const config=await response.json();
  const hashConfig=config.signIn?.hashConfig;
  if(!response.ok || hashConfig?.algorithm!=='SCRYPT') throw new Error('Cannot export password hash settings');
  for(const user of users) if(!user.disabled && user.providerData?.some(p=>p.providerId==='password') && (!user.passwordHash || !user.passwordSalt)) throw new Error('Cannot export password hash');
  const realtime=(await admin.database().ref('/').once('value')).val();
  await fs.promises.writeFile(path.join(backup,'firebase-export.json'),JSON.stringify({exportedAt:new Date().toISOString(),documents:rawDocuments,users,hashConfig,files:manifest,realtime},null,2),{mode:0o600});
  function rewrite(value) {
    if(typeof value==='string' && /^https:\/\/firebasestorage\.googleapis\.com\//.test(value)) {
      const match=new URL(value).pathname.match(/\/o\/(.+)$/);
      const key=match && decodeURIComponent(match[1]);
      if(!key || !urls.has(key)) throw new Error('Referenced storage object missing');
      return urls.get(key);
    }
    if(Array.isArray(value)) return value.map(rewrite);
    if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v)]));
    return value;
  }
  const client=await db.pool.connect();
  try {
    await client.query('BEGIN');
    for(const doc of rawDocuments) await client.query('INSERT INTO documents(collection,id,data) VALUES($1,$2,$3) ON CONFLICT(collection,id) DO UPDATE SET data=EXCLUDED.data',[doc.collection,doc.id,JSON.stringify(rewrite(doc.data))]);
    for(const user of users) await client.query(`INSERT INTO users(uid,email,disabled,password_hash,password_salt,hash_config,profile) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(uid) DO UPDATE SET email=EXCLUDED.email,disabled=EXCLUDED.disabled,password_hash=EXCLUDED.password_hash,password_salt=EXCLUDED.password_salt,hash_config=EXCLUDED.hash_config,profile=EXCLUDED.profile`,
    [user.uid,user.email,user.disabled,user.passwordHash,user.passwordSalt,JSON.stringify(hashConfig),JSON.stringify(user)]);
    await client.query('INSERT INTO migration_state(key,data) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET data=EXCLUDED.data',['realtime-database',JSON.stringify(realtime)]);
    await client.query('COMMIT');
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  const counts=await db.pool.query('SELECT collection,count(*)::int AS count FROM documents GROUP BY collection ORDER BY collection');
  console.log(JSON.stringify({documents:rawDocuments.length,users:users.length,files:files.length,bytes:manifest.reduce((n,f)=>n+f.size,0),realtimeEmpty:realtime===null,collections:counts.rows},null,2));
  await db.pool.end(); await admin.app().delete();
}
run().catch(error=>{console.error(error.message);process.exit(1);});
