const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.env.DB||path.join(__dirname,'data.db'));
db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS branches(id INTEGER PRIMARY KEY,name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT,role TEXT NOT NULL CHECK(role IN('admin','manager','staff')),branch_id INTEGER REFERENCES branches(id),pw TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY,name TEXT UNIQUE NOT NULL,category TEXT,unit TEXT NOT NULL,supplier TEXT,cost REAL NOT NULL DEFAULT 0,reorder REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS stock(branch_id INTEGER REFERENCES branches(id),item_id INTEGER REFERENCES items(id),qty REAL NOT NULL DEFAULT 0 CHECK(qty>=0),PRIMARY KEY(branch_id,item_id));
CREATE TABLE IF NOT EXISTS movements(id INTEGER PRIMARY KEY,branch_id INTEGER REFERENCES branches(id),item_id INTEGER REFERENCES items(id),type TEXT NOT NULL,delta REAL NOT NULL,reason TEXT,user_id INTEGER REFERENCES users(id),uuid TEXT UNIQUE,at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id));`);
const hash=(p,s=crypto.randomBytes(8).toString('hex'))=>s+':'+crypto.scryptSync(p,s,32).toString('hex');
const check=(p,h)=>{const a=Buffer.from(hash(p,h.split(':')[0])),b=Buffer.from(h);return a.length===b.length&&crypto.timingSafeEqual(a,b)};
const E=(status,message)=>Object.assign(new Error(message),{status});
const round=n=>Math.round(n*1000)/1000;

function seed(){
  if(db.prepare('SELECT COUNT(*) n FROM branches').get().n)return;
  const B=['Downtown','Riverside','Airport'].map(n=>db.prepare('INSERT INTO branches(name) VALUES(?)').run(n).lastInsertRowid);
  const U=db.prepare('INSERT INTO users(username,name,role,branch_id,pw) VALUES(?,?,?,?,?)');
  U.run('admin','Owner','admin',null,hash('admin123'));
  B.forEach((b,i)=>{U.run('manager'+(i+1),'Manager '+(i+1),'manager',b,hash('manager123'));U.run('staff'+(i+1),'Staff '+(i+1),'staff',b,hash('staff123'))});
  const items=[['Espresso Beans','Ingredients','kg','Bean Co',620,5],['Whole Milk','Ingredients','L','DairyPH',85,20],['Oat Milk','Ingredients','L','DairyPH',140,10],['Sugar','Ingredients','kg','Sweet Supply',65,10],['Chicken Fillet','Ingredients','kg','Farm Fresh',210,15],['Burger Buns','Ingredients','pcs','Baker Bros',9,60],['Cooking Oil','Ingredients','L','Farm Fresh',110,12],['Cups 12oz','Packaging','pcs','PackPro',3.5,300],['Lids 12oz','Packaging','pcs','PackPro',1.5,300],['Takeout Boxes','Packaging','box','PackPro',450,4],['Bottled Water','Beverages','pcs','AquaPH',12,48],['Dish Soap','Cleaning','L','CleanCo',95,6]]
    .map(r=>db.prepare('INSERT INTO items(name,category,unit,supplier,cost,reorder) VALUES(?,?,?,?,?,?)').run(...r).lastInsertRowid);
  const S=db.prepare('INSERT INTO stock VALUES(?,?,?)'),M=db.prepare("INSERT INTO movements(branch_id,item_id,type,delta,reason,user_id) VALUES(?,?,'in',?,'Opening stock',1)");
  B.forEach((b,bi)=>items.forEach((it,ii)=>{const r=db.prepare('SELECT reorder FROM items WHERE id=?').get(it).reorder;const q=round(r*((ii+bi)%4===0?0.6:2.5));S.run(b,it,q);M.run(b,it,q)}));
}
seed();

const routes={};
const R=(m,p,roles,fn)=>routes[m+' '+p]={roles,fn};
const ALL=['admin','manager','staff'],MGR=['admin','manager'];
const pub=u=>({id:u.id,username:u.username,name:u.name,role:u.role,branch_id:u.branch_id});
const branchOf=(u,id)=>u.role==='admin'?(Number(id)||db.prepare('SELECT MIN(id) id FROM branches').get().id):u.branch_id;
const scope=u=>u.role==='admin'?'1=1':'b.id='+Number(u.branch_id);

R('POST','login',null,({b})=>{
  const u=db.prepare('SELECT * FROM users WHERE username=?').get(String(b.username||'').trim().toLowerCase());
  if(!u||!check(String(b.password||''),u.pw))throw E(401,'Wrong username or password');
  const token=crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?)').run(token,u.id);
  return{token,user:pub(u)};
});
R('GET','me',ALL,({u})=>({user:pub(u),branches:db.prepare(u.role==='admin'?'SELECT * FROM branches ORDER BY id':'SELECT * FROM branches WHERE id=?').all(...(u.role==='admin'?[]:[u.branch_id]))}));
R('GET','items',ALL,()=>db.prepare('SELECT * FROM items ORDER BY name').all());
R('POST','items',['admin'],({b})=>{
  const name=String(b.name||'').trim(),unit=String(b.unit||'').trim(),cost=Number(b.cost),reorder=Number(b.reorder);
  if(!name||!unit||!(cost>=0)||!(reorder>=0))throw E(400,'Name, unit, cost and reorder level are required');
  try{db.prepare('INSERT INTO items(name,category,unit,supplier,cost,reorder) VALUES(?,?,?,?,?,?)').run(name,b.category||'',unit,b.supplier||'',cost,reorder)}
  catch{throw E(400,'An item with that name already exists')}
  return{ok:true};
});
R('GET','stock',ALL,({u,q})=>db.prepare('SELECT i.id,i.name,i.category,i.unit,i.cost,i.reorder,COALESCE(s.qty,0) qty FROM items i LEFT JOIN stock s ON s.item_id=i.id AND s.branch_id=? ORDER BY i.name').all(branchOf(u,q.get('branch'))));
R('POST','move',ALL,({u,b})=>{
  const types={in:1,usage:-1,waste:-1,spoilage:-1},sign=types[b.type],q=Number(b.qty),br=branchOf(u,b.branch_id);
  if(!sign)throw E(400,'Choose delivery, usage, waste or spoilage');
  if(!(q>0)||!isFinite(q))throw E(400,'Quantity must be more than 0');
  if((b.type==='waste'||b.type==='spoilage')&&!String(b.reason||'').trim())throw E(400,'Add a reason for waste or spoilage');
  const item=db.prepare('SELECT * FROM items WHERE id=?').get(Number(b.item_id));
  if(!item)throw E(400,'Item not found');
  db.exec('BEGIN');
  try{
    if(b.uuid&&db.prepare('SELECT 1 FROM movements WHERE uuid=?').get(String(b.uuid))){db.exec('ROLLBACK');return{ok:true,duplicate:true}}
    const cur=db.prepare('SELECT qty FROM stock WHERE branch_id=? AND item_id=?').get(br,item.id)?.qty||0,d=sign*q;
    if(round(cur+d)<0)throw E(400,`Only ${cur} ${item.unit} of ${item.name} in stock`);
    db.prepare('INSERT INTO stock VALUES(?,?,?) ON CONFLICT(branch_id,item_id) DO UPDATE SET qty=?').run(br,item.id,round(cur+d),round(cur+d));
    db.prepare('INSERT INTO movements(branch_id,item_id,type,delta,reason,user_id,uuid) VALUES(?,?,?,?,?,?,?)').run(br,item.id,b.type,d,String(b.reason||'').trim(),u.id,b.uuid?String(b.uuid):null);
    db.exec('COMMIT');return{ok:true,qty:round(cur+d)};
  }catch(e){try{db.exec('ROLLBACK')}catch{}throw e}
});
const mv=(u,q,limit)=>{
  const br=u.role==='admin'?(q.get('branch')==='all'?null:branchOf(u,q.get('branch'))):u.branch_id;
  return db.prepare(`SELECT m.id,m.at,b.name branch,i.name item,i.unit,m.type,m.delta,m.reason,us.name by FROM movements m JOIN branches b ON b.id=m.branch_id JOIN items i ON i.id=m.item_id JOIN users us ON us.id=m.user_id ${br?'WHERE m.branch_id='+Number(br):''} ORDER BY m.id DESC LIMIT ${limit}`).all();
};
R('GET','movements',MGR,({u,q})=>mv(u,q,200));
R('GET','dashboard',MGR,({u})=>{
  const w=scope(u),j='FROM branches b CROSS JOIN items i LEFT JOIN stock s ON s.branch_id=b.id AND s.item_id=i.id';
  return{
    branches:db.prepare(`SELECT b.id,b.name,ROUND(SUM(COALESCE(s.qty,0)*i.cost),2) value,SUM(COALESCE(s.qty,0)<=i.reorder) low ${j} WHERE ${w} GROUP BY b.id ORDER BY b.id`).all(),
    low:db.prepare(`SELECT b.name branch,i.name item,i.unit,COALESCE(s.qty,0) qty,i.reorder ${j} WHERE ${w} AND COALESCE(s.qty,0)<=i.reorder ORDER BY COALESCE(s.qty,0)/i.reorder LIMIT 30`).all(),
    recent:mv(u,new URLSearchParams('branch=all'),8)};
});
R('GET','export.csv',MGR,({u,q})=>{
  const c=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  return mv(u,q,100000).reduce((s,r)=>s+[r.at,r.branch,r.item,r.unit,r.type,r.delta,r.reason,r.by].map(c).join(',')+'\n','Date,Branch,Item,Unit,Type,Change,Reason,Recorded by\n');
});

const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://x'),send=(s,body,type='application/json')=>{res.writeHead(s,{'content-type':type+'; charset=utf-8','cache-control':'no-store'});res.end(body)};
  if(!url.pathname.startsWith('/api/')){
    if(url.pathname!=='/')return send(404,'Not found','text/plain');
    return send(200,fs.readFileSync(path.join(__dirname,'public','index.html')),'text/html');
  }
  const route=routes[req.method+' '+url.pathname.slice(5)];
  if(!route)return send(404,JSON.stringify({error:'Not found'}));
  let raw='';req.on('data',d=>{raw+=d;if(raw.length>1e6)req.destroy()});
  req.on('end',()=>{
    try{
      let u=null;
      if(route.roles){
        u=db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get((req.headers.authorization||'').slice(7));
        if(!u)throw E(401,'Please sign in');
        if(!route.roles.includes(u.role))throw E(403,'Your role cannot do this');
      }
      let b={};try{b=raw?JSON.parse(raw):{}}catch{throw E(400,'Invalid JSON')}
      const r=route.fn({u,b,q:url.searchParams});
      typeof r==='string'?send(200,r,'text/csv'):send(200,JSON.stringify(r));
    }catch(e){send(e.status||500,JSON.stringify({error:e.status?e.message:'Server error'}));if(!e.status)console.error(e)}
  });
});
if(require.main===module)server.listen(process.env.PORT||3000,()=>console.log('Stockroom running on port '+(process.env.PORT||3000)));
module.exports=server;
