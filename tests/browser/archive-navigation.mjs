import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Use full Chromium via PLAYWRIGHT_CHROMIUM_EXECUTABLE for native touch/snap checks.
const info=page=>page.evaluate(()=>{
  const a=window.__audit,l=document.querySelector('#archive-layout');
  return {pane:a.state.archivePane,left:l.scrollLeft,width:l.clientWidth,disk:a.state.selectedDisk,
    scale:visualViewport.scale,viewportLeft:visualViewport.offsetLeft,viewportTop:visualViewport.offsetTop,
    record:a.state.selectedRecordId,focus:document.activeElement.id || document.activeElement.dataset.record || document.activeElement.dataset.disk,
    tabs:[...document.querySelectorAll('#archive-tabs button')].map(e=>e.getAttribute('aria-selected')),
    inert:[...l.children].map(e=>e.inert)};
});
async function settled(page,pane) {
  try { await page.waitForFunction(pane=>{
    const l=document.querySelector('#archive-layout');
    return window.__audit.state.archivePane===pane && Math.abs(l.scrollLeft-l.clientWidth*pane)<2;
  },pane,{timeout:6000}); } catch(error) { console.log('unsettled',await info(page));throw error; }
  await page.waitForTimeout(220);
  const value=await info(page);
  assert.equal(value.pane,pane);assert.ok(Math.abs(value.left-value.width*pane)<2,JSON.stringify(value));
}
async function pane(page,index) {
  const current=await info(page);
  if(current.pane===index && Math.abs(current.left-current.width*index)<2) {await settled(page,index);return;}
  if(await page.evaluate(()=>matchMedia('(pointer:coarse)').matches))await page.locator('#archive-tab-'+index).tap();
  else await page.locator('#archive-tab-'+index).click();
  await settled(page,index);
}
async function trace(page) {
  await page.evaluate(()=>{
    window.archiveTrace=[];window.archiveTracing=true;
    const frame=()=>{
      const l=document.querySelector('#archive-layout');
      window.archiveTrace.push({pane:window.__audit.state.archivePane,left:l.scrollLeft,width:l.clientWidth});
      if(window.archiveTracing)requestAnimationFrame(frame);
    };frame();
  });
}
async function endTrace(page) {
  return page.evaluate(()=>{window.archiveTracing=false;return window.archiveTrace;});
}
async function gesture(page,cdp,from,to,end=true) {
  const box=await page.locator('#archive-layout').boundingBox();
  const y=Math.round(box.y+Math.min(110,box.height/2)),start=Math.round(box.x+box.width*from),finish=Math.round(box.x+box.width*to);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start,y}]});
  for(let step=1;step<=6;step++) {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:Math.round(start+(finish-start)*step/6),y}]});
    await page.waitForTimeout(20);
  }
  if(end)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
}
export async function run({setup,out,root}) {
  const {context,page}=await setup({seed:true});
  await page.evaluate(()=>window.__audit.showScreen('archive-screen'));
  const cdp=await context.newCDPSession(page);
  for(const disk of ['A','B','C','D']) {
    await pane(page,1);
    await gesture(page,cdp,.15,.85,false);
    await page.evaluate(disk=>document.querySelector('#disk-list [data-disk="'+disk+'"]').click(),disk);
    await trace(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(1000);
    const frames=await endTrace(page);
    await fs.writeFile(path.join(root,'archive-touch-'+disk+'.json'),JSON.stringify(frames));
    assert.ok(frames.every(frame=>frame.pane===1),disk+' touch selection changed destination: '+JSON.stringify([...new Set(frames.map(f=>f.pane))]));
    let movingToDestination=false;
    for(let index=1;index<frames.length;index++) {
      const delta=frames[index].left-frames[index-1].left;
      if(delta>2)movingToDestination=true;
      if(movingToDestination)assert.ok(delta>=-2,disk+' returned to the old snap after moving to the destination');
    }
    await settled(page,1);assert.equal((await info(page)).disk,disk);
    // A disk choice immediately supersedes an earlier tab choice.
    await page.evaluate(()=>document.querySelector('#archive-tab-0').click());
    await page.waitForTimeout(70);
    await page.evaluate(disk=>document.querySelector('#disk-list [data-disk="'+disk+'"]').click(),disk);
    await trace(page);await page.waitForTimeout(800);
    assert.ok((await endTrace(page)).every(frame=>frame.pane===1));
    await settled(page,1);
    out('archive-selection-races',{disk,touch:true,programmatic:true});
  }
  // Last explicit selection wins, including repeated requests before settling.
  await page.evaluate(()=>{
    for(const disk of ['A','B','C','D','B'])document.querySelector('#disk-list [data-disk="'+disk+'"]').click();
    for(const index of [0,2,0,1,2])document.querySelector('#archive-tab-'+index).click();
  });
  await settled(page,2);assert.equal((await info(page)).disk,'B');
  // Height-only changes must not issue horizontal restoration during a gesture.
  await pane(page,1);await gesture(page,cdp,.15,.85,false);
  await page.evaluate(()=>{
    const l=document.querySelector('#archive-layout');
    window.archiveScrollCalls=[];window.originalArchiveScrollTo=l.scrollTo;
    l.scrollTo=function(options){window.archiveScrollCalls.push(options);return window.originalArchiveScrollTo.call(this,options);};
  });
  await page.setViewportSize({width:412,height:800});await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.archiveScrollCalls.length),0);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await settled(page,0);
  await page.evaluate(()=>{document.querySelector('#archive-layout').scrollTo=window.originalArchiveScrollTo;});
  out('archive-priority-and-height',{lastSelectionWins:true,heightDoesNotRestore:true});
  await context.close();

  for(const [width,height,mobile] of [[412,915,true],[360,640,true],[320,568,true],[915,412,true],[1920,1080,false],[1366,768,false],[1280,720,false],[760,700,false]]) {
    const {context,page}=await setup({seed:true,width,height,mobile});
    await page.evaluate(()=>window.__audit.showScreen('archive-screen'));
    const tabbed=mobile || width<=760,cdp=mobile?await context.newCDPSession(page):null;
    for(const large of [false,true]) {
      await page.evaluate(large=>{window.__audit.state.textSize=large?'large':'normal';window.__audit.saveProgress();},large);
      if(tabbed)await pane(page,0);
      for(const disk of ['A','B','C','D']) {
        if(tabbed)await pane(page,0);
        const button=page.locator('#disk-list [data-disk="'+disk+'"]');
        if(mobile)await button.tap();else await button.click();
        if(tabbed)await settled(page,1);
        assert.equal((await info(page)).disk,disk);
      }
      const row=page.locator('#record-list [data-record="D-05"]');
      if(mobile)await row.tap();else await row.click();
      assert.equal((await info(page)).record,'D-05');
      if(!mobile)assert.equal((await info(page)).focus,'D-05');
      if(tabbed) {
        await pane(page,2);
        await page.locator('#archive-tab-2').focus();
        await page.keyboard.press('Home');await settled(page,0);
        assert.equal((await info(page)).focus,'archive-tab-0');
        await page.keyboard.press('End');await settled(page,2);
        assert.equal((await info(page)).focus,'archive-tab-2');
        if(mobile) {
          await gesture(page,cdp,.2,.8);await settled(page,1);
          await gesture(page,cdp,.2,.8);await settled(page,0);
          // Keep this sub-threshold drag off disk buttons: a native tap there
          // correctly selects a disk and moves to the file list.
          await pane(page,2);
          await trace(page);
          await gesture(page,cdp,.6,.55);
          await page.waitForTimeout(700);
          await fs.writeFile(path.join(root,`archive-short-${width}-${large}.json`),JSON.stringify(await endTrace(page)));
          await settled(page,2);
          await pane(page,0);
          await gesture(page,cdp,.85,.15);await settled(page,1);
        } else {
          const box=await page.locator('#archive-layout').boundingBox();
          await page.mouse.move(box.x+box.width/2,box.y+100);
          await page.mouse.wheel(-700,0);await settled(page,1);
          await pane(page,2);
        }
        await pane(page,2);
      } else {
        assert.deepEqual((await info(page)).inert,[false,false,false]);
        assert.equal(await page.locator('#archive-tabs').isVisible(),false);
        await page.mouse.wheel(0,300);
      }
      // Rotate mobile; cross the desktop breakpoint and return on PC.
      await page.setViewportSize(mobile ? {width:height,height:width} : {width:tabbed?1366:760,height:700});
      await page.waitForTimeout(250);
      assert.equal((await info(page)).record,'D-05');
      await page.setViewportSize({width,height});await page.waitForTimeout(250);
      const final=await info(page);
      assert.equal(final.disk,'D');assert.equal(final.record,'D-05');
      if(tabbed)await settled(page,2);else assert.deepEqual(final.inert,[false,false,false]);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.locator(tabbed?'#archive-open-record':'#open-record').click();
      await page.locator('#objective-screen').waitFor({state:'visible'});
      await page.locator('#objective-screen [data-action="back-archive"]').click();
      await page.locator('#archive-screen').waitFor({state:'visible'});
      assert.equal((await info(page)).record,'D-05');
      out('archive-input-and-resize',{width,height,mobile,large,selection:true,keyboard:true,resize:true,openAndReturn:true});
    }
    await context.close();
  }
}
