import assert from 'node:assert/strict';

async function open(page,id,position={scrollTop:0}) {
 await page.evaluate(async({id,position})=>{
  const a=window.__audit;a.state.selectedRecordId=id;a.selectDisk(id[0],false);
  await a.openObjective('replace',position);
 },{id,position});
 await page.waitForTimeout(350);
}
async function visibleBounds(page,selector) {
 const box=await page.locator(selector).boundingBox(),size=page.viewportSize();
 assert.ok(box&&box.y>=-1&&box.y+box.height<=size.height+1,`${selector}: ${JSON.stringify(box)}`);
}
async function swipe(page,cdp,selector) {
 const r=await page.locator(selector).boundingBox();
 const x=Math.round(r.x+r.width*.6),from=Math.round(r.y+r.height*.8),to=Math.round(r.y+r.height*.2);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:from}]});
 for(let n=1;n<=8;n++) {
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:Math.round(from+(to-from)*n/8)}]});
  await page.waitForTimeout(30);
 }
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForTimeout(350);
}
export async function run({setup,story,out,capture}) {
 for(const [width,height] of [[375,812],[812,375],[740,280]]) {
  const boot=await setup({width,height});
  await boot.page.waitForTimeout(900);
  await visibleBounds(boot.page,'#enter-archive');
  assert.equal(await boot.page.locator('#rotation-notice').isVisible(),true);
  await boot.context.close();
 }
 const {page,context}=await setup({seed:true,width:375,height:812});
 assert.match(await page.locator('#rotation-notice').innerText(),/가로·세로 모두/);
 await open(page,'A-01');
 assert.equal(await page.locator('#cutscene-orientation-note').isVisible(),true);
 await capture(page,'orientation-before-play');
 await page.locator('#start-story').tap();
 await page.waitForFunction(()=>window.__audit.state.screen==='story-screen'&&!window.__audit.state.loading);
 await story(page,'A-01',0);
 assert.equal(await page.locator('#story-menu-tip').count(),0);
 assert.equal(await page.locator('.orientation-note:visible').count(),0);
 await capture(page,'first-scene-no-tips');
 await open(page,'A-01');
 assert.equal(await page.locator('.orientation-note:visible').count(),0,'do not repeat advice on return');
 await page.setViewportSize({width:812,height:375});
 await page.waitForTimeout(150);
 await open(page,'A-08');
 assert.equal(await page.locator('#report-orientation-note').isVisible(),true);
 await capture(page,'report-orientation-once');
 await page.setViewportSize({width:375,height:812});
 await page.waitForFunction(()=>document.querySelector('#report-orientation-note').hidden);
 assert.equal(await page.locator('.orientation-note:visible').count(),0,'rotation removes advice');
 await page.setViewportSize({width:812,height:375});
 assert.equal(await page.locator('.orientation-note:visible').count(),0,'rotating back does not nag');
 await open(page,'D-14');
 assert.equal(await page.locator('.orientation-note:visible').count(),0,'no per-report repetition');
 await context.close();
 const fresh=await setup({seed:true,width:915,height:412});
 await open(fresh.page,'A-08',{scrollTop:300});
 assert.equal(await fresh.page.locator('.orientation-note:visible').count(),0,'no advice at resumed reading positions');
 await fresh.context.close();

 for(const [width,height] of [[375,812],[812,375],[915,412]]) {
  const {page,context}=await setup({seed:true,width,height});
  const cdp=await context.newCDPSession(page);
  for(const screen of ['archive-screen','story-screen']) {
   if(screen==='story-screen')await story(page,'A-01',0);
   else await page.evaluate(()=>window.__audit.showScreen('archive-screen'));
   await page.waitForTimeout(400);
   if(screen==='archive-screen')await page.evaluate(async()=>{
    // Staggered panel entry lasts up to 790ms and changes scrollable bounds.
    // Test a reader's settled list, not a moving transform's temporary edge.
    await document.fonts.ready;
    await Promise.all(document.querySelector('#archive-screen').getAnimations({subtree:true})
     .filter(a=>Number.isFinite(a.effect?.getComputedTiming().iterations))
     .map(a=>a.finished.catch(()=>{})));
   });
   assert.equal(await page.evaluate(()=>getComputedStyle(document.body).overflowY),'visible');
   assert.equal(await page.locator('#app').evaluate(e=>getComputedStyle(e).overflowY),'visible');
   assert.equal(await page.locator('#'+screen).evaluate(e=>getComputedStyle(e).position),'sticky');
   // Headless browsers have no address bar. Model the *measured large viewport*
   // separately to verify native root input and sticky controls, not toolbar UI.
   await page.evaluate(height=>{
    document.body.style.minHeight=`${height+96}px`;
    document.querySelector('#app').style.minHeight=`${height+96}px`;
   },height);
   for(let attempt=0;attempt<2;attempt++) {
    await page.evaluate(()=>scrollTo(0,0));
    const target=screen==='archive-screen'?'#archive-layout':'#story-stage';
    if(screen==='archive-screen')await page.locator('#archive-layout > .panel').evaluateAll(es=>es.forEach(e=>e.scrollTop=e.scrollHeight));
    // Commit programmatic boundary positions to the compositor before input.
    await page.waitForTimeout(150);
    await swipe(page,cdp,target);
    const scroll=await page.evaluate(()=>({root:scrollY,max:document.documentElement.scrollHeight-innerHeight,
     panels:[...document.querySelectorAll('#archive-layout > .panel')].map(e=>({top:e.scrollTop,max:e.scrollHeight-e.clientHeight,inert:e.inert}))}));
    assert.ok(scroll.root>0,`${width}x${height} ${screen} attempt ${attempt}: native swipe must reach root: ${JSON.stringify(scroll)}`);
    await visibleBounds(page,screen==='archive-screen'?'#archive-open-record':'#story-menu-toggle');
    assert.ok(Math.abs((await page.locator('#'+screen).boundingBox()).y)<1,'reader must stay in view while root scrolls');
    await page.setViewportSize({width,height:height+96});
    await page.waitForTimeout(120);
    await visibleBounds(page,screen==='archive-screen'?'#archive-open-record':'#story-menu-toggle');
    await page.setViewportSize({width,height});await page.waitForTimeout(120);
   }
   await page.evaluate(()=>{document.body.style.minHeight='';document.querySelector('#app').style.minHeight='';scrollTo(0,0);});
  }
  await story(page,'A-04',5);
  await page.waitForFunction(()=>!document.querySelector('#insert-scroll-note').hidden);
  assert.equal(await page.locator('#insert-scroll-note').textContent(),'아래에 내용이 더 있습니다.');
  await page.locator('#insert-card').evaluate(e=>e.scrollTop=e.scrollHeight);
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#insert-scroll-note').evaluate(e=>getComputedStyle(e).visibility),'hidden');
  await cdp.detach();await context.close();
  out('immersion-native-scroll',{width,height,rootGesture:true,toolbarVisibility:'real device required'});
 }
 const desktop=await setup({seed:true,mobile:false,width:1366,height:768});
 await open(desktop.page,'A-01');
 assert.equal(await desktop.page.locator('.orientation-note:visible').count(),0);
 await desktop.context.close();
 out('immersion-guidance',{oncePerVisit:true,noSceneOverlay:true,rotationFree:true});
}
