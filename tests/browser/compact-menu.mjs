import assert from 'node:assert/strict';
export async function run({setup,story,out,capture}) {
  for(const [width,height,mobile] of [[320,568,true],[412,915,true],[915,412,true],[1366,768,false]]) {
    const {page,context}=await setup({seed:true,width,height,mobile});
    const press=selector=>mobile?page.locator(selector).tap():page.locator(selector).click();
    await page.evaluate(()=>{const a=window.__audit;a.state.characterLabels=true;a.state.effectsReduced=true;a.saveProgress();});
    await story(page,'A-01',1);await page.waitForTimeout(700);
    await capture(page,`corner-menu-${width}`);
    const button=await page.locator('#story-menu-toggle').boundingBox();
    assert.ok(button.width<=110 && button.height>=44 && button.x>width-130);
    assert.ok(await page.evaluate(()=>!document.querySelector('#story-hud').getBoundingClientRect().width || document.querySelector('#story-hud').inert));
    // The old full-width strip no longer catches clicks outside the corner.
    const topHit=await page.evaluate(()=>document.elementFromPoint(innerWidth/2,15).closest('button,header'));
    assert.equal(topHit,null);
    await press('#story-menu-toggle');
    assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),1);
    await press('#auto-button');
    assert.match(await page.locator('#story-menu-toggle').textContent(),/●/);
    assert.match(await page.locator('#story-auto-status').textContent(),/메뉴를 닫으면 계속/);
    await page.waitForTimeout(300);
    const hud=await page.locator('#story-hud').boundingBox();
    assert.ok(hud.y>=button.y+button.height && hud.y+hud.height<=height);
    for(const selector of ['#story-auto-status','#auto-button','#story-options summary']) {
      const box=await page.locator(selector).boundingBox();
      assert.ok(box.x>=0 && box.x+box.width<=width+1 && box.y>=hud.y && box.y+box.height<=hud.y+hud.height+1,selector);
    }
    await capture(page,`corner-menu-open-${width}`);
    await press('#auto-button');await press('#story-menu-toggle');
    assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),1);
    if(!mobile) {
      await page.locator('#story-menu-toggle').focus();await page.keyboard.press('Enter');
      assert.equal(await page.locator('#story-menu-toggle').getAttribute('aria-expanded'),'true');
      assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),1);
    }
    await page.evaluate(()=>window.__audit.handleAction('show-settings'));
    await press('#settings-tab-audio');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.equal(await page.locator('#setting-archive-music option[value="waiting-commander"]').isDisabled(),true);
    await capture(page,`music-settings-${width}`);
    out('compact-menu',{width,height,mobile,cornerTarget:true,oldStripRemoved:true,noAccidentalAdvance:true,autoStatus:true,settingsFit:true});
    await context.close();
  }
}
