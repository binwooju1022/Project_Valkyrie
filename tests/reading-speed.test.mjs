import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const context=vm.createContext({window:{},crypto:webcrypto});
vm.runInContext(source('js/core/reading-speed.js'),context);
vm.runInContext(source('js/core/progress-store.js'),context);
const speed=context.window.RustedPrayerReadingSpeed;
const levels=['auto-fast','auto-normal','auto-slow','auto-slowest'];
const textLevels=['text-quick','text-normal','text-slow','text-slowest'];

test('normal text speed matches the former fastest pace, with slower options unchanged',()=>{
  assert.deepEqual(textLevels.map(id=>speed.characterDelay('가',id)),[34,51,92,117]);
  assert.deepEqual(textLevels.map(id=>speed.characterDelay(' ',id)),[18,27,49,62]);
  assert.deepEqual(textLevels.map(id=>speed.characterDelay('.',id)),[105,158,284,362]);
  assert.equal(speed.normalizeText(undefined),'text-normal');
  for(const old of ['slow','normal','fast','text-fast'])assert.equal(speed.normalizeText(old),'text-normal');
  for(const id of textLevels)assert.equal(speed.normalizeText(id),id);
});

test('text speed migration preserves instant mode and independent auto choices',()=>{
  const before={textSpeed:'slow',autoSpeed:'auto-slow',instant:true,records:{'A-01':{lineIndex:3}}};
  const after=speed.upgradeSnapshot(before);
  assert.equal(after.textSpeed,'text-normal');assert.equal(after.autoSpeed,'auto-slow');
  assert.equal(after.instant,true);assert.equal(after.records,before.records);
  assert.equal(before.textSpeed,'slow');assert.equal(speed.upgradeSnapshot(after),after);
  const key=JSON.stringify(['textSpeed']);
  const changed=speed.upgradeChange({fields:{[key]:'normal','["instant"]':true}});
  assert.equal(changed.fields[key],'text-normal');assert.equal(changed.fields['["instant"]'],true);
  assert.equal(speed.upgradeChange({reset:before}).reset.textSpeed,'text-normal');
});

test('four levels use the agreed 40-character durations and independent completion floors',()=>{
  const text='가'.repeat(39)+'.';
  assert.deepEqual(levels.map(id=>speed.duration(text,null,id)),[3705,5187,6669,8522]);
  assert.deepEqual(levels.map(id=>speed.wait('네.',null,id,10000)),[250,1500,2500,3500]);
  assert.equal(speed.wait(text,null,'auto-normal',1928),3259);
  assert.equal(speed.wait(text,null,'auto-normal',0),5187); // instant output
  assert.equal(speed.wait('네.',{autoPause:6000,readingBeat:{extraAutoDelay:700}},'auto-slowest',0,true),7700);
});

test('fast preserves the former slow behavior for special text, documents and transitions',()=>{
  assert.equal(speed.duration('탕-!',null,'auto-fast'),1140);
  assert.equal(speed.duration('···',null,'auto-fast'),2280);
  assert.equal(speed.duration('확인',{tone:'document'},'auto-fast'),2280);
  assert.equal(speed.duration('가'.repeat(1000),null,'auto-fast'),34200);
  assert.equal(speed.wait('···',null,'auto-fast',436),1844);
  assert.equal(speed.transition(1,'auto-fast'),4000);
  assert.equal(speed.transition(100,'auto-fast'),12750);
  assert.equal(speed.transition(1000,'auto-fast'),24000);
  assert.deepEqual(levels.map(id=>speed.transition(1000,id)),[24000,33600,43200,55200]);
});

test('new default and legacy mapping are unambiguous and idempotent',()=>{
  assert.equal(speed.normalize(undefined),'auto-normal');
  assert.equal(speed.normalize('invalid'),'auto-normal');
  for(const old of ['slow','normal','fast'])assert.equal(speed.normalize(old),'auto-fast');
  for(const id of levels) {
    const saved={autoSpeed:id,textSpeed:'text-normal',records:{}};
    assert.equal(speed.upgradeSnapshot(saved),saved);
    assert.equal(speed.normalize(speed.normalize(id)),id);
  }
});

