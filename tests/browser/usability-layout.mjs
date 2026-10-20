import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const sizes=[[412,915,true],[360,640,true],[320,568,true],[915,412,true],[1920,1080,false],[1366,768,false],[1280,720,false],[760,700,false]];
export async function run({setup,story,out,root,capture}) {
  const baseline=process.env.USABILITY_BASELINE==='1',samples={};
  const previous=baseline?null:await fs.readFile(path.join(root,'layout-before.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  for(const [width,height,mobile] of sizes) {
    const {page,context}=await setup({seed:true,width,height,mobile});
    for(const large of [false,true]) {
      await page.evaluate(large=>{const a=window.__audit;a.state.effectsReduced=true;a.state.textSize=large?'large':'normal';a.saveProgress();},large);
      for(const [id,index] of [['A-02',3],['A-04',5],['B-07',26],['D-05',3]]) {
        await story(page,id,index);
        for(const menu of [false,true]) {
          await page.evaluate(menu=>window.__audit.setStoryMenu(menu),menu);
          await page.waitForTimeout(100);
          const key=[width,height,large,id,menu].join('/');
          samples[key]=await page.evaluate(()=>['story-stage','scene-art','dialogue-box'].map(id=>{
            const e=document.getElementById(id),r=e.getBoundingClientRect();
            return {id,width:r.width,height:r.height,x:r.x,y:r.y};
          }));
          if(!baseline) {
            if(previous)assert.deepEqual(samples[key],previous[key],key+' artwork and dialogue geometry');
            if(menu)assert.deepEqual(samples[key],samples[[width,height,large,id,false].join('/')],key+' menu must not resize artwork');
            assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
            const rect=await page.locator('#story-menu-toggle').boundingBox();
            assert.ok(rect.height>=44 && rect.width<=110,'compact button with a touch-sized target');
            assert.ok(rect.x>width-130 && rect.y>=0 && rect.y<20,'upper right corner');
            assert.equal(await page.locator('#story-menu-toggle').getAttribute('aria-expanded'),String(menu));
          }
        }
      }
      if(!baseline) {
        await page.evaluate(()=>{const a=window.__audit;a.state.archiveRecordKind='main';a.state.selectedRecordId='A-02';a.selectDisk('A',false);a.showScreen('archive-screen');});
        await page.waitForTimeout(500);
        const selector=width<=760||mobile?'#archive-open-record':'#open-record';
        const box=await page.locator(selector).boundingBox();
        assert.ok(box.y>=0 && box.y+box.height<=height,`${width}x${height} open visible ${JSON.stringify(box)}`);
        assert.equal(await page.locator('.archive-shortcuts').textContent().then(t=>t.includes('스와이프')),mobile);
        if(mobile)await page.locator(selector).tap();else await page.locator(selector).click();
        await page.waitForFunction(()=>window.__audit.state.screen==='objective-screen'&&!window.__audit.state.loading);
      }
      out('usability-layout',{width,height,mobile,large,baseline,scenes:4,menuStates:2});
    }
    if(!baseline) {await story(page,'A-04',5);await page.waitForTimeout(600);await capture(page,`usability-${width}x${height}`);}
    await context.close();
  }
  if(baseline)await fs.writeFile(path.join(root,'layout-before.json'),JSON.stringify(samples));
}
