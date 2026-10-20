import assert from 'node:assert/strict';
export async function run({setup,story,out}) {
  for(const [width,height,mobile] of [[412,915,true],[320,568,true],[915,412,true],[1366,768,false],[1280,720,false]]) {
    const {context,page}=await setup({seed:true,instant:false,width,height,mobile});
    const press=selector=>mobile?page.locator(selector).first().tap():page.locator(selector).first().click();
    for(const large of [false,true]) {
      await page.evaluate(large=>{
        const a=window.__audit;a.state.textSize=large?'large':'normal';a.state.auto=false;a.state.autoEnabled=false;a.saveProgress();
      },large);
      await story(page,'A-04',5);
      if(mobile){await press('#story-menu-toggle');await press('#log-button');}else await page.keyboard.press('KeyL');
      await press('#backlog [data-action="jump-location"]');
      await press('#loading-cancel');
      await page.waitForFunction(()=>!document.querySelector('#acknowledge-insert').disabled);
      await press('#acknowledge-insert');
      assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),6);
      await story(page,'B-07',26);
      await page.evaluate(()=>window.__audit.finishTyping());
      if(mobile)await press('#dialogue-text');else await page.keyboard.press('Space');
      assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),27);
      await press('#story-menu-toggle');await press('[data-action="previous-line"]');
      assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),26);
      await press('#log-button');assert.equal(await page.locator('#backlog').isVisible(),true);
      await press('#backlog [data-action="toggle-log"]');
      await story(page,'A-02',3);await press('#communication-panel [data-profile]');
      await press('#profile-close');
      assert.equal(await page.locator('#story-stage').evaluate(e=>e.inert),false);
      await story(page,'A-07',2);await page.evaluate(()=>{window.__audit.finishTyping();window.__audit.toggleAuto();});
      await page.waitForFunction(()=>window.__audit.state.lineIndex===3);
      await page.evaluate(()=>window.__audit.toggleAuto());
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      out('screen-input-regression',{width,height,mobile,large,cancel:true,gate:true,previousNext:true,log:true,profile:true,auto:true});
    }
    await context.close();
  }
}
