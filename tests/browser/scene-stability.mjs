import assert from 'node:assert/strict';
const close=(a,b,label)=>{for(const k of ['x','y','width','height'])assert.ok(Math.abs(a[k]-b[k])<1,`${label} ${k}: ${a[k]} -> ${b[k]}`);};
export async function run({setup,story,out,capture}) {
 for(const [width,height,mobile] of [[360,740,true],[412,915,true],[915,412,true],[1366,768,false]]) {
  const {page,context}=await setup({seed:true,width,height,mobile});
  await story(page,'C-05',1);
  await page.waitForFunction(()=>document.querySelector('#stage-camera')?.naturalWidth>0);
  await page.waitForTimeout(500);
  const picture=await page.locator('#stage-camera').boundingBox();
  await capture(page,`cutscene-radio-${width}`);
  await page.evaluate(()=>{const a=window.__audit;a.state.lineIndex=3;a.renderLine();});
  await page.waitForTimeout(100);
  close(picture,await page.locator('#stage-camera').boundingBox(),'radio to narration');
  await capture(page,`cutscene-narration-${width}`);
  // Delay the frame on the first lab visit, like a cold mobile cache.
  let frameLoaded=false;
  await page.route('**/assets/ui/lab-hud-frame.svg',async route=>{await new Promise(r=>setTimeout(r,500));await route.continue();frameLoaded=true;});
  await story(page,'D-03',0);
  assert.equal(frameLoaded,true,'frame included in the record preload');
  const firstFrames=await page.evaluate(async()=>{
   const samples=[];for(let i=0;i<15;i++){await new Promise(requestAnimationFrame);const r=document.querySelector('.lab-monitor').getBoundingClientRect();samples.push({x:r.x,y:r.y,width:r.width,height:r.height});}return samples;
  });
  for(const r of firstFrames)close(firstFrames[0],r,'first lab frames');
  for(const id of ['D-03','D-06','D-11']) {
   await story(page,id,0);await page.waitForTimeout(100);
   const monitor=await page.locator('.lab-monitor').boundingBox();
   assert.ok(monitor.width>50&&monitor.height>50&&monitor.y>=0&&monitor.y+monitor.height<=height);
   await page.evaluate(()=>{const a=window.__audit;a.state.lineIndex=3;a.renderLine();});
   close(monitor,await page.locator('.lab-monitor').boundingBox(),id+' next dialogue');
   await page.evaluate(()=>{const a=window.__audit;a.state.textSize='large';a.saveProgress();a.finishTyping();});
   close(monitor,await page.locator('.lab-monitor').boundingBox(),id+' large text');
   await page.evaluate(()=>window.__audit.setStoryMenu(true));
   close(monitor,await page.locator('.lab-monitor').boundingBox(),id+' menu');
   await page.evaluate(()=>{const a=window.__audit;a.setStoryMenu(false);a.state.textSize='normal';a.saveProgress();});
   await capture(page,`lab-${id}-${width}`);
  }
  out('scene-stability',{width,height,mobile,cutsceneStable:true,labStable:true,coldFrameLoaded:true,firstFramesStable:true});
  await context.close();
 }
}
