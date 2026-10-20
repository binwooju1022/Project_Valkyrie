import assert from 'node:assert/strict';
export async function run({setup,story,out,capture}) {
  for(const mobile of [true,false]) {
    const {page,context}=await setup({seed:true,mobile,width:mobile?320:1366,height:mobile?568:768});
    await page.evaluate(async()=>{
      const a=window.__audit;await a.progressStore.compact();
      const saved=a.progressStore.read();delete saved.narrationLayoutVersion;
      saved.records['C-04']={completed:true,lineIndex:87,seenIndex:98,seenPages:{86:0,87:0,98:0}};
      saved.records['B-07']={completed:true,lineIndex:151,seenIndex:152,seenPages:{151:0,152:0}};
      saved.bookmarks=[
        {recordId:'C-04',index:2,text:'붕괴된 기둥에 등을 기대고 앉아 있다.'},
        {recordId:'C-04',sceneId:'c-04-scene-0088',index:87,text:'눈물이 뺨을 따라 흐른다.'},
        {recordId:'B-07',sceneId:'b-07-scene-0152',index:151,text:'문이 닫힌다.'}
      ];
      saved._sync.fields={};
      for(const key of Object.keys(localStorage))if(key.startsWith('rusted-prayer-mvp-progress:change:'))localStorage.removeItem(key);
      localStorage.setItem('rusted-prayer-mvp-progress',JSON.stringify(saved));
    });
    for(let n=0;n<2;n++) {
      await page.reload();await page.waitForFunction(()=>window.__audit&&!window.__audit.state.loading);
      const saved=await page.evaluate(()=>window.__audit.progressStore.read());
      assert.equal(saved.narrationLayoutVersion,1);
      assert.equal(saved.records['C-04'].lineIndex,85);assert.equal(saved.records['C-04'].seenIndex,96);
      assert.equal(saved.records['B-07'].lineIndex,150);assert.equal(saved.records['B-07'].seenIndex,151);
      assert.deepEqual(saved.bookmarks.map(m=>m.index),[1,85,150]);
    }
    for(const [id,sceneId,index,text] of [
      ['C-04','c-04-scene-0003',1,'연화. 붕괴된 기둥에 등을 기대고 앉아 있다.'],
      ['C-04','c-04-scene-0088',85,'유라가 눈을 감는다. 눈물이 뺨을 따라 흐른다.'],
      ['B-07','b-07-scene-0152',150,'유라의 웃음소리. 문이 닫힌다.']
    ]) {
      await page.evaluate(async({id,sceneId})=>window.__audit.openReadLocation(id,999,sceneId),{id,sceneId});
      await page.waitForFunction(index=>window.__audit.state.lineIndex===index&&!window.__audit.state.loading,index);
      assert.equal(await page.evaluate(()=>window.__audit.state.fullText),text);
      await page.evaluate(()=>window.__audit.finishTyping());
      await page.waitForTimeout(650);await capture(page,`merged-${sceneId}-${mobile?'mobile':'pc'}`);
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),index+1);
      await page.keyboard.press('ArrowLeft');
      assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),index);
    }
    // Both the old browser-history index and the following image/sound cue stay aligned.
    await page.evaluate(async()=>{
      const a=window.__audit,view=a.viewState();
      delete view.narrationLayoutVersion;
      await a.restoreView({...view,screen:'story-screen',recordId:'C-04',diskId:'C',lineIndex:98});
    });
    assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),96);
    assert.equal(await page.evaluate(()=>window.__audit.state.fullText),'탕―');
    assert.equal(await page.evaluate(()=>window.RustedPrayerMediaManifest.sfx.records['C-04'][0].at),96);
    await story(page,'B-07',82);
    assert.equal(await page.evaluate(()=>window.__audit.state.fullText),'연화는 문 쪽으로 향하던 시선을 거둔다. 문가에 선 채 두 손을 맞잡자 손등에 힘줄이 도드라진다.');
    await story(page,'B-07',83);
    assert.equal(await page.evaluate(()=>window.__audit.state.fullText),'초희는 잠시 그 손을 바라본다.');
    // Historical imports at the very last scene must survive bounds validation.
    await page.evaluate(()=>window.__audit.showScreen('settings-screen'));
    await page.locator('#settings-tab-data').click();
    for(const version of [24,23,22,20,18,12,9]) {
      const data=await page.evaluate(version=>{
        const a=window.__audit,r=a.orderedRecords.find(r=>r.id==='C-04');
        const index=version===24?105:(r['v'+version+'IndexMap']?.length || 106)-1;
        return {version,c02LayoutVersion:1,b07LayoutVersion:1,records:{'C-04':{completed:true,lineIndex:index,seenIndex:index}},bookmarks:[{recordId:'C-04',index,text:'old final scene'}]};
      },version);
      await page.locator('#save-import').setInputFiles({name:'old.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
      await page.waitForFunction(()=>document.querySelector('#save-import').value==='');
      assert.match(await page.locator('#save-status').innerText(),/합쳤습니다/,String(version));
      assert.equal(await page.evaluate(()=>window.__audit.state.progress.bookmarks.find(m=>m.sceneId==='c-04-scene-0106')?.index),103);
    }
    await page.evaluate(()=>window.__audit.handleAction('show-library'));
    await page.locator('#library-search').fill('붕괴된 기둥');
    assert.equal(await page.locator('#library-list .library-scene').count(),1);
    await page.locator('#library-list .library-scene-jump').click();
    await page.waitForFunction(()=>window.__audit.state.selectedRecordId==='C-04'&&window.__audit.state.lineIndex===1&&!window.__audit.state.loading);
    out('narration-merges',{mobile,oldSaveReload:true,bookmarks:3,history:true,search:true,untouchedSplit:true,legacyImports:7});
    await context.close();
  }
}
