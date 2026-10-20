import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const root=new URL('../',import.meta.url);
const context=vm.createContext({window:{}});
vm.runInContext(fs.readFileSync(new URL('js/core/bookmarks.js',root),'utf8'),context);
const {create}=context.window.RustedPrayerBookmarks;
const clone=value=>JSON.parse(JSON.stringify(value));
const scene=(n,text)=>({sceneId:`a-01-scene-${String(n).padStart(4,'0')}`,text});
const legacy={counts:{'A-01':2},redirects:{}};
const record=story=>({id:'A-01',story});

test('ID survives copy edits, insertion and reorder; stored index/text are only previews',()=>{
  const mark={recordId:'A-01',sceneId:scene(2).sceneId,index:1,text:'old text'};
  const current=create([record([scene(2,'edited'),scene(3,'inserted'),scene(1,'first')])],legacy);
  assert.deepEqual(clone(current.resolve(mark)),{recordId:'A-01',sceneId:scene(2).sceneId,index:0,text:'edited'});
});
test('legacy numbering is frozen and does not follow the current array',()=>{
  const current=create([record([scene(2,'edited'),scene(1,'first')])],legacy);
  assert.equal(current.resolve({recordId:'A-01',index:1,text:'old text'}).index,0);
});
test('deleted ID never falls back to another scene at the same index',()=>{
  const current=create([record([scene(3,'unrelated')])],legacy);
  const mark={recordId:'A-01',sceneId:scene(1).sceneId,index:0,text:'deleted'};
  assert.equal(current.resolve(mark).status,'missing');
  assert.equal(current.resolve({recordId:'A-01',index:999,text:'unknown'}).status,'unresolved');
  assert.equal(current.normalize([mark]).length,1);
});
test('explicit split/merge redirects may move bookmarks between records',()=>{
  const current=create([{id:'B-01',story:[{sceneId:'b-new',text:'continuation'}]}],
    {...legacy,redirects:{[scene(1).sceneId]:'b-new'}});
  assert.equal(current.resolve({recordId:'A-01',sceneId:scene(1).sceneId}).recordId,'B-01');
  assert.throws(()=>create([record([scene(1,'x'),scene(1,'y')])],legacy),/중복/);
  assert.throws(()=>create([record([{text:'missing'}])],legacy),/누락/);
  assert.throws(()=>create([],{counts:{},redirects:{a:'b',b:'a'}}),/순환/);
  assert.throws(()=>create([],{counts:{},redirects:{a:'missing'}}),/없습니다/);
});
test('native IDs and legacy references deduplicate after migration',()=>{
  const current=create([record([scene(1,'current')])],legacy);
  assert.equal(current.normalize([{recordId:'A-01',index:0,text:'old'},
    {recordId:'A-01',sceneId:scene(1).sceneId,index:99,text:'different'}]).length,1);
});
test('all shipped story/report scenes have unique IDs and frozen legacy mappings',()=>{
  const records=[];
  const data=vm.createContext({window:{RustedPrayerArchive:{registerRecord:r=>records.push(r)}}});
  for(const name of fs.readdirSync(new URL('js/data/records/',root)).filter(n=>n.endsWith('.js')))
    vm.runInContext(fs.readFileSync(new URL('js/data/records/'+name,root),'utf8'),data);
  vm.runInContext(fs.readFileSync(new URL('js/data/bookmark-legacy.js',root),'utf8'),data);
  const catalog=create(records,data.window.RustedPrayerBookmarkLegacy);
  assert.ok(catalog.size>1000);
  for(const [id,from,to,index] of [['C-04','c-04-scene-0003','c-04-scene-0002',1],['C-04','c-04-scene-0088','c-04-scene-0087',85],['B-07','b-07-scene-0152','b-07-scene-0151',150]]) {
    const native=catalog.resolve({recordId:id,sceneId:from});
    const legacy=catalog.resolve({recordId:id,index:Number(from.slice(-4))-1,text:'old'});
    assert.equal(native.sceneId,to);assert.equal(native.index,index);
    assert.equal(legacy.sceneId,to);assert.equal(legacy.index,index);
  }
  for(const r of records) {
    const lines=r.reportSections || r.story;
    for(let i=0;i<lines.length;i++) {
      const resolved=catalog.resolve({recordId:r.id,sceneId:lines[i].sceneId,index:999,text:'old'});
      assert.equal(resolved.index,i);
      assert.equal(resolved.text,lines[i].text || '');
    }
  }
});
