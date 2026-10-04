const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

function resolveObject(root, key) {
  if (typeof key !== 'string' || !key || key.includes('\\') || key.includes('\0') || key.split('/').some(p=>!p || p==='.' || p==='..')) throw new Error('Invalid object path');
  const target=path.resolve(root,key);
  if (!target.startsWith(path.resolve(root)+path.sep)) throw new Error('Invalid object path');
  return target;
}

function createBucket(pool, root=process.env.BUCKET_DIR || path.join(__dirname,'bucket'), base=process.env.PUBLIC_API_URL || 'https://api.hunterstar.uz') {
  return {
    root,
    url:(key,token)=>`${base.replace(/\/$/,'')}/api/files/${encodeURIComponent(key)}?token=${encodeURIComponent(token)}`,
    file:key=>({
      save:async(buffer,options={})=>{
        const target=resolveObject(root,key);
        await fs.promises.mkdir(path.dirname(target),{recursive:true,mode:0o700});
        const temp=target+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
        await fs.promises.writeFile(temp,buffer,{mode:0o600});
        await fs.promises.rename(temp,target);
        const metadata={...options.metadata,size:String(buffer.length)};
        await pool.query('INSERT INTO files(path,metadata) VALUES($1,$2) ON CONFLICT(path) DO UPDATE SET metadata=EXCLUDED.metadata',[key,JSON.stringify(metadata)]);
      },
      delete:async()=>{
        await fs.promises.rm(resolveObject(root,key),{force:true});
        await pool.query('DELETE FROM files WHERE path=$1',[key]);
      }
    }),
    serve:async(req,res,next)=>{
      try {
        const key=req.params.key;
        const target=resolveObject(root,key);
        const {rows}=await pool.query('SELECT metadata FROM files WHERE path=$1',[key]);
        const metadata=rows[0]?.metadata;
        const tokens=String(metadata?.metadata?.downloadTokens || metadata?.metadata?.firebaseStorageDownloadTokens || '').split(',').filter(Boolean);
        if (!metadata || !tokens.includes(String(req.query.token || ''))) return res.status(404).json({ok:false,error:'File not found.'});
        res.set('Content-Type',metadata.contentType || 'application/octet-stream');
        res.set('X-Content-Type-Options','nosniff');
        res.set('Content-Security-Policy',"sandbox; default-src 'none'");
        res.set('Cache-Control','private, no-store');
        if (!/^(image\/(png|jpeg|gif|webp|avif)|video\/|audio\/|application\/pdf)/i.test(metadata.contentType || '')) res.attachment(path.basename(key));
        res.sendFile(target,error=>{if(error) next(error);});
      } catch(error) { next(error); }
    }
  };
}
module.exports={createBucket,resolveObject};
