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
// pages by hand (13 Nov, #33): add, take out, move; pos dense, n and vol_page true after each
const post=(p,body)=>fetch(base+p,{method:'POST',redirect:'manual',headers:{cookie:jar,'content-type':'application/x-www-form-urlencoded',origin:base},body:new URLSearchParams(body).toString()});
const okOf=r=>decodeURIComponent(new URL(r.headers.get('location'),base).searchParams.get('ok')||'');
const vp=id=>db.prepare('SELECT vol_page FROM works WHERE id=?').get(id).vol_page;
const pagesNow=vv=>db.prepare('SELECT work_id, pos FROM volume_pages WHERE volume_id=? ORDER BY pos').all(vv.id);
const sound=(vv,msg)=>{vv=V.byId(vv.id);const o=pagesNow(vv);assert.deepStrictEqual(o.map(x=>x.pos),o.map((x,i)=>i),msg+': pos dense');assert.strictEqual(vv.n,o.length,msg+': n');
  if(vv.status==='open')o.forEach((x,i)=>assert.strictEqual(vp(x.work_id),i===0?0:vv.id,msg+': vol_page of page '+(i+1)));return o.map(x=>x.work_id);};
const S=V.slugFrom;assert.strictEqual(S('codex-arundel-folio-1'),'codex-arundel-folio-1');assert.strictEqual(S('/w/abc-1'),'abc-1');assert.strictEqual(S('/m/the-house/abc-1'),'abc-1');
assert.strictEqual(S('/wander?at=abc-1&in=open'),'abc-1');assert.strictEqual(S('/easel/abc-1?back=%2F'),'abc-1');assert.strictEqual(S('https://watermark.krafftco.com/m/x/abc-1'),'abc-1');
assert.strictEqual(S('https://watermark.krafftco.com/wander?at=abc-1'),'abc-1');assert.ok(S('https://example.com/w/abc-1').foreign,'another site is not read');assert.strictEqual(S('/collection'),null);
// add by slug, at the end: on the open volume, off the walls, and in the viewer at once
r=await post('/studio/volumes/'+v.id+'/pages',{at:lady.slug,label:'added'});assert.strictEqual(r.status,302);assert.strictEqual(okOf(r),'Added as page 8.');
let ids=sound(v,'added at the end');assert.strictEqual(ids[7],lady.id);assert.strictEqual(vp(lady.id),v.id);
assert.ok(!db.prepare("SELECT 1 x FROM works w WHERE w.id=?"+wall.sql('w')).get(lady.id),'an added page leaves the open walls');
h=await (await fetch(base+'/volume/'+v.slug)).text();assert.ok(h.includes(lady.slug)&&h.includes('"l":"added"'),'the added page is in the volume');
h=await (await fetch(base+'/studio/volumes?show=open&pages='+v.id,{headers:{cookie:jar}})).text();assert.ok(h.includes('vlm-pgl')&&h.includes('Move earlier')&&h.includes('Take out')&&h.includes('Add a page'),'the desk opens the pages');
// take out: back on the walls
r=await post('/studio/volumes/'+v.id+'/pages/'+lady.id+'/out',{});assert.strictEqual(okOf(r),'Taken out; it is back on the walls.');
ids=sound(v,'taken out');assert.ok(!ids.includes(lady.id));assert.strictEqual(vp(lady.id),null);assert.ok(db.prepare("SELECT 1 x FROM works w WHERE w.id=?"+wall.sql('w')).get(lady.id),'back on the walls');
// add by a full address of the house, as the first page: the first page changes and vol_page follows
const hd=db.prepare('SELECT handle FROM makers WHERE id=?').get(lady.maker_id).handle;
r=await post('/studio/volumes/'+v.id+'/pages',{at:'https://watermark.krafftco.com/m/'+hd+'/'+lady.slug,after:'0'});assert.strictEqual(okOf(r),'Added as page 1.');
ids=sound(v,'added first');assert.strictEqual(ids[0],lady.id);assert.strictEqual(vp(lady.id),0);assert.strictEqual(vp(ws[1].id),v.id,'the old first page leaves the walls');
// after page N, by the Wander address
const loose=await mk('Study of hands',10);r=await post('/studio/volumes/'+v.id+'/pages',{at:base+'/wander?at='+loose.slug,after:'3'});assert.strictEqual(okOf(r),'Added as page 4.');
ids=sound(v,'after page 3');assert.strictEqual(ids[3],loose.id);
// move: later and earlier; the first page follows
r=await post('/studio/volumes/'+v.id+'/pages/'+lady.id+'/later',{});assert.strictEqual(okOf(r),'Moved to page 2.');
ids=sound(v,'moved later');assert.strictEqual(ids[0],ws[1].id);assert.strictEqual(ids[1],lady.id);assert.strictEqual(vp(ws[1].id),0);assert.strictEqual(vp(lady.id),v.id);
r=await post('/studio/volumes/'+v.id+'/pages/'+loose.id+'/earlier',{});assert.strictEqual(okOf(r),'Moved to page 3.');ids=sound(v,'moved earlier');assert.strictEqual(ids[2],loose.id);
r=await post('/studio/volumes/'+v.id+'/pages/'+ws[1].id+'/earlier',{});assert.strictEqual(okOf(r),'Already the first page.');sound(v,'no move');
// the first page taken out: the next becomes the first
r=await post('/studio/volumes/'+v.id+'/pages/'+ws[1].id+'/out',{});ids=sound(v,'first taken out');assert.strictEqual(ids[0],lady.id);assert.strictEqual(vp(lady.id),0);assert.strictEqual(vp(ws[1].id),null);
h=await (await fetch(base+'/w/'+loose.slug)).text();assert.ok(h.includes('Page 2 of 8'),'the record says where the page is bound now');
// refused: unknown, another site, kept back, quarantined, already here, already in another open volume, a living maker without the tick
const no=async(at,want,extra={})=>{const n0=V.byId(v.id).n;const rr=await post('/studio/volumes/'+v.id+'/pages',{at,...extra});assert.strictEqual(okOf(rr),want,at);assert.strictEqual(V.byId(v.id).n,n0,'nothing added: '+at);};
await no('no-such-work','No work at that address.');await no('https://example.com/w/'+loose.slug,'That address is not the house’s.');
const kept=await mk('Kept sheet',11);db.prepare('UPDATE works SET keep_back=1 WHERE id=?').run(kept.id);await no(kept.slug,'Its maker keeps that picture back.');
const q=await mk('Held sheet',12);db.prepare("UPDATE works SET status='quarantined' WHERE id=?").run(q.id);await no(q.slug,'That work is not on view and cannot be placed.');
await no('/w/'+loose.slug,'Already page 2 of this volume.');
const o1=await mk('Other notebook sheet',13),o2=await mk('Other notebook sheet two',14);
const ov=Number(db.prepare("INSERT INTO volumes (slug, stem, title, artist_id, status, n, created_at) VALUES ('other-notebook','other notebook','Other Notebook',?,'proposed',2,'2026-11-13')").run(a.id).lastInsertRowid);
db.prepare('INSERT INTO volume_pages (volume_id, work_id, pos) VALUES (?, ?, 0), (?, ?, 1)').run(ov,o1.id,ov,o2.id);V.open(V.byId(ov));
await no('/easel/'+o2.slug,'Already a page of Other Notebook, which is open.');
const liv=await mk('A living maker’s photograph',15);db.prepare('UPDATE works SET open=NULL, artist_id=NULL WHERE id=?').run(liv.id);
await no(liv.slug,'A living maker’s picture: tick the box to place it.');
r=await post('/studio/volumes/'+v.id+'/pages',{at:liv.slug,living:'1'});assert.strictEqual(okOf(r),'Added as page 9.');sound(v,'living, with the tick');
// a hidden work of the house's own may be placed, and shows as a page; a hidden living maker's may not
const hid=await mk('Hidden folio',16);db.prepare("UPDATE works SET status='hidden' WHERE id=?").run(hid.id);
r=await post('/studio/volumes/'+v.id+'/pages',{at:hid.slug});assert.strictEqual(okOf(r),'Added as page 10.');assert.ok(V.pagesOf(V.byId(v.id)).some(p=>p.id===hid.id),'a placed hidden page is shown');
db.prepare("UPDATE works SET status='hidden' WHERE id=?").run(liv.id);r=await post('/studio/volumes/'+v.id+'/pages/'+liv.id+'/out',{});
await no(liv.slug,'Its maker keeps that picture off the walls.',{living:'1'});
// a proposed volume changes its pages without touching vol_page
const pv=Number(db.prepare("INSERT INTO volumes (slug, stem, title, artist_id, status, n, created_at) VALUES ('a-proposed-book','a proposed book','A Proposed Book',?,'proposed',0,'2026-11-13')").run(a.id).lastInsertRowid);
const pw=await mk('Loose drawing',17);const pvv=V.byId(pv);assert.strictEqual(V.addPage(pvv,{at:pw.slug}).ok,'Added as page 1.');assert.strictEqual(V.addPage(pvv,{at:kept.slug}).no,'Its maker keeps that picture back.');
assert.strictEqual(V.addPage(pvv,{at:o1.slug}).no,'Already a page of Other Notebook, which is open.');
const pw2=await mk('Loose drawing two',18);V.addPage(pvv,{at:pw2.slug,after:0});assert.deepStrictEqual(sound(pvv,'proposed'),[pw2.id,pw.id]);assert.strictEqual(vp(pw.id),null);assert.strictEqual(vp(pw2.id),null);
V.movePage(pvv,pw2.id,1);V.takeOut(pvv,pw.id);assert.deepStrictEqual(sound(pvv,'proposed, moved and taken out'),[pw2.id]);assert.strictEqual(vp(pw2.id),null);
// the register keeps each change, off the public stream
for(const t of ['volume.page.added','volume.page.removed','volume.page.moved'])assert.ok(db.prepare('SELECT 1 x FROM ledger WHERE type=? LIMIT 1').get(t),t);
h=await (await fetch(base+'/register')).text();assert.ok(!h.includes('volume page'),'hidden from the register');
// closed: every page as it was
const pre=onWalls(),off=db.prepare("SELECT COUNT(*) n FROM works WHERE vol_page=? AND status='held'").get(v.id).n;assert.strictEqual(off,7);
await fetch(base+'/studio/volumes/'+v.id,{method:'POST',redirect:'manual',headers:{cookie:jar,'content-type':'application/x-www-form-urlencoded',origin:base},body:'title=Codex+Arundel&do=close'});
assert.strictEqual(onWalls(),pre+off,'closed: back on the walls');assert.strictEqual((await fetch(base+'/volume/'+v.slug)).status,404);
console.log('volumes: hold');process.exit(0);})().catch(e=>{console.error(e);process.exit(1)});
