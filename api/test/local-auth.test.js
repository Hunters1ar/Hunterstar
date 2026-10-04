const test=require('node:test');
const assert=require('node:assert/strict');
const {passwordMatches,verifyPassword}=require('../local-auth');
// Published upstream vector: https://github.com/firebase/scrypt#password-hashing
const config={algorithm:'SCRYPT',signerKey:'jxspr8Ki0RYycVU8zykbdLGjFQ3McFUH0uiiTvC8pVMXAn210wjLNmdZJzxUECKbm0QsEmYUSDzZvpjeJ9WmXA==',saltSeparator:'Bw==',rounds:8,memoryCost:14};
const salt='42xEC+ixf3L2lw==';
const hash='lSrfV15cpx95/sZS2W9c9Kp6i/LVgQNDNC/qzrCnh1SAyZvqmZqAjTdn3aoItz+VHjoZilo78198JAdRuid5lQ==';
test('exported Firebase password works locally and wrong password fails',async()=>{
  assert.equal(await passwordMatches('user1password',salt,hash,config),true);
  assert.equal(await passwordMatches('wrong',salt,hash,config),false);
});
test('disabled accounts cannot sign in',async()=>{
  const pool={query:async()=>({rows:[{disabled:true}]})};
  await assert.rejects(verifyPassword(pool,'user@test.com','password'),{statusCode:401});
});
