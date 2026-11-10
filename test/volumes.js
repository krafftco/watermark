process.env.NODE_ENV='test';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),sharp=require('sharp');
const {createApp}=require('../src/app');const {pageOf}=require('../src/volumes');
(async()=>{
assert.deepStrictEqual(pageOf('Codex Arundel f. 3r'),{stem:'Codex Arundel',n:3,side:1});
assert.strictEqual(pageOf('Codex Atlanticus, folio 12 verso').side,2);assert.strictEqual(pageOf('Battle of Anghiari (1505)').n,null);assert.strictEqual(pageOf('Study of a horse').n,null);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wm-vol-'));
const app=createApp({dataDir:dir,base:'http://localhost',adminPassword:'pw',secret:'vol',noTimers:true,vaultNow:true});
const {db}=app.locals;const srv=app.listen(0);const base='http://127.0.0.1:'+srv.address().port;
const a=app.locals.art.ensure('Leonardo da Vinci',{born:1452,died:1519});
const mk=async(t,i)=>{const f=path.join(dir,'f'+i+'.jpg');await sharp({create:{width:900,height:1200,channels:3,noise:{type:'gaussian',mean:40+i*17,sigma:30}}}).jpeg().toFile(f);const w=await app.locals.registerWork({file:f,title:t,originalName:'f'+i+'.jpg',kind:'drawing'});db.prepare("UPDATE works SET status='held', artist_id=?, kind='drawing', open='pd', hall=1 WHERE id=?").run(a.id,w.id);return db.prepare('SELECT * FROM works WHERE id=?').get(w.id);};
// seven folios, brought in out of order, and a painting that is not a page
const order=[4,1,7,2,6,3,5];const ws={};let k=0;for(const n of order)ws[n]=await mk('Codex Arundel, folio '+n,++k);
const lady=await mk('Lady with an Ermine',9);
const V=app.locals.volumes;let r=V.propose({artistId:a.id});assert.strictEqual(r.made,1,'one volume proposed');assert.strictEqual(r.pages,7);
assert.strictEqual(V.propose({artistId:a.id}).made,0,'never twice');
let v=db.prepare('SELECT * FROM volumes').get();assert.strictEqual(v.status,'proposed');assert.ok(/codex arundel/i.test(v.title));
const ps=V.pagesOf(v);assert.deepStrictEqual(ps.map(p=>p.id),[1,2,3,4,5,6,7].map(n=>ws[n].id),'in page order');
// proposed: a stranger sees nothing; the wall rule is untouched
assert.strictEqual((await fetch(base+'/volume/'+v.slug)).status,404);
const wall=require('../src/wall');const onWalls=()=>db.prepare("SELECT COUNT(*) n FROM works w WHERE w.status='held'"+wall.sql('w')).get().n;
const before=onWalls();
// the Studio opens it
const jar=(await fetch(base+'/studio/login',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:'password=pw'})).headers.get('set-cookie').split(';')[0];
let h=await (await fetch(base+'/studio/volumes',{headers:{cookie:jar}})).text();assert.ok(h.includes('Open it')&&/Codex Arundel/i.test(h),'the desk');
const res=await fetch(base+'/studio/volumes/'+v.id,{method:'POST',redirect:'manual',headers:{cookie:jar,'content-type':'application/x-www-form-urlencoded',origin:base},body:'title=Codex+Arundel&keeper=British+Library&do=open'});assert.strictEqual(res.status,302);
v=V.byId(v.id);assert.strictEqual(v.status,'open');assert.strictEqual(v.keeper,'British Library');
assert.strictEqual(onWalls(),before-6,'six pages left the open walls; the first stays');
assert.ok(db.prepare("SELECT 1 x FROM works w WHERE w.id=?"+wall.sql('w')).get(ws[1].id),'the first page still hangs');
// the viewer
h=await (await fetch(base+'/volume/'+v.slug+'?p=3')).text();assert.ok(h.includes('class="vlm"')&&h.includes('data-at="3"')&&h.includes('British Library')&&h.includes('"pages":[')&&h.includes(ws[7].slug),'the volume');assert.ok(/<html[^>]*class="dk"/.test(h),'a dark room');
h=await (await fetch(base+'/volumes')).text();assert.ok(h.includes('/volume/'+v.slug));
// the artist's page, the page's own record, Find
app.locals.art.uncache&&app.locals.art.uncache(a.slug);
h=await (await fetch(base+'/art/'+a.slug)).text();assert.ok(h.includes('Bound volumes')&&h.includes('/volume/'+v.slug),'on the artist page');
h=await (await fetch(base+'/w/'+ws[3].slug)).text();assert.ok(h.includes('Page 3 of 7')&&h.includes('/volume/'+v.slug+'?p=3'),'the page says where it is bound');
h=await (await fetch(base+'/w/'+lady.slug)).text();assert.ok(!h.includes('vlm-line'));
app.locals.findIndexDirty&&app.locals.findIndexDirty();
const j=await (await fetch(base+'/api/find?q=arundel')).json();assert.ok((j.books||[]).some(b=>b.href==='/volume/'+v.slug),'Find answers the volume: '+JSON.stringify(j.books));
// closed: every page as it was
await fetch(base+'/studio/volumes/'+v.id,{method:'POST',redirect:'manual',headers:{cookie:jar,'content-type':'application/x-www-form-urlencoded',origin:base},body:'title=Codex+Arundel&do=close'});
assert.strictEqual(onWalls(),before,'closed: back on the walls');assert.strictEqual((await fetch(base+'/volume/'+v.slug)).status,404);
console.log('volumes: hold');process.exit(0);})().catch(e=>{console.error(e);process.exit(1)});
