import assert from 'node:assert/strict';
export async function run({setup,story,out,url,capture}) {
  for(const mobile of [true,false]) {
    const {page,context}=await setup({seed:true,width:mobile?320:1280,height:mobile?568:720,mobile});
    await story(page,'A-04',5);await page.waitForTimeout(700);
    await capture(page,`final-attachment-${mobile?'mobile':'pc'}`);
    await story(page,'B-07',26);
    await page.evaluate(async()=>{
      const a=window.__audit;a.finishTyping();a.toggleAuto();
      const pending=a.loadTransition('읽기 위치 확인',null,10000);
      a.setStoryMenu(false);
      if(!document.querySelector('#story-menu-toggle').textContent.includes('불러오는 중'))throw Error('missing loading status');
      a.cancelLoading();await pending;
    });
    assert.match(await page.locator('#story-menu-toggle').textContent(),/재생 중/);
    assert.ok(await page.evaluate(()=>Boolean(window.__audit.state.autoTimer)));
    await page.evaluate(()=>{window.__restored=false;addEventListener('pageshow',e=>window.__restored=e.persisted);window.__audit.progressStore.compact();});
    await page.goto(url+'blank');await page.goBack({waitUntil:'commit'});
    await page.waitForFunction(()=>window.__restored);
    assert.equal(await page.evaluate(()=>window.__audit.state.auto),true);
    assert.match(await page.locator('#story-menu-toggle').textContent(),/재생 중/);
    assert.ok(await page.evaluate(()=>Boolean(window.__audit.state.autoTimer)));
    out('usability-resume',{mobile,cancelStatus:true,actualBFCache:true,autoTimerRestored:true});
    await context.close();
  }
}
