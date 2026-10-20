import assert from 'node:assert/strict';
export async function run({setup,out}) {
  const {context,page}=await setup();
  const cdp=await context.newCDPSession(page);
  await page.evaluate(()=>window.__audit.showScreen('archive-screen'));
  const settle=async index=>{
    try { await page.waitForFunction(index=>{
      const l=document.querySelector('#archive-layout');
      return window.__audit.state.archivePane===index && Math.abs(l.scrollLeft-l.clientWidth*index)<2;
    },index,{timeout:6000}); } catch(error) {
      console.log(await page.evaluate(()=>({navigation:window.__audit.archiveNavigation,pane:window.__audit.state.archivePane,left:document.querySelector('#archive-layout').scrollLeft})));
      throw error;
    }
    await page.waitForTimeout(220);
  };
  await page.locator('#archive-tab-0').tap();await settle(0);
  await page.locator('#archive-tab-2').tap();
  const box=await page.locator('#archive-layout').boundingBox(),y=Math.round(box.y+90);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:60,y}]});
  for(const x of [110,180,260,340]) {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y}]});await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await settle(1);
  out('new-touch-after-explicit-selection',{freshProgress:true,destination:1});

  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:300,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:170,y}]});
  await page.evaluate(()=>document.querySelector('#archive-tab-2').click());
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  await settle(2);
  out('cancelled-touch-releases-navigation',{destination:2});

  await page.evaluate(()=>window.addEventListener('scrollend',event=>event.stopImmediatePropagation(),true));
  await page.locator('#archive-tab-0').tap();await settle(0);
  await page.locator('#archive-tab-1').tap();await settle(1);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('#archive-tab-2').tap();await settle(2);
  await page.locator('#archive-tab-0').tap();await settle(0);
  out('scrollend-fallback-and-reduced-motion',{destinationsStable:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await context.close();
}
