import assert from 'node:assert/strict';
const mainIds=['A-08','B-08','C-00','D-04','D-14'];
const relatedIds=['D-01','D-07','D-09','D-10'];
async function open(page,id,position=null) {
  await page.evaluate(async({id,position})=>{
    const a=window.__audit;a.state.reportContext=null;a.state.archiveRecordKind=id.startsWith('D-')&&['D-01','D-07','D-09','D-10'].includes(id)?'related':'main';
    a.state.selectedRecordId=id;a.selectDisk(id[0],false);await a.openObjective('push',position);
  },{id,position});
  await page.waitForFunction(id=>!window.__audit.state.loading && window.__audit.state.presentedRecordId===id && window.__audit.state.screen==='objective-screen',id);
}
async function modify(page,id,changes) {
  await page.evaluate(({id,changes})=>{
    const a=window.__audit,saved=a.progressStore.read();
    a.showScreen('archive-screen','replace');
    saved.records[id]={...saved.records[id],...changes};
    a.progressStore.save(saved,true);a.loadProgress();
  },{id,changes});
}
async function related(page,id) {
  await page.evaluate(id=>window.__audit.handleAction('open-d-report',document.querySelector('[data-report-id="'+id+'"]')),id);
  await page.waitForFunction(id=>!window.__audit.state.loading && window.__audit.state.presentedRecordId===id,id);
}
async function bottom(page,mobile,cdp,selector='#report-finish') {
  await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight-innerHeight-140,behavior:'instant'}));
  if(mobile) {
    const {width,height}=page.viewportSize();
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:Math.round(width*.55),y:Math.round(height*.8)}]});
    for(let i=1;i<=5;i++) {
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:Math.round(width*.55),y:Math.round(height*(.8-i*.09))}]});
      await page.waitForTimeout(20);
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  } else {
    await page.mouse.move(page.viewportSize().width/2,page.viewportSize().height/2);
    await page.mouse.wheel(0,500);
    await page.keyboard.press('End');
  }
  await page.waitForTimeout(250);
  const bounds=await page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,scroll:scrollY,max:document.documentElement.scrollHeight-innerHeight};});
  assert.ok(bounds.bottom<=bounds.height+1 && bounds.top>=0,JSON.stringify(bounds));
}
export async function run({setup,out,capture}) {
  for(const mobile of [true,false]) {
    const {context,page}=await setup({seed:true,width:mobile?412:1366,height:mobile?915:768,mobile});
    // Completed general reopens start at the top; unfinished reads retain their position.
    for(const id of mainIds) {
      await modify(page,id,{completed:true,reportScroll:650,inProgress:false});
      await open(page,id);assert.equal(await page.evaluate(()=>scrollY),0,id);
      await modify(page,id,{completed:false,reportScroll:400,inProgress:true});
      await open(page,id);
      assert.equal(await page.evaluate(()=>Math.round(scrollY)),400,id);
      await page.evaluate(()=>window.__audit.handleAction('show-settings'));
      await page.evaluate(()=>window.__audit.goBack());
      await page.waitForFunction(()=>window.__audit.state.screen==='objective-screen'&&!window.__audit.state.loading);
      assert.equal(await page.evaluate(()=>Math.round(scrollY)),400,id+' settings return');
      // A browser-history return restores an explicit position even for a completed report.
      await page.evaluate(()=>{window.__audit.state.progress.records[window.__audit.state.selectedRecordId].completed=true;window.__audit.saveProgress();});
      const view=await page.evaluate(()=>window.__audit.viewState());
      await page.evaluate(()=>window.__audit.showScreen('archive-screen'));
      await page.evaluate(view=>window.__audit.restoreView(view),view);
      assert.equal(await page.evaluate(()=>Math.round(scrollY)),400,id+' history');
    }
    out('report-position-intents',{mobile,mainReports:5,completedTop:true,unfinishedResume:true,settings:true,history:true});
    for(const id of relatedIds) {
      await modify(page,'D-04',{completed:false,inProgress:true,reportScroll:400});
      await open(page,'D-04');await related(page,id);
      const savedContext=await page.evaluate(()=>({...window.__audit.state.reportContext}));
      assert.equal(savedContext.recordId,'D-04');
      assert.equal(await page.locator('#report-continue-main').count(),1);
      await page.locator('#report-finish').click();
      await page.waitForFunction(()=>window.__audit.state.presentedRecordId==='D-04'&&!window.__audit.state.loading);
      assert.equal(await page.evaluate(()=>Math.round(scrollY)),Math.round(savedContext.scrollTop));
      assert.equal(await page.evaluate(()=>window.__audit.recordProgress('D-04').completed),false);
      await related(page,id);
      await page.locator('#report-continue-main').click();
      await page.waitForFunction(()=>window.__audit.state.presentedRecordId==='D-05'&&!window.__audit.state.loading);
      assert.equal(await page.evaluate(()=>window.__audit.recordProgress('D-04').completed),true);
      assert.equal(await page.evaluate(id=>window.__audit.recordProgress(id).completed,id),true);
      // Directly opened related material has no arbitrary main-completion action.
      await open(page,id);
      assert.equal(await page.locator('#report-continue-main').count(),0);
      await page.locator('#report-finish').click();
      assert.equal(await page.evaluate(()=>window.__audit.state.screen),'archive-screen');
      out('related-report-actions',{mobile,id,returnKeepsMainUnread:true,nextCompletesMain:true,directOpen:true});
    }
    // A story context offers return only; preserve the exact line and subpage.
    await page.evaluate(async()=>{
      const a=window.__audit;a.state.archiveRecordKind='main';a.state.selectedRecordId='D-05';a.selectDisk('D',false);await a.startStory(false,3);
      a.handleAction('show-related');a.state.selectedRecordId='D-07';a.selectDisk('D',false);await a.openObjective();
    });
    assert.equal(await page.locator('#report-continue-main').count(),0);
    await page.locator('#report-finish').click();
    await page.waitForFunction(()=>window.__audit.state.screen==='story-screen'&&!window.__audit.state.loading);
    assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),3);
    out('story-context-return',{mobile,line:3});
    await context.close();
  }
  for(const [width,height,mobile] of [[412,915,true],[360,640,true],[320,568,true],[915,412,true],[1920,1080,false],[1366,768,false],[1280,720,false],[760,700,false]]) {
    const {context,page}=await setup({seed:true,width,height,mobile});
    const cdp=mobile?await context.newCDPSession(page):null;
    for(const large of [false,true]) {
      await page.evaluate(large=>{window.__audit.state.textSize=large?'large':'normal';window.__audit.saveProgress();},large);
      for(const id of [...mainIds,...relatedIds]) {
        if(relatedIds.includes(id)) {await open(page,'D-04',{scrollTop:400});await related(page,id);}
        else await open(page,id);
        assert.equal(await page.locator('#report-flow').count(),0);
        await bottom(page,mobile,cdp);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        if(!mobile) {
          await page.locator('#report-finish').focus();await page.keyboard.press('Enter');
        } else await page.locator('#report-finish').tap();
        await page.waitForFunction(()=>!window.__audit.state.loading);
        assert.notEqual(await page.evaluate(()=>window.__audit.state.screen==='objective-screen'&&window.__audit.state.presentedRecordId),id);
        if(relatedIds.includes(id)) {
          await related(page,id);
          await bottom(page,mobile,cdp,'#report-continue-main');
          if(mobile)await page.locator('#report-continue-main').tap();
          else {await page.locator('#report-continue-main').focus();await page.keyboard.press('Enter');}
          await page.waitForFunction(()=>window.__audit.state.presentedRecordId==='D-05'&&!window.__audit.state.loading);
        }
      }
      out('report-footer-ui',{width,height,mobile,large,reports:9,actualInput:true,noFixedBar:true});
    }
    await open(page,'D-04',{scrollTop:400});await related(page,'D-07');
    await page.locator('.report-end').scrollIntoViewIfNeeded();
    await capture(page,`report-footer-${width}x${height}`);
    await context.close();
  }
}
