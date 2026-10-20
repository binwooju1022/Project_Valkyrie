import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';

const code = readFileSync(new URL('../js/core/progress-store.js',import.meta.url),'utf8');
function fixture({locks=true}={}) {
  const data = new Map(), pending=[];
  const storage = {get length(){return data.size;},key:i=>[...data.keys()][i],
    getItem:key=>data.get(key) ?? null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  const lock = locks ? {request:(key,fn)=>new Promise(resolve=>pending.push(()=>resolve(fn())))} : null;
  const normalize = value => ({records:{},bookmarks:[],resetGeneration:0,...value});
  const context = vm.createContext({window:{},crypto:webcrypto});
  vm.runInContext(code,context);
  const store = (options={}) => {
    const s=context.window.RustedPrayerProgressStore.create({storage,key:'save',locks:lock,normalize,...options,onError:error=>{throw error;}});
    return {s,value:s.adopt(s.read())};
  };
  const flush = async()=>{while(pending.length){pending.shift()();await new Promise(resolve=>setImmediate(resolve));}};
  return {storage,store,flush,data};
}
const copy = value=>JSON.parse(JSON.stringify(value));

test('bookmark journal uses stable IDs across reordered indices and stale deletions',async()=>{
  const f=fixture(),a=f.store();
  a.value.bookmarks=[{recordId:'A',sceneId:'a-scene-1',index:2,text:'before'}];
  a.value=a.s.save(a.value).value;
  const stale=f.store();
  a.value.bookmarks[0]={...a.value.bookmarks[0],index:5,text:'after'};
  a.value=a.s.save(a.value).value;
  stale.value.bookmarks=[];stale.s.save(stale.value);
  a.value.textSize='large';a.s.save(a.value);
  await f.flush();
  assert.equal(f.store().value.bookmarks.length,0);
});

test('legacy numeric journal entries share the new identity; unresolved marks remain separate',()=>{
  const f=fixture({locks:false}),old=f.store();
  old.value.bookmarks=[{recordId:'A',index:2,text:'old'}];old.value=old.s.save(old.value).value;
  const options={bookmarkId:(_record,id)=>typeof id==='number'?'a-'+id:id};
  const modern=f.store(options);
  modern.value.bookmarks=[{recordId:'A',sceneId:'a-2',index:8,text:'new'},
    {recordId:'A',index:2,text:'unresolved',status:'unresolved'}];
  modern.value=modern.s.save(modern.value).value;
  assert.equal(modern.value.bookmarks.length,2);
  old.value.bookmarks=[];old.s.save(old.value);
  const remaining=f.store(options).value.bookmarks;
  assert.equal(remaining.length,1);
  assert.equal(remaining[0].status,'unresolved');
});

test('ending photo viewing is monotone while archive music follows explicit changes',async()=>{
  const f=fixture(),a=f.store(),b=f.store();
  a.value.endingViewed=true;a.value.archiveMusic='waiting-commander';a.value=a.s.save(a.value).value;
  b.value.endingViewed=false;b.value.textSize='large';b.value=b.s.save(b.value).value;
  assert.equal(f.store().value.endingViewed,true);
  assert.equal(f.store().value.archiveMusic,'waiting-commander');
  a.value.archiveMusic='side-story';a.s.save(a.value);
  b.value.volume=.2;b.s.save(b.value);
  await f.flush();
  assert.equal(f.store().value.archiveMusic,'side-story');
  assert.equal(f.store().value.endingViewed,true);
});

test('reset clears ending viewing and stale tabs cannot restore it or overwrite music',async()=>{
  const f=fixture(),a=f.store();
  a.value.endingViewed=true;a.value.archiveMusic='side-story';a.value=a.s.save(a.value).value;
  const stale=f.store();
  a.s.save({...a.value,records:{},endingViewed:false},true);
  stale.value.archiveMusic='waiting-commander';
  assert.equal(stale.s.save(stale.value).reset,true);
  await f.flush();
  assert.equal(f.store().value.endingViewed,false);
  assert.equal(f.store().value.archiveMusic,'side-story');
});

test('observing remote music allows selecting the previous choice without moving the reader',()=>{
  const f=fixture(),a=f.store();
  a.value.archiveMusic='side-story';a.value.records.A={lineIndex:3};
  a.value=a.s.save(a.value).value;
  const b=f.store();
  b.value.archiveMusic='auto';b.value.records.A.lineIndex=8;b.s.save(b.value);
  const remote=a.s.read();
  assert.equal(a.s.adoptFields(remote,['archiveMusic']),true);
  a.value.archiveMusic=remote.archiveMusic;
  a.value.archiveMusic='side-story';
  const result=a.s.save(a.value).value;
  assert.equal(result.archiveMusic,'side-story');
  assert.equal(result.records.A.lineIndex,8);
});

test('stale settings preserve completed records, seen ranges and bookmarks',async()=>{
  const f=fixture(),a=f.store(),b=f.store();
  a.value.records.A={completed:true,lineIndex:2,seenIndex:8,seenPages:{8:2},profileViews:['one']};
  a.value.bookmarks=[{recordId:'A',index:2,text:'mark'}];
  a.s.save(a.value);
  b.value.textSpeed='fast';b.s.save(b.value);
  await f.flush();
  const saved=f.store().value;
  assert.equal(saved.records.A.completed,true);
  assert.equal(saved.records.A.lineIndex,2);
  assert.equal(saved.records.A.seenIndex,8);
  assert.equal(saved.bookmarks.length,1);
  assert.equal(saved.textSpeed,'fast');
  assert.equal(f.data.size,1);
});

test('backward cursor and bookmark deletion survive stale saves and replay',async()=>{
  const f=fixture(),a=f.store();
  a.value.records.A={lineIndex:10,telemetryPage:2,seenIndex:10};
  a.value.bookmarks=[{recordId:'A',index:2,text:'mark'}];
  a.value=a.s.save(a.value).value;
  const b=f.store();
  a.value.records.A.lineIndex=3;a.value.records.A.telemetryPage=0;a.value.bookmarks=[];
  a.value=a.s.save(a.value).value;
  b.value.records.A.profileViews=['two'];b.s.save(b.value);
  await f.flush();
  const result=f.store().value;
  assert.equal(result.records.A.lineIndex,3);
  assert.equal(result.records.A.telemetryPage,0);
  assert.equal(result.records.A.seenIndex,10);
  assert.equal(result.bookmarks.length,0);
  // A deliberate new addition after observing the deletion remains possible.
  a.value.bookmarks=[{recordId:'A',index:2,text:'mark'}];a.s.save(a.value);
  assert.equal(f.store().value.bookmarks.length,1);
});

test('same-field updates follow save order and independent fields merge',async()=>{
  const f=fixture(),a=f.store(),b=f.store();
  a.value.textSpeed='fast';a.value.textSize='large';a.s.save(a.value);
  b.value.textSpeed='slow';b.value.autoSpeed='fast';b.s.save(b.value);
  await f.flush();
  const saved=f.store().value;
  assert.equal(saved.textSpeed,'slow');assert.equal(saved.textSize,'large');assert.equal(saved.autoSpeed,'fast');
});

test('reset is durable before compaction and blocks stale generation',async()=>{
  const f=fixture(),a=f.store(),b=f.store();
  a.value.records.A={completed:true,lineIndex:20};a.value=a.s.save(a.value).value;
  const old=copy(a.value);
  const next=a.s.save({...a.value,records:{},bookmarks:[]},true).value;
  old.textSize='large';
  assert.equal(b.s.save(old).reset,true);
  assert.equal(f.store().value.records.A,undefined);
  assert.equal(next.resetGeneration,1);
  await f.flush();
  assert.equal(f.store().value.records.A,undefined);
});

test('concurrent reset epochs cannot resurrect old progress',async()=>{
  const f=fixture(),a=f.store(),b=f.store();
  a.value=a.s.save({...a.value,records:{}},true).value;
  a.value.records.A={completed:true};a.value=a.s.save(a.value).value;
  b.value=b.s.save({...b.value,records:{}},true).value;
  assert.equal(a.s.save(a.value).reset,true);
  await f.flush();
  assert.equal(f.store().value.records.A,undefined);
  assert.equal(f.store().value.resetGeneration,2);
});

test('journal survives immediate tab close and works without Web Locks',()=>{
  const f=fixture({locks:false}),a=f.store(),b=f.store();
  a.value.records.A={completed:true};a.s.save(a.value);
  b.value.textSize='large';b.s.save(b.value);
  assert.equal(f.storage.getItem('save'),null);
  const reopened=f.store().value;
  assert.equal(reopened.records.A.completed,true);assert.equal(reopened.textSize,'large');
});

test('failed journal write leaves saved progress intact',()=>{
  const f=fixture(),a=f.store();
  a.value.records.A={completed:true};a.value=a.s.save(a.value).value;
  f.storage.setItem=()=>{throw Error('quota');};
  assert.throws(()=>a.s.save({...a.value,records:{}},true),/quota/);
  assert.equal(f.store().value.records.A.completed,true);
});

test('archive-created default records do not count as cursor changes',async()=>{
  const f=fixture(),a=f.store(),b=f.store();
  b.value.records.A={completed:false,lineIndex:0,seenPages:{}};
  a.value.records.A={lineIndex:7,seenIndex:7,inProgress:true};a.s.save(a.value);
  b.value.textSize='large';b.s.save(b.value);
  await f.flush();
  assert.equal(f.store().value.records.A.lineIndex,7);
});

test('explicit reopening of the same local cursor overrides a newer remote cursor',()=>{
  const f=fixture(),a=f.store();
  a.value.records.A={lineIndex:3};a.value=a.s.save(a.value).value;
  const b=f.store();
  a.value.records.A.lineIndex=7;a.s.save(a.value);
  b.s.save(b.value,false,[JSON.stringify(['records','A','cursor'])]);
  assert.equal(f.store().value.records.A.lineIndex,3);
});

test('pagehide saves durably without starting asynchronous compaction',async()=>{
  const f=fixture(),a=f.store();
  a.value.records.A={completed:true,lineIndex:3};
  a.s.save(a.value,false,[],false);
  await f.flush();
  assert.equal(f.storage.getItem('save'),null);
  assert.equal(f.store().value.records.A.completed,true);
  a.s.compact();await f.flush();
  assert.equal(JSON.parse(f.storage.getItem('save')).records.A.lineIndex,3);
});
