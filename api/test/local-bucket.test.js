const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('path');
const {resolveObject}=require('../local-bucket');
test('object paths stay inside bucket',()=>{
  const root=path.resolve('bucket');
  assert.equal(resolveObject(root,'archives/box/file.pdf'),path.join(root,'archives/box/file.pdf'));
  for(const key of ['../.env','archives/../../.env','/etc/passwd','a\\..\\b','a//b']) assert.throws(()=>resolveObject(root,key));
});
