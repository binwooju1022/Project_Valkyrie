import assert from 'node:assert/strict';
export async function run({setup,out}) {
 const {page,context}=await setup({seed:true});
 const data=await page.evaluate(()=>{
  const a=window.__audit;return a.orderedRecords.map(r=>({id:r.id,display:r.displayId||r.id,text:JSON.stringify(r),scenes:(r.reportSections||r.story).map(s=>s.sceneId)}));
 });
 assert.ok(data.find(r=>r.id==='A-08').text.includes('블랙박스 및 드론'));
 assert.ok(!data.find(r=>r.id==='A-08').text.includes('블랙박스 및 초소형 드론'));
 assert.ok(data.find(r=>r.id==='C-01').text.includes('잔존 랩쳐 확인 결과.'));
 assert.ok(!data.find(r=>r.id==='D-14').text.includes('특별 관찰 대상'));
 assert.equal(data.find(r=>r.id==='D-14').display,'D-06');
 assert.match(await page.locator('.ending-credit-list').textContent(),/D편 배경 이미지.*승리의 여신: 니케/s);
 await page.evaluate(()=>window.__audit.handleAction('show-settings'));
 assert.deepEqual(await page.locator('#setting-archive-music option').evaluateAll(es=>es.map(e=>e.value)),['side-story','waiting-commander']);
 for(const viewed of [false,true]) {
  const choice=await page.evaluate(viewed=>{const a=window.__audit;a.loadProgress({...a.progressStore.read(),archiveMusic:'auto',endingViewed:viewed});return a.state.archiveMusic;},viewed);
  assert.equal(choice,viewed?'waiting-commander':'side-story');
 }
 out('release-content',{copy:true,credits:true,twoChoices:true,legacyAutoMigration:true});await context.close();
}
