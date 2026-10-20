import assert from 'node:assert/strict';
export async function run({setup,out}) {
  for(const mobile of [true,false]) {
    const {context,page}=await setup({seed:true,mobile,width:mobile?412:1366,height:mobile?915:768});
    await page.evaluate(async()=>{
      const a=window.__audit;
      a.state.selectedRecordId='D-04';a.selectDisk('D',false);
      a.state.autoResume=true;await a.openObjective('push',{scrollTop:700});
      a.saveProgress();
    });
    await page.reload();await page.waitForFunction(()=>window.__audit&&!window.__audit.state.loading);
    if(await page.locator('#enter-archive').isVisible())await page.locator('#enter-archive').click();
    await page.waitForFunction(()=>window.__audit.state.screen==='objective-screen'&&!window.__audit.state.loading);
    assert.equal(await page.evaluate(()=>window.__audit.state.presentedRecordId),'D-04');
    assert.equal(await page.evaluate(()=>Math.round(scrollY)),700);
    // Explicit library/bookmark entry selects its section even in a completed document.
    await page.evaluate(()=>window.__audit.openReadLocation('D-04',2));
    assert.ok(Math.abs(await page.locator('#report-section-2').evaluate(e=>e.getBoundingClientRect().top-parseFloat(getComputedStyle(e).scrollMarginTop || 0)))<2);
    const before=await page.evaluate(()=>({scroll:scrollY,line:window.__audit.state.lineIndex}));
    // Cancelling a report jump cannot scroll the previous report to the target section.
    await page.evaluate(async()=>{
      const a=window.__audit,pending=a.openReadLocation('C-00',1);
      a.cancelLoading();await pending;
    });
    assert.equal(await page.evaluate(()=>window.__audit.state.presentedRecordId),'D-04');
    assert.equal(await page.evaluate(()=>window.__audit.state.lineIndex),before.line);
    assert.equal(await page.evaluate(()=>scrollY),before.scroll);
    // Direct related reading offers an explicit saved-main resume destination.
    await page.evaluate(async()=>{
      const a=window.__audit;a.state.reportContext=null;a.state.archiveRecordKind='related';
      a.state.selectedRecordId='D-07';a.selectDisk('D',false);await a.openObjective();
    });
    assert.equal(await page.locator('.report-end [data-action="resume-main"]').innerText(),'본편 이어보기');
    await page.locator('.report-end [data-action="resume-main"]').click();
    await page.waitForFunction(()=>window.__audit.state.presentedRecordId==='D-04'&&!window.__audit.state.loading);
    assert.equal(await page.evaluate(()=>scrollY),before.scroll);
    // Without a saved main cursor, the same action clearly returns to the D main list.
    await page.evaluate(async()=>{
      const a=window.__audit;delete a.state.progress.resumeRecordId;a.state.reportContext=null;
      a.state.archiveRecordKind='related';a.state.selectedRecordId='D-07';a.selectDisk('D',false);await a.openObjective();
    });
    assert.equal(await page.locator('.report-end [data-action="resume-main"]').innerText(),'D편 본편 보기');
    await page.locator('.report-end [data-action="resume-main"]').click();
    assert.equal(await page.evaluate(()=>window.__audit.state.screen),'archive-screen');
    assert.equal(await page.evaluate(()=>window.__audit.state.archiveRecordKind),'main');
    // Final report completion through related material reaches the actual ending.
    await page.evaluate(async()=>{
      const a=window.__audit;a.state.selectedRecordId='D-14';a.selectDisk('D',false);await a.openObjective();
      a.handleAction('open-d-report',document.querySelector('[data-report-id="D-10"]'));
    });
    await page.waitForFunction(()=>window.__audit.state.presentedRecordId==='D-10'&&!window.__audit.state.loading);
    await page.locator('#report-continue-main').click();
    await page.waitForFunction(()=>window.__audit.state.screen==='ending-screen'&&!window.__audit.state.loading);
    await page.reload();await page.waitForFunction(()=>window.__audit&&!window.__audit.state.loading);
    assert.equal(await page.evaluate(()=>window.__audit.recordProgress('D-14').completed),true);
    assert.equal(await page.evaluate(()=>window.__audit.recordProgress('D-10').completed),true);
    out('report-lifecycle',{mobile,reloadResume:true,bookmarkSection:true,cancelKeepsPosition:true,directResumeOrList:true,finalEnding:true,durableCompletion:true});
    await context.close();
  }
}
