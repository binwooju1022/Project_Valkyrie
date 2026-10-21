import assert from 'node:assert/strict';
export async function run({setup,story,out}) {
  for(const [width,height,mobile] of [[412,915,true],[360,640,true],[320,568,true],[915,412,true],[1920,1080,false],[1366,768,false],[1280,720,false],[760,700,false]]) {
    const {page,context}=await setup({seed:true,width,height,mobile});
    const press=selector=>mobile?page.locator(selector).first().tap():page.locator(selector).first().click();
    const cdp=mobile?await context.newCDPSession(page):null;
    for(const large of [false,true]) {
      await page.evaluate(large=>{const a=window.__audit;a.state.textSize=large?'large':'normal';a.state.auto=false;a.state.autoEnabled=false;a.saveProgress();},large);
      await story(page,'A-04',5);
      assert.equal(await page.locator('#story-menu-tip').count(),0);
      await press('#story-menu-toggle');
      assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),5);
      await press('#auto-button');
      assert.match(await page.locator('#story-auto-status').textContent(),/메뉴를 닫으면 계속/);
      await press('#story-menu-toggle');
      await page.waitForFunction(()=>!window.__audit.state.advanceLocked);
      assert.match(await page.locator('#story-menu-toggle').getAttribute('data-auto-state'),/첨부 확인 대기/);
      assert.equal(await page.evaluate(()=>window.__audit.state.autoTimer),null);
      const overflow=await page.locator('#insert-card').evaluate(e=>e.scrollHeight>e.clientHeight+2);
      if(overflow) {
        await page.waitForFunction(()=>!document.querySelector('#insert-scroll-note').hidden);
        assert.equal(await page.locator('#insert-scroll-note').evaluate(e=>getComputedStyle(e).visibility),'visible');
        for(let i=0;i<30;i++) {
          if(await page.locator('#insert-card').evaluate(e=>e.scrollTop+e.clientHeight>=e.scrollHeight-3))break;
          if(mobile) {
            const b=await page.locator('#insert-card').boundingBox(),x=Math.round(b.x+b.width*.6);
            const from=Math.round(b.y+b.height*.8),to=Math.round(b.y+b.height*.25);
            await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:from}]});
            for(let n=1;n<=5;n++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:Math.round(from+(to-from)*n/5)}]});await page.waitForTimeout(20);}
            await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(120);
          } else {
            const b=await page.locator('#insert-card').boundingBox();
            await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.wheel(0,160);
            await page.keyboard.press(i%2?'Space':'PageDown');
          }
          assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),5);
        }
        await page.waitForFunction(()=>{const e=document.querySelector('#insert-card');return e.scrollTop+e.clientHeight>=e.scrollHeight-3;});
        assert.equal(await page.locator('#insert-scroll-note').evaluate(e=>getComputedStyle(e).visibility),'hidden');
      }
      // Settings footer returns to this exact gated scene and the chosen auto state.
      await page.evaluate(()=>window.__audit.handleAction('show-settings'));
      await press('#settings-return');
      await page.waitForFunction(()=>window.__audit.state.screen==='story-screen'&&!window.__audit.state.loading);
      assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),5);
      assert.equal(await page.evaluate(()=>window.__audit.state.auto),true);
      await page.waitForFunction(()=>!document.querySelector('#acknowledge-insert').disabled);
      await press('#acknowledge-insert');
      assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),6);
      await page.evaluate(()=>{window.__audit.state.auto=false;window.__audit.state.autoEnabled=false;});
      await story(page,'A-02',3);
      await press('#story-menu-toggle');await press('#auto-button');await press('#log-button');
      assert.match(await page.locator('[data-auto-status="backlog"]').textContent(),/기록 창을 닫으면 계속/);
      assert.equal(await page.evaluate(()=>window.__audit.state.autoTimer),null);
      await press('#backlog [data-action="toggle-log"]');
      await press('#auto-button');await press('#story-menu-toggle');
      assert.equal(await page.evaluate(()=>window.__audit.state.auto),false);
      assert.equal(await page.evaluate(()=>window.__audit.state.autoTimer),null);
      await page.evaluate(()=>window.__audit.toggleAuto());
      await press('#communication-panel [data-profile]');
      assert.match(await page.locator('[data-auto-status="profile"]').textContent(),/프로필을 닫으면 계속/);
      assert.equal(await page.evaluate(()=>window.__audit.state.autoTimer),null);
      await press('#profile-close');
      await page.waitForFunction(()=>!window.__audit.state.isTyping);
      assert.match(await page.locator('#story-menu-toggle').getAttribute('data-auto-state'),/재생 중/);
      assert.ok(await page.evaluate(()=>Boolean(window.__audit.state.autoTimer)));
      await page.evaluate(()=>window.__audit.toggleAuto());
      out('usability-controls',{width,height,mobile,large,menuTouch:true,scrollHint:overflow,scrollDoesNotAdvance:true,settingsReturn:true,autoReasons:true,lastChoicePreserved:true});
    }
    await context.close();
  }
}
