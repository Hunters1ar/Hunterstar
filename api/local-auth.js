const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

// Firebase's exported SCRYPT hashes use scrypt followed by AES-256-CTR.
// Verification is entirely local; no Firebase requests or SDK are needed.
async function passwordMatches(password, salt, expectedHash, config) {
  if (config?.algorithm !== 'SCRYPT' || !salt || !expectedHash) return false;
  const key = await scrypt(password, Buffer.concat([
    Buffer.from(salt,'base64'), Buffer.from(config.saltSeparator,'base64')
  ]), 32, {N:2 ** Number(config.memoryCost), r:Number(config.rounds), p:1, maxmem:128*1024*1024});
  const cipher=crypto.createCipheriv('aes-256-ctr',key,Buffer.alloc(16));
  const actual=Buffer.concat([cipher.update(Buffer.from(config.signerKey,'base64')),cipher.final()]);
  const expected=Buffer.from(expectedHash,'base64');
  return actual.length===expected.length && crypto.timingSafeEqual(actual,expected);
}

async function verifyPassword(pool, email, password) {
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password || password.length>1024) {
    throw Object.assign(new Error('Email and password are required.'),{statusCode:400});
  }
  const {rows}=await pool.query('SELECT * FROM users WHERE lower(email)=lower($1)',[email.trim()]);
  const user=rows[0];
  if (!user || user.disabled || !await passwordMatches(password,user.password_salt,user.password_hash,user.hash_config)) {
    throw Object.assign(new Error('Invalid email or password.'),{statusCode:401});
  }
  return {uid:user.uid,email:user.email};
}
module.exports={passwordMatches,verifyPassword};
