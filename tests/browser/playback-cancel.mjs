import assert from 'node:assert/strict';
export async function run({setup,story,out}) {
  const gates=[['A-01',22],['A-03',34],['A-04',5],['A-04',6],['A-04',7],['A-05',34],['B-04',23]];
  for (const mobile of [true,false]) {
    const {context,page}=await setup({seed:true,instant:false,mobile,width:mobile?412:1366,height:mobile?915:768});
    const press=selector=>mobile?page.locator(selector).first().tap():page.locator(selector).first().click();
    async function cancelJump() {
      if(mobile) {
        await press('#story-menu-toggle');await press('#log-button');
      } else await page.keyboard.press('KeyL');
      await press('#backlog [data-action="jump-location"]');
      await page.locator('#loading-overlay').waitFor({state:'visible'});
      if(mobile)await press('#loading-cancel');else await page.keyboard.press('Escape');
      await page.locator('#loading-overlay').waitFor({state:'hidden'});
    }
    for(const [id,index] of gates)for(const elapsed of [false,true]) {
      await story(page,id,index);
      await page.evaluate(()=>{window.__audit.state.auto=true;window.__audit.state.autoEnabled=true;});
      if(elapsed)await page.waitForTimeout(1000);
      const locked=await page.locator('#acknowledge-insert').isDisabled();
      assert.equal(locked,!elapsed);
      await cancelJump();
      assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),index);
      assert.equal(await page.evaluate(()=>window.__audit.state.auto),true);
      assert.equal(await page.evaluate(()=>window.__audit.state.attachmentPending),true);
      if(elapsed)assert.equal(await page.locator('#acknowledge-insert').isDisabled(),false);
      await page.waitForFunction(()=>!document.querySelector('#acknowledge-insert').disabled);
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),index);
      await press('#acknowledge-insert');
      assert.equal(await page.evaluate(index=>window.__audit.state.screen!=='story-screen'||window.__audit.state.lineIndex===index+1,index),true);
      out('attachment-cancel',{mobile,id,scene:index+1,elapsed,passed:true});
    }
    for(const auto of [false,true])for(const finished of [false,true]) {
      await page.evaluate(()=>{const a=window.__audit;a.state.auto=false;a.state.autoEnabled=false;});
      await story(page,'B-07',26);
      if(finished)await page.evaluate(()=>window.__audit.finishTyping());
      else await page.waitForTimeout(160);
      await page.evaluate(auto=>{window.__audit.state.auto=auto;},auto);
      const before=await page.evaluate(()=>({full:window.__audit.state.fullText,typing:window.__audit.state.isTyping,swap:document.querySelector('#scene-art').dataset.swapCount}));
      await cancelJump();
      assert.equal(await page.evaluate(()=>window.__audit.state.auto),auto);
      assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),26);
      if(mobile)await press('#story-menu-toggle');
      await page.waitForFunction(()=>!window.__audit.state.isTyping);
      assert.equal(await page.evaluate(()=>window.__audit.state.fullText),before.full);
      assert.equal(await page.evaluate(()=>document.querySelector('#scene-art').dataset.swapCount),before.swap);
      if(auto)await page.waitForFunction(()=>window.__audit.state.lineIndex===27);
      else {await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),26);}
      out('typing-cancel',{mobile,auto,finished,passed:true});
    }
    // A failed media load and repeated cancellation use the same recovery path.
    await page.evaluate(()=>{window.__audit.state.auto=false;window.__audit.state.autoEnabled=false;});
    await story(page,'B-07',26);
    await page.evaluate(()=>{
      const media=window.RustedPrayerMedia;window.originalPreload=media.preload;
      media.preload=async()=>({failed:[{src:'test-missing.png',type:'image'}]});
    });
    if(mobile){await press('#story-menu-toggle');await press('#log-button');}else await page.keyboard.press('KeyL');
    await press('#backlog [data-action="jump-location"]');
    await page.locator('#loading-retry').waitFor({state:'visible'});
    await press('#loading-cancel');
    await page.evaluate(()=>{window.RustedPrayerMedia.preload=window.originalPreload;});
    if(mobile)await press('#story-menu-toggle');
    await page.waitForFunction(()=>!window.__audit.state.isTyping);
    assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),26);
    await page.evaluate(async()=>{
      const a=window.__audit;
      for(let i=0;i<5;i++){const pending=a.openReadLocation('B-07',0);a.cancelLoading();await pending;}
    });
    assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),26);
    if(mobile)await press('#dialogue-text');else await page.keyboard.press('Space');
    assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),27);
    out('failure-and-repeated-cancel',{mobile,passed:true});
    await context.close();
  }
}
