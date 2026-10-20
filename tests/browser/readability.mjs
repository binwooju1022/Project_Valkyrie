import assert from 'node:assert/strict';

async function open(page,id) {
  await page.evaluate(async id=>{
    const a=window.__audit;a.state.selectedRecordId=id;a.selectDisk(id[0],false);await a.openObjective();
  },id);
  await page.waitForFunction(id=>window.__audit.state.presentedRecordId===id&&!window.__audit.state.loading,id);
}

export async function run({setup,story,capture,out}) {
  const screenshot=async(page,name)=>{await page.waitForTimeout(650);await capture(page,name);};
  for(const [width,height] of [[320,568],[412,915],[915,412],[1366,768]]) {
    const {page,context}=await setup({seed:true,width,height,mobile:width<=915});
    for(const large of [false,true]) {
      await page.evaluate(large=>{const a=window.__audit;a.state.textSize=large?'large':'normal';a.saveProgress();},large);
      await story(page,'B-01',45);
      const typing=await page.evaluate(()=>{
        const a=window.__audit,e=document.getElementById('dialogue-text');a.finishTyping();
        const original=a.state.fullText;
        const samples=[original,'이번에는 희미한 목소리마저 돌아오지 않는다. 연화는 유라의 손을 움켜쥔다. 놓치지 않으려는 듯, 온몸에 힘을 더한다.','···잠깐.\n이 줄은 그대로.\n\n그다음 줄도 ··· 유지한다.','UNIT-02 ··· 아직. ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'];
        const failures=[];
        const geometry=()=>{
          const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT),rects=[];let node;
          while(node=walker.nextNode())for(let i=0;i<node.length;i++){
            if(/\s/.test(node.data[i]))continue;
            const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+1);
            const r=range.getBoundingClientRect();rects.push([r.x,r.y]);
          }
          return {height:e.getBoundingClientRect().height,rects};
        };
        for(const text of samples) {
          a.state.fullText=text;a.writeTypedText(e,text);const full=geometry();
          for(let n=0;n<=text.length;n++) {
            a.writeTypedText(e,text.slice(0,n));const partial=geometry();
            if(Math.abs(partial.height-full.height)>1 || partial.rects.some((r,i)=>r.some((v,j)=>Math.abs(v-full.rects[i][j])>1)))failures.push({text,n});
            if(e.innerText!==text.slice(0,n).trimEnd() && e.innerText!==text.slice(0,n)) {
              // innerText may normalize a trailing line break; check exposed text directly.
              const clone=e.cloneNode(true);clone.querySelectorAll('[aria-hidden="true"]').forEach(n=>n.remove());
              if(clone.textContent!==text.slice(0,n))failures.push({exposed:true,n});
            }
          }
        }
        a.state.fullText=original;a.writeTypedText(e,original);
        return {samples:samples.length,failures,whiteSpace:getComputedStyle(e).whiteSpace};
      });
      assert.deepEqual(typing.failures,[]);assert.equal(typing.whiteSpace,'pre-wrap');
      await screenshot(page,`reading-flow-${width}-${large?'large':'normal'}`);
      for(const id of ['A-08','B-08','D-14']) {
        await open(page,id);
        assert.equal(await page.locator('#objective-title').innerText(),await page.evaluate(()=>window.RustedPrayerArchive.getRecord(window.__audit.state.selectedRecordId).title.replace(/_/g,' ')));
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        if(id==='A-08') {
          const spacing=await page.evaluate(()=>{
            const style=s=>getComputedStyle(document.querySelector(s));
            return {body:style('.objective-body').paddingTop,normal:parseFloat(style('#report-section-1 .sheet-row').marginTop),memo:parseFloat(style('#report-section-5 .sheet-row').marginTop)};
          });
          assert.equal(spacing.body,'0px');assert.ok(spacing.normal<spacing.memo);
        }
        await screenshot(page,`report-${id}-${width}-${large?'large':'normal'}`);
      }
      out('readability-layout',{width,large,typingSamples:typing.samples,stableEveryCharacter:true,reports:3});
    }
    await open(page,'D-04');
    const mobile=width<=900;
    assert.equal(await page.locator('#d-report-toggle').isVisible(),mobile);
    assert.equal(await page.locator('#d-report-contents').isVisible(),!mobile);
    if(mobile) {
      const before=await page.locator('.objective-document').evaluate(e=>e.getBoundingClientRect().top);
      await page.locator('#d-report-toggle').focus();await page.keyboard.press('Enter');
      assert.equal(await page.locator('#d-report-toggle').getAttribute('aria-expanded'),'true');
      assert.equal(await page.locator('.objective-document').evaluate(e=>e.getBoundingClientRect().top),before);
      await screenshot(page,`report-browser-expanded-${width}`);
    }
    await page.locator('[data-report-id="D-07"]').click();
    await page.waitForFunction(()=>window.__audit.state.presentedRecordId==='D-07'&&!window.__audit.state.loading);
    assert.equal(await page.locator('#d-report-contents').isVisible(),!mobile);
    if(mobile) {
      await page.setViewportSize({width:1366,height:768});
      await page.waitForFunction(()=>!document.getElementById('d-report-contents').hidden);
      assert.equal(await page.locator('#d-report-toggle').isVisible(),false);
      await page.setViewportSize({width,height});
      await page.waitForFunction(()=>document.getElementById('d-report-contents').hidden);
    }
    await page.locator('#report-finish').click();
    await page.waitForFunction(()=>window.__audit.state.presentedRecordId==='D-04'&&!window.__audit.state.loading);
    await screenshot(page,`report-browser-${width}`);
    out('report-disclosure',{width,keyboardToggle:mobile,reportNavigation:true,returnToMain:true,resize:mobile});
    await context.close();
  }
}
