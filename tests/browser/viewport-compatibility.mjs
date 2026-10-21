import assert from 'node:assert/strict';

async function inViewport(page,selector,minWidth=1) {
 const box=await page.locator(selector).boundingBox(),size=page.viewportSize();
 assert.ok(box&&box.width>=minWidth&&box.height>0&&box.x>=-1&&box.y>=-1&&box.x+box.width<=size.width+1&&box.y+box.height<=size.height+1,`${selector}: ${JSON.stringify(box)} in ${JSON.stringify(size)}`);
 return box;
}
async function hit(page,selector) {
 assert.equal(await page.locator(selector).evaluate(e=>{
  const r=e.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
  return e===top||e.contains(top);
 }),true,`${selector} must receive input, not just have an on-screen rectangle`);
}
async function openReport(page,id) {
 await page.evaluate(async id=>{
  const a=window.__audit;a.state.archiveRecordKind=['D-01','D-07','D-09','D-10'].includes(id)?'related':'main';
  a.state.selectedRecordId=id;a.selectDisk(id[0],false);await a.openObjective('replace',{scrollTop:0,lineIndex:0});
 },id);
 await page.waitForTimeout(450);
}
async function scrollOptions(page,hasTouch) {
 const menu=page.locator('.story-options-menu');
 const cdp=hasTouch?await page.context().newCDPSession(page):null;
 try {
  for(let n=0;n<8;n++) {
   if(await menu.evaluate(e=>e.scrollTop+e.clientHeight>=e.scrollHeight-2))return;
   const r=await menu.boundingBox(),x=Math.round(r.x+r.width/2),from=Math.round(r.y+r.height-12),to=Math.round(r.y+12);
   if(hasTouch) {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:from}]});
    for(let i=1;i<=5;i++) {await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:Math.round(from+(to-from)*i/5)}]});await page.waitForTimeout(20);}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   } else {await page.mouse.move(x,(from+to)/2);await page.mouse.wheel(0,250);}
   await page.waitForTimeout(200);
  }
  assert.fail('dropdown must scroll to its last item with real input');
 } finally {await cdp?.detach();}
}
export async function run({setup,story,out,capture}) {
 // Mobile page + mouse/pen-like primary input must still get a short-screen layout.
 for(const hasTouch of [true,false]) {
  for(const [width,height] of [[740,280],[915,412],[1280,540],[1536,600]]) {
   const {page,context}=await setup({seed:true,mobile:true,hasTouch,width,height});
   const press=selector=>hasTouch?page.locator(selector).tap():page.locator(selector).click();
   await page.evaluate(()=>window.__audit.showScreen('archive-screen'));await page.waitForTimeout(500);
   await inViewport(page,'#archive-tabs');await inViewport(page,'#archive-open-record',44);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),'archive must not require page scrolling');
   await press('#archive-tab-0');await press('#disk-list [data-disk="A"]');
   await page.waitForFunction(()=>{const r=document.querySelector('#record-list [data-record="A-01"]').getBoundingClientRect();return r.x>=0&&r.right<=innerWidth;});
   await inViewport(page,'#record-list [data-record="A-01"]');await hit(page,'#record-list [data-record="A-01"]');
   await press('#record-list [data-record="A-01"]');await press('#archive-open-record');
   await page.waitForFunction(()=>window.__audit.state.screen==='objective-screen'&&!window.__audit.state.loading);
   await inViewport(page,'#start-story',44);
   await story(page,'C-02',76);await press('#story-menu-toggle');await page.waitForTimeout(250);
   for(const s of ['#story-options summary','#auto-button','[data-action="next-line"]']) {await inViewport(page,s,44);await hit(page,s);}
   assert.equal(await page.locator('#story-hud kbd').first().isVisible(),!hasTouch);
   await press('#story-options summary');
   const settings='.story-options-menu [data-action="show-settings"]';
   await inViewport(page,settings);await hit(page,settings);
   await capture(page,`viewport-menu-${width}-${hasTouch}`);
   await press(settings);assert.equal(await page.evaluate(()=>window.__audit.state.screen),'settings-screen');
   await page.evaluate(()=>window.__audit.goBack());
   await page.waitForFunction(()=>window.__audit.state.screen==='story-screen'&&!window.__audit.state.loading);
   await page.evaluate(()=>{window.__audit.setStoryMenu(true);document.querySelector('#story-options').open=true;});
   await page.waitForTimeout(150);
   await scrollOptions(page,hasTouch);
   await inViewport(page,'#instant-button');await hit(page,'#instant-button');
   const before=await page.evaluate(()=>window.__audit.state.instant);await press('#instant-button');
   assert.equal(await page.evaluate(()=>window.__audit.state.instant),!before);
   assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),76);
   if(!hasTouch) {
    // A touch-capable browser can report a fine primary pointer (pen/mouse).
    await page.evaluate(()=>{Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,value:5});window.__audit.syncInputGuidance();});
    assert.equal(await page.locator('#app').getAttribute('data-input'),'touch');
    assert.equal(await page.locator('#story-hud kbd').first().isVisible(),false);
   }
   out('viewport-input',{width,height,hasTouch,archive:true,menuHitTest:true,settings:true,dropdownEnd:true});
   await context.close();
  }
 }
 for(const hasTouch of [true,false]) {
  const {page,context}=await setup({seed:true,mobile:true,hasTouch,width:740,height:280});
  for(const large of [false,true]) {
   await page.evaluate(large=>{window.__audit.state.textSize=large?'large':'normal';window.__audit.saveProgress();},large);
   for(const id of ['A-08','B-08','C-00','D-01','D-04','D-07','D-09','D-10','D-14']) {
    await openReport(page,id);
    // A meaningful first paragraph must be visible before any page scrolling.
    const first=await page.locator('#objective-body p').first().boundingBox();
    assert.ok(first&&first.y>=0&&first.y+Math.min(first.height,32)<=280,`${id}: first text ${JSON.stringify(first)}`);
    assert.equal(await page.evaluate(()=>scrollY),0);
    if(id==='D-14'&&!large)await capture(page,`viewport-report-${hasTouch}`);
   }
  }
  out('viewport-report-start',{hasTouch,reports:9,largeText:true});await context.close();
 }
 // Crossing compact/desktop boundaries must update panel visibility and JS inert state together.
 for(const hasTouch of [false,true]) {
  const {page,context}=await setup({seed:true,mobile:false,hasTouch,width:1366,height:768});
  await page.evaluate(()=>window.__audit.showScreen('archive-screen'));await page.waitForTimeout(500);
  for(const [width,height,compact] of [[915,412,true],[412,915,true],[760,700,true],[761,700,hasTouch],[1180,700,hasTouch],[1181,700,false],[1536,600,true],[1536,601,false],[1366,768,false]]) {
   await page.setViewportSize({width,height});await page.waitForTimeout(200);
   assert.equal(await page.locator('#archive-tabs').isVisible(),compact);
   const panes=await page.locator('#archive-layout > .panel').evaluateAll(es=>es.map(e=>({inert:e.inert,role:e.getAttribute('role')})));
   assert.equal(panes.filter(p=>p.inert).length,compact?2:0);
   assert.ok(panes.every(p=>compact?p.role==='tabpanel':p.role===null));
   if(compact)await inViewport(page,'#archive-open-record',44);
  }
  out('viewport-boundaries',{hasTouch,transitions:9});
  await story(page,'C-02',76);
  for(const size of [{width:915,height:412},{width:412,height:915},{width:740,height:280},{width:1366,height:768}]) {
   await page.setViewportSize(size);
   await page.evaluate(()=>{window.__audit.setStoryMenu(true);document.querySelector('#story-options').open=true;document.querySelector('.story-options-menu').scrollTop=0;});
   await page.waitForTimeout(250);
   await inViewport(page,'.story-options-menu [data-action="show-settings"]');await hit(page,'.story-options-menu [data-action="show-settings"]');
  }
  await page.setViewportSize({width:412,height:915});await openReport(page,'A-08');
  await page.locator('#report-section-2').evaluate(e=>e.scrollIntoView({block:'start'}));
  await page.setViewportSize({width:915,height:412});await page.waitForTimeout(300);
  assert.ok(await page.locator('#report-section-2').evaluate(e=>{const r=e.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight;}),'rotation retains the report section being read');
  out('viewport-rotation',{hasTouch,openDropdown:true,reportAnchor:true});await context.close();
 }
}
