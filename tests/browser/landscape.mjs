import assert from 'node:assert/strict';
export async function run({setup,story,out,capture}) {
 for(const [width,height] of [[740,360],[915,412],[1280,540],[1536,600]]) {
  const {page,context}=await setup({seed:true,width,height,mobile:true});
  const visible=async selector=>{
   const r=await page.locator(selector).boundingBox();
   assert.ok(r&&r.width>0&&r.height>0&&r.x>=-1&&r.y>=-1&&r.x+r.width<=width+1&&r.y+r.height<=(await page.viewportSize()).height+1,`${width}x${height} ${selector}: ${JSON.stringify(r)}`);return r;
  };
  await page.evaluate(()=>window.__audit.showScreen('archive-screen'));
  await page.waitForTimeout(350);
  await visible('#archive-open-record');await visible('#archive-tabs');
  const list=await visible('#archive-layout');assert.ok(list.height>=height*.3,'record list gets usable height');
  await capture(page,`landscape-archive-${width}`);
  for(const id of ['A-01','B-01','C-01','D-03']) {
   await page.evaluate(async id=>{const a=window.__audit;a.state.selectedRecordId=id;a.selectDisk(window.RustedPrayerArchive.getRecord(id).diskId,false);await a.openObjective();},id);
   await visible('#start-story');
  }
  await capture(page,`landscape-intro-${width}`);
  await story(page,'A-01',1);await page.waitForTimeout(1600);
  await visible('#a-identity-hud');
  await capture(page,`landscape-hud-${width}`);
  for(const newHeight of [height-60,height]) {
   await page.setViewportSize({width,height:newHeight});await page.waitForTimeout(150);
   const stage=await visible('#story-stage');assert.ok(stage.y>=8,'safe top spacing');
   await visible('#a-identity-hud');
  }
  await story(page,'A-04',5);await page.waitForTimeout(600);await visible('#insert-card');
  await capture(page,`landscape-document-${width}`);
  await story(page,'A-02',3);await page.waitForTimeout(600);await visible('#communication-panel');
  const feed=await visible('#communication-feed');assert.ok(feed.height>=65,'chat reading area');
  await capture(page,`landscape-chat-${width}`);
  await page.evaluate(()=>{const a=window.__audit;const r=window.RustedPrayerArchive.getRecord('B-05');a.state.selectedRecordId=r.id;a.openRecordTransition(r,window.RustedPrayerArchive.getRecord(r.nextId));});
  await visible('#transition-next');await visible('#transition-auto');await capture(page,`landscape-next-${width}`);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
  out('landscape',{width,height,archive:true,intros:true,hud:true,resize:true,document:true,chat:true,transition:true});
  await context.close();
 }
 // The first visit must also keep its primary action above the setup guide.
 const fresh=await setup({width:740,height:360,mobile:true});
 await fresh.page.evaluate(async()=>{const a=window.__audit;a.state.selectedRecordId='A-01';a.selectDisk('A',false);await a.openObjective();});
 const button=await fresh.page.locator('#start-story').boundingBox();assert.ok(button.y>=0&&button.y+button.height<=360);
 await fresh.context.close();
}
