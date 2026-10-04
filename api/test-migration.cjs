const assert=require('node:assert/strict');
const fs=require('fs');
const crypto=require('crypto');
const {generate}=require('otplib');
const {createStore}=require('./postgres-store');
for(const line of fs.readFileSync(__dirname+'/.env','utf8').split(/\r?\n/)) {
  const m=line.match(/^([A-Z_0-9]+)=(.*)$/);
  if(m && process.env[m[1]]===undefined) process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');
}
const db=createStore();
const base=process.env.TEST_API_URL || 'http://127.0.0.1:3002';
const uid='migration-test-'+crypto.randomBytes(8).toString('hex');
const email=uid+'@example.invalid';
const config={algorithm:'SCRYPT',signerKey:'jxspr8Ki0RYycVU8zykbdLGjFQ3McFUH0uiiTvC8pVMXAn210wjLNmdZJzxUECKbm0QsEmYUSDzZvpjeJ9WmXA==',saltSeparator:'Bw==',rounds:8,memoryCost:14};
const hash='lSrfV15cpx95/sZS2W9c9Kp6i/LVgQNDNC/qzrCnh1SAyZvqmZqAjTdn3aoItz+VHjoZilo78198JAdRuid5lQ==';
const cleanup=[];
let boxId,queueId,submissionId;
async function request(route, method='GET', body, cookie) {
  const response=await fetch(base+route,{method,headers:{...(body && !(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
  const data=await response.json();
  assert.equal(response.ok,true,`${route}: ${JSON.stringify(data)}`);
  assert.equal(data.ok,true);
  return {data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function login(scope) {
  const {data}=await request(`/api/${scope}/login`,'POST',{email,password:'user1password'});
  assert.equal(data.twoFactorSetupRequired,true);
  const code=await generate({secret:data.manualKey});
  return (await request(`/api/${scope}/2fa/verify`,'POST',{challengeToken:data.challengeToken,code})).cookie;
}
(async()=>{
  try {
    await db.initialize();
    await db.pool.query('INSERT INTO users(uid,email,password_hash,password_salt,hash_config,profile) VALUES($1,$2,$3,$4,$5,$6)',[uid,email,hash,'42xEC+ixf3L2lw==',JSON.stringify(config),'{}']);
    const col=db.collection(uid);
    await col.doc('one').set({order:2,visible:true,keep:'yes'});
    await col.doc('two').set({order:10,visible:false});
    await col.doc('one').set({order:3},{merge:true});
    assert.equal((await col.doc('one').get()).data().keep,'yes');
    assert.deepEqual((await col.orderBy('order','desc').limit(1).get()).docs.map(d=>d.id),['two']);
    assert.equal((await col.where('visible','==',true).get()).size,1);
    const batch=db.batch();batch.delete(col.doc('one'));batch.delete(col.doc('two'));await batch.commit();
    assert.equal((await col.get()).size,0);
    const adminCookie=await login('admin');
    await request('/api/admin/content-boxes','GET',null,adminCookie);
    const form=new FormData();
    form.set('payload',JSON.stringify({title:uid,summary:'Migration verification',published:false}));
    form.append('files',new Blob(['migration-check'],{type:'text/plain'}),'test.txt');
    const saved=await request('/api/admin/content-boxes','POST',form,adminCookie);
    boxId=saved.data.id || saved.data.contentBox?.id;
    assert.ok(boxId,JSON.stringify(saved.data));
    const snap=await db.collection('content_boxes').doc(boxId).get();
    const attachment=snap.data().attachments[0];
    assert.ok(attachment.url.startsWith('https://api.hunterstar.uz/api/files/'));
    const localUrl=base+new URL(attachment.url).pathname+new URL(attachment.url).search;
    const file=await fetch(localUrl);assert.equal(file.status,200);assert.equal(await file.text(),'migration-check');
    const denied=await fetch(base+new URL(attachment.url).pathname);assert.equal(denied.status,404);
    const range=await fetch(localUrl,{headers:{Range:'bytes=0-3'}});assert.equal(range.status,206);assert.equal(await range.text(),'migr');
    await request('/api/admin/content-boxes/'+boxId,'DELETE',null,adminCookie);boxId=null;
    const privCookie=await login('private');
    await request('/api/private/diary/2099-01-01','PUT',{text:'Migration diary check',photos:[]},privCookie);
    cleanup.push(['private_diary_pages',crypto.createHash('sha256').update(uid).digest('hex').slice(0,32)+'_2099-01-01']);
    const page=await request('/api/private/diary/2099-01-01','GET',null,privCookie);
    assert.equal(page.data.page.text,'Migration diary check');
    await request('/api/private/diary/2099-01-01','DELETE',null,privCookie);
    queueId=(await request('/api/account-queue','POST',{text:uid,date:'2099-01-01'})).data.id;
    await request('/api/account-queue/'+queueId,'PATCH',{date:'2099-01-02'});
    await request('/api/account-queue/'+queueId,'DELETE');queueId=null;
    const contact=await request('/api/contact','POST',{name:'Migration check',email,subject:uid,message:'Temporary migration verification record.'});
    const submissions=await db.collection('my comments').where('subject','==',uid).get();
    submissionId=submissions.docs[0]?.id;
    assert.ok(submissionId);
    await request('/api/admin/submissions/'+submissionId,'DELETE',null,adminCookie);submissionId=null;
    for(const route of ['/api/health','/api/archives','/api/opener-accounts','/api/account-queue']) await request(route);
    console.log('PASS: PostgreSQL reads/writes, merge, numeric ordering, filters, batches, password login, 2FA, admin upload/delete, file token checks, range downloads, private diary, queue, contact and public routes');
  } finally {
    if(boxId) {
      const doc=await db.collection('content_boxes').doc(boxId).get();
      const {createBucket}=require('./local-bucket');
      for(const att of doc.data()?.attachments || []) await createBucket(db.pool).file(att.path).delete();
      await doc.ref.delete();
    }
    if(queueId) await db.collection('account_queue').doc(queueId).delete();
    if(submissionId) await db.collection('my comments').doc(submissionId).delete();
    for(const [col,id] of cleanup) await db.collection(col).doc(id).delete();
    for(const col of ['admin_two_factor','private_two_factor']) await db.collection(col).doc(uid).delete();
    await db.pool.query('DELETE FROM documents WHERE collection=$1 OR data->>\'ownerUid\'=$1 OR data->>\'subject\'=$1',[uid]);
    await db.pool.query('DELETE FROM users WHERE uid=$1',[uid]);
    await db.pool.end();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