test('checkpoint, journal, reset and stale-tab saves retain a chosen new speed',()=>{
  const data=new Map();
  const storage={get length(){return data.size;},key:i=>[...data.keys()][i],getItem:key=>data.get(key)??null,
    setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  const make=modern=>context.window.RustedPrayerProgressStore.create({storage,key:'save',locks:null,
    normalize:value=>({records:{},bookmarks:[],resetGeneration:0,...value}),onError:e=>{throw e;},
    ...(modern?{upgradeSnapshot:speed.upgradeSnapshot,upgradeChange:speed.upgradeChange}:{})});
  data.set('save',JSON.stringify({autoSpeed:'slow',textSpeed:'slow',records:{'A-01':{lineIndex:3}},bookmarks:[]}));
  const old=make(false);let oldValue=old.adopt(old.read());
  const modern=make(true);let value=modern.adopt(modern.read());
  assert.equal(value.autoSpeed,'auto-fast');
  value.autoSpeed='auto-slowest';value.textSpeed='text-slowest';value=modern.save(value).value;
  oldValue.textSize='large';oldValue=old.save(oldValue).value;
  assert.equal(make(true).read().autoSpeed,'auto-slowest');
  assert.equal(make(true).read().textSpeed,'text-slowest');
  oldValue.textSpeed='normal';oldValue=old.save(oldValue).value;
  assert.equal(make(true).read().textSpeed,'text-normal');
  assert.equal(make(true).read().autoSpeed,'auto-slowest');
  oldValue.autoSpeed='normal';old.save(oldValue); // legacy speed journal
  assert.equal(make(true).read().autoSpeed,'auto-fast');
  value=modern.adopt(modern.read());value.autoSpeed='auto-slow';
  modern.save(value,true);
  assert.equal(make(true).read().autoSpeed,'auto-slow');
  assert.equal(make(true).read().records['A-01'].lineIndex,3);
});

// Execute the production scheduler and settings preview with a deterministic
// timer queue: verify their wiring, not just the arithmetic helper in isolation.
function appFunction(name) {
  const app=source('js/app.js'),start=app.indexOf('  function '+name+'(');
  assert.ok(start>=0,name);
  return app.slice(start,app.indexOf('\n  }',start)+4);
}
test('all 16 combinations finish typing before the auto timer and keep completion floors',()=>{
  const text='안녕하세요. 함께 읽어요.';
  for(const textSpeed of textLevels)for(const autoSpeed of levels) {
    const timers=new Map(),writes=[];
    let elapsed=0,advanced=0;
    const state={textSpeed,autoSpeed,screen:'story-screen',auto:true,lineIndex:0,instant:false};
    const sandbox=vm.createContext({state,readingSpeed:speed,document:{hidden:false},
      $:()=>({hidden:true,open:false}),currentStory:()=>[{text}],syncAutoStatus(){},revealDecision(){},
      canAutoAdvance:()=>!state.isTyping,writeTypedText:(_target,value)=>writes.push(value),
      stopPlaybackTimer:field=>timers.delete(field),
      setPlaybackTimer:(field,callback,delay)=>timers.set(field,{callback,delay}),
      nextLine:()=>advanced++,target:{},text});
    vm.runInContext(['startTypewriter','finishTyping','scheduleAutoAdvance'].map(appFunction).join('\n'),sandbox);
    vm.runInContext('startTypewriter(target,text)',sandbox);
    while(timers.has('typeTimer')) {
      assert.equal(timers.has('autoTimer'),false);
      const task=timers.get('typeTimer');timers.delete('typeTimer');elapsed+=task.delay;task.callback();
    }
    assert.equal(writes.at(-1),text);assert.equal(state.isTyping,false);assert.equal(advanced,0);
    const expectedTyping=120+[...text.slice(0,-1)].reduce((sum,c)=>sum+speed.characterDelay(c,textSpeed),0);
    assert.equal(elapsed,expectedTyping);assert.equal(state.typingCredit,elapsed);
    assert.equal(timers.get('autoTimer').delay,speed.wait(text,null,autoSpeed,elapsed));
    timers.get('autoTimer').callback();assert.equal(advanced,1);
    timers.clear();state.instant=true;
    vm.runInContext('startTypewriter(target,text)',sandbox);
    assert.equal(timers.has('typeTimer'),false);assert.equal(writes.at(-1),text);
    assert.equal(timers.get('autoTimer').delay,speed.wait(text,null,autoSpeed,0));
  }
});

test('settings and backup validation accept independent four-level choices and legacy saves',()=>{
  const nodes=new Map();
  const $=id=>{if(!nodes.has(id))nodes.set(id,{value:''});return nodes.get(id);};
  const state={};let saved=0;
  const sandbox=vm.createContext({state,readingSpeed:speed,$,orderedRecords:[],window:{},
    defaultDialoguePosition:()=> 'center',allRecordsRead:()=>false,applyReadingSettings(){},
    saveProgress:()=>saved++,startSettingsPreview(){}});
  vm.runInContext(['changeReadingSettings','validateImport'].map(appFunction).join('\n'),sandbox);
  for(const textSpeed of textLevels)for(const autoSpeed of levels) {
    $('#setting-speed').value=textSpeed;$('#setting-auto').value=autoSpeed;$('#setting-instant').value='on';
    vm.runInContext('changeReadingSettings()',sandbox);
    assert.equal(state.textSpeed,textSpeed);assert.equal(state.autoSpeed,autoSpeed);assert.equal(state.instant,true);
    $('#setting-instant').value='off';vm.runInContext('changeReadingSettings()',sandbox);
    assert.equal(state.textSpeed,textSpeed);assert.equal(state.instant,false);
    sandbox.backup={version:24,records:{},textSpeed,autoSpeed,instant:true};
    vm.runInContext('validateImport(backup)',sandbox);
  }
  assert.equal(saved,32);
  sandbox.backup={version:24,records:{},textSpeed:'slow',autoSpeed:'normal',instant:true};
  vm.runInContext('validateImport(backup)',sandbox);
  sandbox.backup.textSpeed='unknown';assert.throws(()=>vm.runInContext('validateImport(backup)',sandbox),/textSpeed/);
});

test('live playback, transition and preview schedule the same four-level policy',()=>{
  const nodes=new Map();
  const $=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{hidden:true,open:false,classList:{add(){}},value:0});
    return nodes.get(selector);
  };
  let queued=[];
  const line={text:'가'.repeat(40)};
  const state={autoSpeed:'auto-normal',auto:true,screen:'story-screen',lineIndex:0,fullText:line.text,
    typingCredit:2000,settingsCategory:'reading',instant:true};
  const sandbox=vm.createContext({state,readingSpeed:speed,$,document:{hidden:false},
    stopPlaybackTimer(){},syncAutoStatus(){},canAutoAdvance:()=>true,currentStory:()=>[line],nextLine(){},
    setPlaybackTimer:(field,callback,delay)=>queued.push({field,callback,delay}),
    setTimeout:(callback,delay)=>{queued.push({callback,delay});return queued.length;},clearTimeout(){},
    motionReduced:()=>true,archive:{getRecord:()=>({objective:[{text:'가'.repeat(39)}],title:'가'})},
    continueRecordTransition(){}});
  vm.runInContext(['scheduleAutoAdvance','startSettingsPreview'].map(appFunction).join('\n'),sandbox);
  vm.runInContext('scheduleAutoAdvance()',sandbox);
  assert.equal(queued.at(-1).delay,3187);
  state.autoSpeed='auto-slowest';state.fullText='네.';state.typingCredit=10000;
  vm.runInContext('scheduleAutoAdvance()',sandbox);
  assert.equal(queued.at(-1).delay,3500);
  state.screen='transition-screen';state.transition={toId:'A-02'};
  vm.runInContext('scheduleAutoAdvance()',sandbox);
  assert.equal(queued.at(-1).delay,11730);
  state.screen='settings-screen';
  for(const id of levels) {
    state.autoSpeed=id;state.instant=true;queued=[];
    vm.runInContext('startSettingsPreview()',sandbox);
    const sample=$('#reading-sample').textContent;
    assert.equal($('#preview-status').textContent,`짧은 대사 · 다음 문장까지 ${(speed.wait(sample,null,id,0)/1000).toFixed(1)}초`);
  }
  // Slow typewriter in the preview must subtract typing time and use the floor.
  state.autoSpeed='auto-slow';state.instant=false;queued=[];
  vm.runInContext('startSettingsPreview()',sandbox);
  let credit=0;
  while($('#preview-status').textContent.endsWith('문자 출력 중')) {
    const timer=queued.shift();assert.ok(timer);credit+=timer.delay;timer.callback();
  }
  const sample=$('#reading-sample').textContent;
  assert.equal($('#preview-status').textContent,`짧은 대사 · 다음 문장까지 ${(speed.wait(sample,null,'auto-slow',credit)/1000).toFixed(1)}초`);
});

test('settings expose four speeds for each control and separate instant output',()=>{
  const html=source('index.html');
  const options=id=>[...html.match(new RegExp('<select id="'+id+'"[\\s\\S]*?</select>'))[0].matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)].map(m=>[m[1],m[2]]);
  assert.deepEqual(options('setting-auto'),[['auto-slowest','아주 느리게'],['auto-slow','느리게'],['auto-normal','보통'],['auto-fast','빠르게']]);
  assert.deepEqual(options('setting-speed'),[['text-slowest','아주 느리게'],['text-slow','느리게'],['text-normal','보통'],['text-quick','빠르게']]);
  assert.deepEqual(options('setting-instant'),[['off','끄기'],['on','켜기']]);
  assert.ok(html.indexOf('./js/core/reading-speed.js')<html.indexOf('./js/app.js'));
});
