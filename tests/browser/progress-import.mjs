import assert from 'node:assert/strict';

const backup = overrides => ({version:24,records:{'A-04':{completed:true,lineIndex:0}},bookmarks:[],
  c02LayoutVersion:1,b03LayoutVersion:1,c03LayoutVersion:1,d04LayoutVersion:1,b07LayoutVersion:1,d05LayoutVersion:1,...overrides});
const upload = async (page,value) => {
  await page.locator('#save-import').setInputFiles({name:'backup.json',mimeType:'application/json',
    buffer:Buffer.from(typeof value==='string'?value:JSON.stringify(value))});
  await page.waitForFunction(()=>document.querySelector('#save-import').value==='');
  return page.locator('#save-status').textContent();
};
const snapshot = page => page.evaluate(()=>({
  saved:window.__audit.progressStore.read(),
  live:window.__audit.state.progress,
  settings:['instant','continuous','textSize','textSpeed','autoEnabled'].map(key=>window.__audit.state[key])
}));
async function settings(page) {
  await page.evaluate(()=>window.__audit.showScreen('settings-screen'));
  await page.locator('#settings-tab-data').click();
}

export async function run({setup,ready,out,capture}) {
  const {context,page}=await setup();
  await settings(page);
  await page.evaluate(()=>{
    const a=window.__audit;
    Object.assign(a.recordProgress('A-01'),{completed:true,lineIndex:3,seenIndex:5});
    Object.assign(a.recordProgress('A-02'),{completed:false,lineIndex:4,inProgress:true});
    a.state.progress.resumeRecordId='A-02';a.state.textSize='large';
    a.state.progress.bookmarks=[{recordId:'A-01',index:0,text:a.orderedRecords.find(r=>r.id==='A-01').story[0].text}];
    a.saveProgress();
  });
  const mark=await page.evaluate(()=>({recordId:'A-04',index:0,text:window.__audit.orderedRecords.find(r=>r.id==='A-04').story[0].text}));
  const invalid=[
    ['numeric bookmark ID',backup({bookmarks:[{...mark,recordId:42}]})],
    ['missing bookmark index',backup({bookmarks:[{recordId:mark.recordId,text:mark.text}]})],
    ['missing bookmark text',backup({bookmarks:[{recordId:mark.recordId,index:0}]})],
    ['invalid scene ID',backup({bookmarks:[{...mark,sceneId:'<invalid>'}]})],
    ['missing record fields',backup({records:{'A-04':{}}})],
    ['record array',backup({records:{'A-04':[]}})],
    ['record null',backup({records:{'A-04':null}})],
    ['boolean type',backup({records:{'A-04':{completed:'true',lineIndex:0}}})],
    ['negative position',backup({records:{'A-04':{completed:true,lineIndex:-1}}})],
    ['out of range',backup({records:{'A-04':{completed:true,lineIndex:999999}}})],
    ['invalid nested page',backup({records:{'A-04':{completed:true,lineIndex:0,seenPages:{0:'1'}}}})],
    ['invalid nested views',backup({records:{'A-04':{completed:true,lineIndex:0,profileViews:[3]}}})],
    ['unknown record',backup({records:{'X-01':{completed:true,lineIndex:0}}})],
    ['bad resume',backup({resumeRecordId:42})],
    ['bad settings',backup({textSize:'giant'})],
    ['invalid version zero',backup({version:0})],
    ['future version',backup({version:25})],
    ['missing records',{version:24}],
    ['bad JSON','{"records":'],
    ['prototype key','{"version":24,"records":{"__proto__":{"completed":true,"lineIndex":0}}}']
  ];
  for(const [name,value] of invalid) {
    const before=await snapshot(page);
    const status=await upload(page,value);
    assert.match(status,/적용하지 않았/);assert.deepEqual(await snapshot(page),before,name);
    out('invalid-backup-preserves-state',{case:name,status});
  }
  const beforeCancel=await snapshot(page);
  await page.locator('#save-import').setInputFiles([]);
  assert.deepEqual(await snapshot(page),beforeCancel);
  const status=await upload(page,backup({bookmarks:[mark],textSpeed:'fast'}));
  assert.match(status,/합쳤습니다/);
  let saved=(await snapshot(page)).saved;
  assert.equal(saved.records['A-01'].completed,true);
  assert.equal(saved.records['A-02'].lineIndex,4);
  assert.equal(saved.records['A-04'].completed,true);
  assert.equal(saved.resumeRecordId,'A-02');
  assert.equal(saved.bookmarks.length,2);
  assert.equal(saved.textSize,'large');assert.equal(saved.textSpeed,'text-normal');
  await page.reload();await page.waitForFunction(()=>window.__audit&&!window.__audit.state.loading);
  await settings(page);
  assert.equal((await snapshot(page)).saved.records['A-04'].completed,true);
  // An exported current save, including sync metadata, must round trip.
  const roundTrip=(await snapshot(page)).saved;
  assert.match(await upload(page,roundTrip),/합쳤습니다/);
  out('valid-import-and-roundtrip',{completion:true,bookmarks:true,resume:true,reload:true});

  // All supported historical versions run their existing migration, including
  // the D-02 -> D-01 layout and the version-1 B-06 sample split.
  for(let version=1;version<=23;version++) {
    const legacy={version,records:{'A-04':{completed:true,lineIndex:0}},bookmarks:[]};
    if(version<20)Object.assign(legacy.records,{'D-01':{completed:true,lineIndex:0},'D-02':{completed:true,lineIndex:0}});
    if(version===1)legacy.records['B-06']={completed:true,lineIndex:0};
    assert.match(await upload(page,legacy),/합쳤습니다/,`version ${version}`);
    saved=(await snapshot(page)).saved;
    assert.equal(saved.records['A-04'].completed,true);
    if(version<20)assert.equal(saved.records['D-01'].completed,true);
    if(version===1)assert.equal(saved.records['B-06-01'].completed,true);
  }
  assert.match(await upload(page,{records:{'A-04':{completed:true,lineIndex:0}}}),/합쳤습니다/);
  out('legacy-versions',{versions:'unversioned, 1–23',dLayout:true,sampleSplit:true});
  const legacyBookmark=await page.evaluate(()=>{
    const record=window.__audit.orderedRecords.find(r=>r.id==='B-07');
    const index=25,mapped=record.v23IndexMap[index];
    return {index,mapped,text:record.story[mapped].text};
  });
  assert.match(await upload(page,{version:23,records:{'B-07':{completed:true,lineIndex:legacyBookmark.index}},
    bookmarks:[{recordId:'B-07',index:legacyBookmark.index,text:'historical text'}]}),/합쳤습니다/);
  saved=(await snapshot(page)).saved;
  assert.equal(saved.records['B-07'].lineIndex,legacyBookmark.mapped);
  assert.equal(saved.bookmarks.find(mark=>mark.recordId==='B-07').text,legacyBookmark.text);
  out('legacy-bookmark-migration',{mappedPosition:true,mappedText:true});
  const beforeOversize=await snapshot(page);
  await page.evaluate(()=>window.__audit.importProgress({size:2000001,text:()=>{throw Error('must not read');}}));
  assert.match(await page.locator('#save-status').textContent(),/너무 큽니다/);
  assert.deepEqual(await snapshot(page),beforeOversize);
  // Inject a durable-write failure, not a UI-only error.
  await page.evaluate(()=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){
    if(key.includes(':change:'))throw new DOMException('full','QuotaExceededError');
    return window.originalSetItem.call(this,key,value);
  };});
  const beforeFailure=await snapshot(page);
  assert.match(await upload(page,backup({textSize:'small',records:{'A-05':{completed:true,lineIndex:0}}})),/저장할 수 없어/);
  assert.deepEqual(await snapshot(page),beforeFailure);
  await page.evaluate(()=>{Storage.prototype.setItem=window.originalSetItem;});
  out('storage-failure',{savedAndLiveUnchanged:true});

  // A delayed file read must not revive progress after another tab resets it.
  const other=await context.newPage();await ready(other);
  await page.evaluate(()=>{
    window.pendingImport=window.__audit.importProgress({size:100,text:()=>new Promise(resolve=>window.releaseImport=resolve)});
  });
  await other.evaluate(()=>{
    const a=window.__audit,latest=a.progressStore.read();
    a.progressStore.adopt(latest);a.progressStore.save({...latest,records:{},bookmarks:[]},true);
  });
  await page.evaluate(async text=>{window.releaseImport(text);await window.pendingImport;},JSON.stringify(backup()));
  assert.match(await page.locator('#save-status').textContent(),/초기화/);
  assert.notEqual((await snapshot(page)).saved.records['A-04']?.completed,true);
  out('reset-during-file-read',{oldBackupNotApplied:true});
  await settings(page);
  assert.match(await upload(page,backup({textSpeed:'fast'})),/합쳤습니다/);
  await other.evaluate(()=>{window.__audit.state.textSize='small';window.__audit.saveProgress();});
  saved=(await snapshot(page)).saved;
  assert.equal(saved.records['A-04'].completed,true);assert.equal(saved.textSize,'small');
  out('stale-tab-after-import',{completionPreserved:true});
  // The latest selected file wins even if an older read finishes later.
  await page.evaluate(()=>{
    window.pendingImport=window.__audit.importProgress({size:100,text:()=>new Promise(resolve=>window.releaseImport=resolve)});
  });
  assert.match(await upload(page,backup({textSpeed:'text-slowest'})),/합쳤습니다/);
  await page.evaluate(async text=>{window.releaseImport(text);await window.pendingImport;},JSON.stringify(backup({textSpeed:'fast'})));
  assert.equal((await snapshot(page)).saved.textSpeed,'text-slowest');
  out('overlapping-file-reads',{latestSelectionWins:true});
  await context.close();

  for(const [width,height,mobile] of [[412,915,true],[320,568,true],[915,412,true],[1366,768,false],[1280,720,false]]) {
    const {context,page}=await setup({width,height,mobile});
    await settings(page);
    assert.match(await upload(page,backup({bookmarks:[{...mark,recordId:42}]})),/적용하지 않았/);
    await page.locator('#save-status').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#save-status').isVisible(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await capture(page,`import-error-${width}x${height}`);
    assert.match(await upload(page,backup()),/합쳤습니다/);
    await page.locator('#settings-return').click();
    out('import-ui',{width,height,mobile,errorVisible:true,success:true,back:true});
    await context.close();
  }
}
