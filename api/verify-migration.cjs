const fs=require('fs');
const crypto=require('crypto');
const assert=require('node:assert/strict');
const path=require('path');
const {createStore}=require('./postgres-store');
const {createBucket,resolveObject}=require('./local-bucket');
for(const line of fs.readFileSync(__dirname+'/.env','utf8').split(/\r?\n/)) {
  const m=line.match(/^([A-Z_0-9]+)=(.*)$/);
  if(m && process.env[m[1]]===undefined) process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');
}
(async()=>{
  const source=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  const db=createStore();
  try {
    const bucket=createBucket(db.pool);
    const fileUrls=new Map();
    for(const file of source.files) {
      const metadata=(await db.pool.query('SELECT metadata FROM files WHERE path=$1',[file.path])).rows[0]?.metadata;
      assert.ok(metadata,'Missing file metadata');
      const hash=crypto.createHash('md5');
      for await(const chunk of fs.createReadStream(resolveObject(bucket.root,file.path))) hash.update(chunk);
      assert.equal(hash.digest('base64'),file.md5,'File checksum differs');
      fileUrls.set(file.path,bucket.url(file.path,metadata.metadata.downloadTokens.split(',')[0]));
    }
    function rewrite(value) {
      if(typeof value==='string' && /^https:\/\/firebasestorage\.googleapis\.com\//.test(value)) {
        const key=decodeURIComponent(new URL(value).pathname.match(/\/o\/(.+)$/)[1]);
        assert.ok(fileUrls.has(key));return fileUrls.get(key);
      }
      if(Array.isArray(value)) return value.map(rewrite);
      if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v)]));
      return value;
    }
    for(const doc of source.documents) {
      const row=(await db.pool.query('SELECT data FROM documents WHERE collection=$1 AND id=$2',[doc.collection,doc.id])).rows[0];
      assert.deepEqual(row?.data,rewrite(doc.data),'Document differs: '+doc.collection+'/'+doc.id);
    }
    for(const user of source.users) {
      const row=(await db.pool.query('SELECT * FROM users WHERE uid=$1',[user.uid])).rows[0];
      assert.deepEqual(row.profile,user);assert.equal(row.password_hash,user.passwordHash);assert.equal(row.password_salt,user.passwordSalt);assert.deepEqual(row.hash_config,source.hashConfig);
    }
    console.log(`PASS: ${source.documents.length} complete documents, ${source.users.length} complete user profiles/password hashes, ${source.files.length} file checksums match the Firebase export`);
  } finally {await db.pool.end();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
