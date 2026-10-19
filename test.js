const {spawn}=require('child_process'),assert=require('assert'),fs=require('fs');
const DB='/tmp/stockroom-test.db';[DB,DB+'-wal',DB+'-shm'].forEach(f=>fs.rmSync(f,{force:true}));
const P=4599,base=`http://localhost:${P}`,srv=spawn('node',['server.js'],{env:{...process.env,PORT:P,DB},stdio:'inherit'});
const call=async(path,{tok,body}={})=>{const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(tok&&{authorization:'Bearer '+tok})},body:body&&JSON.stringify(body)});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return{s:r.status,j}};
const login=async(u,p)=>(await call('login',{body:{username:u,password:p}}));
let n=0;const ok=(name,fn)=>fn().then(()=>console.log('PASS',++n,name));
(async()=>{
  for(let i=0;i<50;i++){try{await fetch(base);break}catch{await new Promise(r=>setTimeout(r,100))}}
  const A=(await login('admin','admin123')).j.token,M=(await login('manager1','manager123')).j.token,T=(await login('staff1','staff123')).j.token,T2=(await login('staff2','staff123')).j.token;
  await ok('serves the web app',async()=>{const r=await fetch(base);assert.equal(r.status,200);assert((await r.text()).includes('Stockroom'))});
  await ok('rejects a wrong password',async()=>assert.equal((await login('admin','nope')).s,401));
  await ok('blocks requests without a token',async()=>assert.equal((await call('stock')).s,401));
  await ok('staff cannot read history, dashboard or add items',async()=>{for(const p of['movements','dashboard','export.csv'])assert.equal((await call(p,{tok:T})).s,403);assert.equal((await call('items',{tok:T,body:{name:'x',unit:'kg',cost:1,reorder:1}})).s,403)});
  const milk=async tok=>(await call('stock?branch=1',{tok})).j.find(i=>i.name==='Whole Milk');
  const m0=(await milk(T)).qty;
  await ok('staff stock-in updates quantity',async()=>{const r=await call('move',{tok:T,body:{item_id:2,type:'in',qty:10,uuid:'a1'}});assert.equal(r.j.qty,m0+10)});
  await ok('same offline entry replayed is not counted twice',async()=>{await call('move',{tok:T,body:{item_id:2,type:'in',qty:10,uuid:'a1'}});assert.equal((await milk(T)).qty,m0+10)});
  await ok('cannot use more than is in stock',async()=>{const r=await call('move',{tok:T,body:{item_id:2,type:'usage',qty:99999}});assert.equal(r.s,400);assert.equal((await milk(T)).qty,m0+10)});
  await ok('waste requires a reason',async()=>assert.equal((await call('move',{tok:T,body:{item_id:2,type:'waste',qty:1}})).s,400));
  await ok('staff cannot touch another branch',async()=>{const before=(await call('stock?branch=2',{tok:A})).j.find(i=>i.id===2).qty;await call('move',{tok:T,body:{item_id:2,type:'in',qty:5,branch_id:2}});assert.equal((await call('stock?branch=2',{tok:A})).j.find(i=>i.id===2).qty,before)});
  await ok('low-stock shows on dashboard',async()=>{const cur=(await milk(T)).qty;await call('move',{tok:T,body:{item_id:2,type:'spoilage',qty:cur-5,reason:'Fridge failure'}});const d=(await call('dashboard',{tok:M})).j;assert(d.low.some(l=>l.item==='Whole Milk'&&l.branch==='Downtown'))});
  await ok('manager sees only own branch, admin sees all 3',async()=>{assert.equal((await call('dashboard',{tok:M})).j.branches.length,1);assert.equal((await call('dashboard',{tok:A})).j.branches.length,3)});
  await ok('every change is in the audit history with who recorded it',async()=>{const h=(await call('movements',{tok:M})).j;assert(h.some(r=>r.item==='Whole Milk'&&r.type==='spoilage'&&r.by==='Staff 1'));assert(!h.some(r=>r.branch!=='Downtown'))});
  await ok('CSV export works',async()=>{const r=await call('export.csv',{tok:A});assert(r.j.startsWith('Date,Branch,Item'))});
  await ok('admin can add an item',async()=>{assert.equal((await call('items',{tok:A,body:{name:'Napkins',unit:'box',cost:50,reorder:3}})).s,200);assert.equal((await call('items',{tok:A,body:{name:'Napkins',unit:'box',cost:50,reorder:3}})).s,400)});
  console.log(`\nALL ${n} CHECKS PASSED`);
})().catch(e=>{console.error('FAIL',e.message);process.exitCode=1}).finally(()=>srv.kill());
