import assert from 'node:assert/strict';
export async function run({setup,story,out,capture}) {
  for(const [width,height,mobile] of [[320,568,true],[915,412,true],[1280,720,false],[1366,768,false]]) {
    const {page,context}=await setup({seed:true,width,height,mobile});
    for(const large of [false,true]) {
      await page.evaluate(large=>{const a=window.__audit;a.state.effectsReduced=true;a.state.textSize=large?'large':'normal';a.saveProgress();a.showScreen('archive-screen');},large);
      const records=await page.evaluate(()=>window.__audit.orderedRecords.map(r=>({id:r.id,kind:r.relatedReport?'related':'main'})));
      for(const record of records) {
        await page.evaluate(({id,kind})=>{const a=window.__audit;a.state.archiveRecordKind=kind;a.state.selectedRecordId=id;a.selectDisk(id[0],false);a.selectRecord(id);},record);
        const b=await page.locator(mobile?'#archive-open-record':'#open-record').boundingBox();
        assert.ok(b.y>=0 && b.y+b.height<=height,`${record.id} ${width} ${large}: ${JSON.stringify(b)}`);
      }
      out('all-record-entry',{width,height,mobile,large,records:records.length});
    }
    await page.waitForTimeout(600);await capture(page,`archive-entry-${width}`);
    await page.evaluate(()=>{const a=window.__audit;a.state.archiveRecordKind='main';a.state.selectedRecordId='A-04';a.selectDisk('A',false);});
    await story(page,'A-04',5);await page.waitForTimeout(700);await capture(page,`attachment-guide-${width}`);
    await page.locator('#story-menu-toggle').click();await page.locator('#auto-button').click();
    await page.waitForTimeout(300);await capture(page,`auto-menu-${width}`);
    await context.close();
  }
}
