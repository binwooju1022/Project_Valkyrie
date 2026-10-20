import assert from 'node:assert/strict';
export async function run({setup,story,out,url}) {
  async function roundTrip(page) {
    const diagnostics=await page.context().newCDPSession(page);
    await diagnostics.send('Page.enable');
    diagnostics.on('Page.backForwardCacheNotUsed',event=>console.log(JSON.stringify({cacheNotUsed:event.notRestoredExplanations})));
    const token=await page.evaluate(()=>{
      window.__documentToken ||= crypto.randomUUID();
      window.__life=[];
      if(!window.__lifeBound){
        window.__lifeBound=true;
        window.addEventListener('pageshow',e=>window.__life.push({type:'show',persisted:e.persisted}));
        window.addEventListener('pagehide',e=>window.__life.push({type:'hide',persisted:e.persisted}));
      }
      return window.__documentToken;
    });
    await page.evaluate(()=>window.__audit.progressStore.compact());
    await page.goto(url+'blank');
    await page.goBack({waitUntil:'commit'});
    try { await page.waitForFunction(()=>window.__life?.some(e=>e.type==='show'&&e.persisted),null,{timeout:5000}); }
    catch(error) {
      console.log(JSON.stringify(await page.evaluate(()=>({life:window.__life,screen:window.__audit?.state.screen,reasons:performance.getEntriesByType('navigation')[0]?.notRestoredReasons?.toJSON()}))));
      throw error;
    }
    assert.equal(await page.evaluate(()=>window.__documentToken),token,'must restore the original document, not reload');
    await diagnostics.detach();
    return page.evaluate(()=>window.__life);
  }
  for(const mobile of [true,false]) {
    const {context,page}=await setup({seed:true,instant:false,mobile,width:mobile?412:1366,height:mobile?915:768});
    for(const kind of ['typing','finished','gate','gate-ready'])for(const auto of [false,true]) {
      await page.evaluate(()=>{const a=window.__audit;a.state.auto=false;a.state.autoEnabled=false;});
      const gated=kind.startsWith('gate'),id=gated?'A-04':'B-07',index=gated?5:26;
      await story(page,id,index);
      if(kind==='finished')await page.evaluate(()=>window.__audit.finishTyping());
      if(kind==='gate-ready')await page.waitForFunction(()=>!window.__audit.state.advanceLocked);
      if(kind==='typing')await page.waitForTimeout(150);
      if(auto)await page.evaluate(()=>window.__audit.toggleAuto());
      const before=await page.evaluate(()=>({full:window.__audit.state.fullText,lock:window.__audit.state.advanceLocked,
        text:window.__audit.state.typingTarget?.textContent,swap:document.querySelector('#scene-art').dataset.swapCount}));
      const life=await roundTrip(page);
      assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),index);
      assert.equal(await page.evaluate(()=>window.__audit.state.auto),auto);
      assert.equal(await page.evaluate(()=>window.__audit.state.fullText),before.full);
      assert.equal(await page.evaluate(()=>document.querySelector('#scene-art').dataset.swapCount),before.swap);
      if(gated) {
        assert.equal(await page.evaluate(()=>window.__audit.state.attachmentPending),true);
        if(kind==='gate')assert.equal(await page.locator('#acknowledge-insert').isDisabled(),true);
        await page.waitForFunction(()=>!document.querySelector('#acknowledge-insert').disabled);
        await page.waitForTimeout(300);
        assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),index);
        if(mobile)await page.locator('#acknowledge-insert').tap();else await page.locator('#acknowledge-insert').click();
        assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),index+1);
      } else {
        await page.waitForFunction(()=>!window.__audit.state.isTyping);
        if(auto) {
          await page.waitForFunction(()=>window.__audit.state.lineIndex===27);
          await page.evaluate(()=>window.__audit.toggleAuto());
          await page.waitForTimeout(500);
          assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),27);
        } else {
          await page.waitForTimeout(500);
          assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),26);
          if(mobile)await page.locator('#dialogue-text').tap();else await page.keyboard.press('Space');
          assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),27);
        }
      }
      out('actual-bfcache',{mobile,kind,auto,persisted:life.some(e=>e.type==='show'&&e.persisted),passed:true});
    }
    for(const overlay of ['menu','log','profile']) {
      await page.evaluate(()=>{const a=window.__audit;a.state.auto=false;a.state.autoEnabled=false;});
      await story(page,overlay==='profile'?'A-02':'B-07',overlay==='profile'?3:26);
      await page.evaluate(()=>{window.__audit.finishTyping();window.__audit.toggleAuto();});
      if(overlay==='menu')await page.locator('#story-menu-toggle').click();
      if(overlay==='log')await page.keyboard.press('KeyL');
      if(overlay==='profile')await page.locator('#communication-panel [data-profile]').first().click();
      const index=await page.evaluate(()=>window.__audit.state.lineIndex);
      await roundTrip(page);
      await page.waitForTimeout(700);
      assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),index);
      assert.equal(await page.evaluate(()=>window.__audit.state.autoTimer),null);
      if(overlay==='menu')await page.locator('#story-menu-toggle').click();
      if(overlay==='log')await page.keyboard.press('KeyL');
      if(overlay==='profile')await page.locator('#profile-close').click();
      await page.waitForFunction(index=>window.__audit.state.lineIndex===index+1,index);
      out('bfcache-overlay-wait',{mobile,overlay,passed:true});
    }
    await page.evaluate(()=>{window.__audit.state.auto=false;window.__audit.state.autoEnabled=false;});
    await story(page,'B-07',26);
    await page.evaluate(()=>{window.__audit.openReadLocation('B-07',0);});
    await roundTrip(page);
    await page.waitForFunction(()=>!window.__audit.state.isTyping);
    assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),26);
    assert.equal(await page.locator('#loading-overlay').isHidden(),true);
    out('bfcache-during-uncommitted-navigation',{mobile,passed:true});
    // Reload is a new document and follows the normal boot/continue flow.
    const token=await page.evaluate(()=>window.__documentToken);
    await page.reload();await page.waitForFunction(()=>window.__audit&&!window.__audit.state.loading);
    assert.notEqual(await page.evaluate(()=>window.__documentToken),token);
    assert.equal(await page.evaluate(()=>window.__audit.state.screen),'boot-screen');
    out('reload-distinguished',{mobile,passed:true});
    await context.close();
  }
}
