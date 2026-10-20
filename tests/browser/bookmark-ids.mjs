import assert from 'node:assert/strict';
export async function run({setup,ready,out,capture}) {
  for(const mobile of [true,false]){
    const {context,page}=await setup({seed:true,width:mobile?320:1366,height:mobile?568:768,mobile});
    const press=selector=>mobile?page.locator(selector).first().tap():page.locator(selector).first().click();
    const library=async()=>{await page.evaluate(()=>window.__audit.handleAction('show-library'));await page.locator('#library-screen').waitFor({state:'visible'});};
    const search=async query=>{await library();await page.locator('#library-search').fill(query);};
    const result=await page.evaluate(()=>{
      const a=window.__audit,b=a.orderedRecords.find(r=>r.id==='B-01'),index=b.story.findIndex(l=>l.text.includes('미소를 머금고'));
      const saved=a.progressStore.read();
      saved.bookmarks=[
        {recordId:'A-04',index:3,text:'문장을 교정하기 전의 저장 문구'},
        {recordId:'B-01',sceneId:b.story[index].sceneId,index:999,text:'옛 미리보기'},
        {recordId:'A-04',sceneId:'a-04-scene-removed',index:3,text:'삭제된 장면'},
        {recordId:'A-04',index:999,text:'확인할 수 없는 예전 위치'}
      ];
      a.progressStore.save(saved,true);a.loadProgress();
      return {index,sceneId:b.story[index].sceneId,marks:a.state.progress.bookmarks};
    });
    assert.equal(result.marks.length,4);
    assert.equal(result.marks[0].sceneId,'a-04-scene-0004');
    assert.equal(result.marks[1].index,result.index);
    assert.equal(result.marks[2].status,'missing');assert.equal(result.marks[3].status,'unresolved');
    await search('미소를 머금고');
    assert.equal(await page.locator('#library-list .library-scene').count(),1);
    const mark='#library-list [data-action="bookmark-location"]';
    assert.equal(await page.locator(mark).getAttribute('aria-pressed'),'true');
    await press(mark);assert.equal(await page.locator(mark).getAttribute('aria-pressed'),'false');
    await press(mark);assert.equal(await page.locator(mark).getAttribute('aria-pressed'),'true');
    await press('#library-list .library-scene-jump');
    await page.waitForFunction(index=>window.__audit.state.selectedRecordId==='B-01'&&window.__audit.state.lineIndex===index&&!window.__audit.state.loading,result.index);
    await search('재배치 예정');
    await press('#library-list [data-action="bookmark-location"][data-jump-record="D-07"]');
    await press('#library-list .library-scene-jump[data-jump-record="D-07"]');
    await page.waitForFunction(()=>window.__audit.state.presentedRecordId==='D-07'&&!window.__audit.state.loading);
    assert.equal(await page.evaluate(()=>window.__audit.state.screen),'objective-screen');
    await search('D-R02');assert.equal(await page.locator('#library-list .library-record').count(),1);
    await search('');
    assert.equal(await page.locator('[data-action="remove-unavailable-bookmark"]').count(),2);
    await page.waitForTimeout(700);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await capture(page,`bookmark-unavailable-${mobile?'mobile':'pc'}`);
    await press('[data-action="remove-unavailable-bookmark"]');
    assert.equal(await page.locator('[data-action="remove-unavailable-bookmark"]').count(),1);
    // The search continues to respect read/unlock boundaries.
    await page.evaluate(()=>{const a=window.__audit,saved=a.progressStore.read();Object.assign(saved.records['B-01'],{completed:false,lineIndex:0,seenIndex:0});a.progressStore.save(saved,true);a.loadProgress();});
    await search('미소를 머금고');assert.equal(await page.locator('#library-list .library-scene').count(),0);
    await page.evaluate(()=>{const a=window.__audit;a.recordProgress('B-01').completed=true;a.saveProgress();});
    // Real export/import and reload preserve ID bookmarks, unresolved marks and deduplication.
    await page.evaluate(()=>window.__audit.handleAction('show-settings'));await press('#settings-tab-data');
    const downloading=page.waitForEvent('download');await press('[data-action="export-progress"]');
    const download=await downloading,stream=await download.createReadStream(),chunks=[];
    for await(const chunk of stream)chunks.push(chunk);
    const backup=Buffer.concat(chunks);
    await page.locator('#save-import').setInputFiles({name:'id-backup.json',mimeType:'application/json',buffer:backup});
    await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('합쳤습니다'));
    await page.reload();await page.waitForFunction(()=>window.__audit&&!window.__audit.state.loading);
    await search('');
    assert.equal(await page.locator('[data-action="remove-unavailable-bookmark"]').count(),1);
    const marks=await page.evaluate(()=>window.__audit.state.progress.bookmarks);
    assert.equal(marks.length,4);assert.ok(marks.some(m=>m.sceneId===result.sceneId));
    out('bookmark-search-and-backup',{mobile,legacy:true,native:true,search:true,reportJump:true,unreadHidden:true,exportImport:true,unavailablePreserved:true});
    await context.close();
  }
  // Simulate a later release editing and inserting a scene before the bookmark.
  const {context,page}=await setup({seed:true,width:1366,height:768,mobile:false});
  const saved=await page.evaluate(()=>{
    const a=window.__audit,r=a.orderedRecords.find(r=>r.id==='B-01'),index=r.story.findIndex(l=>l.text.includes('미소를 머금고'));
    const saved=a.progressStore.read();saved.bookmarks=[{recordId:r.id,sceneId:r.story[index].sceneId,index,text:r.story[index].text}];
    a.progressStore.save(saved,true);
    return {index,sceneId:r.story[index].sceneId};
  });
  await page.route('**/js/data/records/b-01.js',async route=>{
    const response=await route.fetch();
    const source=await response.text();
    await route.fulfill({response,body:source+`\n{const r=window.RustedPrayerArchive.getRecord('B-01');r.story[${saved.index}].text='수정된 문장을 검색합니다.';r.story.unshift({sceneId:'b-01-scene-inserted-test',text:'새 장면',tone:'narration'});}`});
  });
  await page.reload();await page.waitForFunction(()=>window.__audit&&!window.__audit.state.loading);
  await page.evaluate(()=>window.__audit.handleAction('show-library'));
  await page.locator('#library-search').fill('수정된 문장');
  await page.locator('#library-list .library-scene-jump').click();
  await page.waitForFunction(index=>window.__audit.state.selectedRecordId==='B-01'&&window.__audit.state.lineIndex===index&&!window.__audit.state.loading,saved.index+1);
  assert.equal(await page.evaluate(()=>window.__audit.state.progress.bookmarks[0].sceneId),saved.sceneId);
  out('bookmark-later-content-release',{copyEdit:true,insertion:true,sameDestination:true});
  const timing=await page.evaluate(()=>{
    const start=performance.now(),a=window.__audit;
    const catalog=window.RustedPrayerBookmarks.create(a.orderedRecords,window.RustedPrayerBookmarkLegacy);
    const built=performance.now(),mark=a.state.progress.bookmarks[0];
    for(let i=0;i<1000;i++)catalog.locate(mark.recordId,mark.sceneId);
    return {scenes:catalog.size,buildMs:built-start,thousandLookupsMs:performance.now()-built};
  });
  out('bookmark-lookup-timing',timing);
  await context.close();
  const quota=await setup({seed:true});
  const failure=await quota.page.evaluate(async()=>{
    const a=window.__audit;await a.progressStore.compact();
    const saved=a.progressStore.read();
    saved.bookmarks=[{recordId:'A-04',index:3,text:'옛 문장'}];
    localStorage.setItem('rusted-prayer-mvp-progress',JSON.stringify(saved));
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      if(key.startsWith('rusted-prayer-mvp-progress:change:'))throw new DOMException('quota','QuotaExceededError');
      return original.call(this,key,value);
    };
    try {
      a.loadProgress();
      return {completed:a.state.progress.records['A-04'].completed,mark:a.state.progress.bookmarks[0],
        notice:!document.querySelector('#storage-notice').hidden};
    } finally {Storage.prototype.setItem=original;}
  });
  assert.equal(failure.completed,true);assert.equal(failure.mark.sceneId,'a-04-scene-0004');assert.equal(failure.notice,true);
  await quota.page.reload();await quota.page.waitForFunction(()=>window.__audit&&!window.__audit.state.loading);
  assert.equal(await quota.page.evaluate(()=>window.__audit.state.progress.bookmarks[0].sceneId),'a-04-scene-0004');
  out('bookmark-migration-storage-failure',{liveProgressPreserved:true,retryOnReload:true});
  await quota.context.close();
}
