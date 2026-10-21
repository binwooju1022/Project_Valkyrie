import assert from 'node:assert/strict';
const pathState=page=>page.evaluate(()=>({...window.__audit.pathRun}));
const finishPath=async page=>{
 const run=await pathState(page);
 await page.waitForTimeout(run.duration+100);
 await page.evaluate(()=>window.__audit.refreshCutsceneComposition());
 assert.equal((await pathState(page)).settled,true);
 return run.started;
};
export async function run({setup,story,out,capture}) {
 for(const [width,height,mobile] of [[360,740,true],[915,412,true],[1366,768,false]]) {
  const {page,context}=await setup({seed:true,width,height,mobile});
  await story(page,'A-07',1);
  await page.waitForFunction(()=>window.__audit.pathRun&&!window.__audit.pathRun.settled);
  const first=await finishPath(page);
  await page.evaluate(()=>window.__audit.nextLine());
  assert.equal((await pathState(page)).started,first,'forward keeps the continuous path');
  assert.equal((await pathState(page)).settled,true);
  await page.locator('#story-menu-toggle').click();
  await page.locator('[data-action="previous-line"]').click();
  await page.waitForFunction(start=>window.__audit.pathRun?.started>start&&!window.__audit.pathRun.settled,first);
  assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),1);
  await page.evaluate(()=>window.__audit.setStoryMenu(false));
  await capture(page,`replayed-a07-${width}`);
  // Geometry updates must reproject the same running animation, not restart it.
  const replay=await pathState(page);
  await page.setViewportSize({width,height:height-35});
  await page.waitForTimeout(100);
  assert.equal((await pathState(page)).started,replay.started);
  await page.setViewportSize({width,height});
  await page.evaluate(()=>{const a=window.__audit;a.nextLine();a.previousLine();a.nextLine();a.previousLine();});
  await page.waitForFunction(()=>document.querySelector('#stage-camera')?.naturalWidth>0);
  assert.equal(await page.locator('#stage-camera').evaluate(e=>e.getAnimations().filter(a=>a.id==='a-camera-path').length),1,'rapid previous does not duplicate the path');
  await finishPath(page);
  await page.evaluate(()=>window.__audit.openReadingSettings());
  await page.evaluate(()=>window.__audit.goBack());
  await page.waitForFunction(()=>window.__audit.state.screen==='story-screen'&&!window.__audit.state.loading&&window.__audit.pathRun);
  assert.equal((await pathState(page)).settled,true,'settings return restores settled presentation');
  await page.reload();
  await page.waitForFunction(()=>window.__audit&&!window.__audit.state.loading);
  await page.evaluate(async()=>{const a=window.__audit;a.state.selectedRecordId='A-07';a.selectDisk('A',false);await a.startStory(false,1);});
  await page.waitForFunction(()=>window.__audit.pathRun);
  assert.equal((await pathState(page)).settled,true,'saved resume does not replay');
  // The shared camera lifecycle must work outside A-07 as well.
  for(const [id,index] of [['A-06',28],['B-07',88]]) {
   await story(page,id,index);
   await page.waitForFunction(()=>window.__audit.pathRun&&!window.__audit.pathRun.settled);
   const old=await finishPath(page);
   await page.evaluate(()=>{const a=window.__audit;a.nextLine();a.previousLine();});
   await page.waitForFunction(start=>window.__audit.pathRun?.started>start&&!window.__audit.pathRun.settled,old);
  }
  await story(page,'A-03',5);
  await page.waitForFunction(()=>window.__audit.cameraVisit?.phase==='overview');
  await page.evaluate(()=>{const a=window.__audit;a.nextLine();a.previousLine();});
  await page.waitForFunction(()=>window.__audit.cameraVisit?.phase==='focus');
  await page.evaluate(()=>{const a=window.__audit;a.state.effectsReduced=true;a.nextLine();a.previousLine();});
  await page.waitForFunction(()=>window.__audit.cameraVisit?.phase==='overview');
  await story(page,'A-07',2);
  await page.evaluate(()=>window.__audit.previousLine());
  assert.equal(await page.locator('#stage-camera').evaluate(e=>e.getAnimations().filter(a=>a.id==='a-camera-path').length),0,'reduced effects suppress replay motion');
  out('replay-entry',{width,height,mobile,previousReplay:true,forwardContinuity:true,resize:true,rapidPrevious:true,settingsReturn:true,savedResume:true,otherPaths:2,faceReplay:true,reducedEffects:true});
  await context.close();
 }
}
