import assert from 'node:assert/strict';
async function archive(page) {
  await page.evaluate(()=>{const a=window.__audit;a.state.reportContext=null;a.state.archiveRecordKind='main';a.showScreen('archive-screen');});
}
async function ending(page) {
  await page.evaluate(()=>window.__audit.handleAction('view-ending'));
  await page.waitForFunction(()=>window.__audit.state.screen==='ending-screen'&&!window.__audit.state.loading);
}
const viewed=page=>page.evaluate(()=>window.__audit.progressStore.read().endingViewed===true);
const track=page=>page.evaluate(()=>window.__bgmAudit.desired()?.id);
const playing=page=>page.waitForFunction(()=>{
  const {audio,desired}=window.__bgmAudit;
  return !audio.paused && audio.readyState>=2 && audio.src===window.RustedPrayerMedia.url(desired().src);
});
export async function run({setup,out,ready}) {
  const fresh=await setup();
  assert.equal(await viewed(fresh.page),false);
  assert.equal(await track(fresh.page),'side-story');
  await fresh.page.evaluate(()=>window.__audit.handleAction('show-settings'));
  assert.equal(await fresh.page.locator('#setting-archive-music option[value="waiting-commander"]').isDisabled(),true);
  await fresh.context.close();
  // Reload a real legacy checkpoint, without letting the current save path
  // repair it first. Photo availability and actual viewing are distinct.
  for(const wasViewed of [false,true]) {
    const {context,page}=await setup({seed:true});
    await page.evaluate(wasViewed=>{
      const saved=window.__audit.progressStore.read();
      delete saved.endingMusicUnlocked;delete saved._sync;
      saved.archiveMusic='side-story';saved.endingViewed=wasViewed;
      localStorage.clear();localStorage.setItem('rusted-prayer-mvp-progress',JSON.stringify(saved));
    },wasViewed);
    await page.reload();await page.waitForFunction(()=>window.__audit&&!window.__audit.state.loading);
    await archive(page);
    assert.equal(await track(page),'waiting-commander');
    assert.equal(await viewed(page),wasViewed,'unlock must not fabricate photo viewing');
    await page.evaluate(()=>window.__audit.handleAction('show-settings'));
    assert.equal(await page.locator('#setting-archive-music option[value="waiting-commander"]').isDisabled(),false);
    assert.deepEqual(await page.evaluate(()=>{
      const p=window.__audit.progressStore.read();return [p.endingMusicUnlocked,p.archiveMusic];
    }),[true,'waiting-commander'],'migration is immediately durable');
    await page.close();
    const reopened=await context.newPage();await ready(reopened);await archive(reopened);
    assert.equal(await track(reopened),'waiting-commander');
    await context.close();
  }
  // Completing the last record switches the default even before opening the photo.
  // Importing complementary progress must use the combined completion state too.
  for(const viaImport of [false,true]) {
    const {context,page}=await setup();
    await page.evaluate(()=>{
      const a=window.__audit,records=a.orderedRecords.filter(r=>!r.relatedReport);
      window.lastMainRecord=records.at(-1).id;
      for(const r of records.slice(0,-1))a.recordProgress(r.id).completed=true;
      a.saveProgress(false);
    });
    assert.equal(await track(page),'side-story');
    await page.evaluate(async viaImport=>{
      const a=window.__audit;
      if(viaImport)await a.importProgress(new File([JSON.stringify({version:24,records:{[window.lastMainRecord]:{completed:true,lineIndex:0}}})],'last.json'));
      else {a.recordProgress(window.lastMainRecord).completed=true;a.saveProgress(false);}
    },viaImport);
    await archive(page);assert.equal(await track(page),'waiting-commander');
    assert.equal(await page.evaluate(()=>window.__audit.progressStore.read().endingMusicUnlocked),true);
    // Leave in the reveal frame, before the photo-view callback or audio fade.
    await page.evaluate(async()=>{
      const a=window.__audit;await a.openEnding();a.showScreen('archive-screen');
    });
    assert.equal(await viewed(page),false);
    assert.equal(await track(page),'waiting-commander');
    await page.reload();await page.waitForFunction(()=>window.__audit&&!window.__audit.state.loading);
    await archive(page);assert.equal(await track(page),'waiting-commander');
    await context.close();
  }
  for(const mobile of [true,false]) {
    const {context,page}=await setup({seed:true,width:mobile?412:1366,height:mobile?915:768,mobile});
    await archive(page);
    assert.equal(await viewed(page),false,'legacy completed records do not imply photo viewing');
    assert.equal(await track(page),'waiting-commander');
    await page.keyboard.press('Shift');await playing(page);
    await page.evaluate(()=>window.RustedPrayerBgm.setMuted(true));
    assert.equal(await page.evaluate(()=>window.__bgmAudit.audio.paused),true);
    await page.evaluate(()=>window.RustedPrayerBgm.setMuted(false));await playing(page);
    await page.evaluate(async()=>{const a=window.__audit;a.state.selectedRecordId='A-08';a.selectDisk('A',false);await a.openObjective();});
    assert.equal(await track(page),'side-story');
    await playing(page);
    await page.evaluate(async()=>{const a=window.__audit;a.state.selectedRecordId='D-04';a.selectDisk('D',false);await a.openObjective();});
    const mainTrack=await track(page);
    await playing(page);
    await page.evaluate(()=>window.__audit.handleAction('open-d-report',document.querySelector('[data-report-id="D-07"]')));
    await page.waitForFunction(()=>window.__audit.state.presentedRecordId==='D-07'&&!window.__audit.state.loading);
    assert.equal(await track(page),mainTrack);
    await playing(page);
    await page.evaluate(()=>window.__audit.handleAction('show-settings'));
    assert.equal(await track(page),mainTrack);
    await archive(page);
    // Cancellation and failed image decoding must never count as viewing.
    await page.evaluate(()=>{
      const m=window.RustedPrayerMedia;window.originalPreload=m.preload;
      m.preload=(_, {signal})=>new Promise(resolve=>signal.addEventListener('abort',()=>resolve({failed:[]})));
      window.__audit.handleAction('view-ending');
    });
    await page.waitForFunction(()=>Boolean(window.__audit.state.loading));
    await page.evaluate(()=>window.__audit.cancelLoading());
    await page.waitForTimeout(50);
    assert.equal(await viewed(page),false);
    await page.evaluate(()=>{
      window.RustedPrayerMedia.preload=window.originalPreload;
      const img=document.querySelector('#ending-image');window.originalDecode=img.decode;img.decode=()=>Promise.reject(Error('decode failure'));
    });
    await ending(page);await page.waitForTimeout(100);
    assert.equal(await page.locator('#ending-unavailable').isVisible(),true);
    assert.equal(await viewed(page),false);
    await page.evaluate(()=>document.querySelector('#ending-image').decode=window.originalDecode);
    await archive(page);
    // Playback refusal is independent of image viewing and navigation.
    await page.evaluate(()=>{const a=window.__bgmAudit.audio;window.originalPlay=a.play;a.pause();a.play=()=>Promise.reject(new DOMException('blocked','NotAllowedError'));});
    await page.keyboard.press('Shift');
    await ending(page);
    await page.waitForFunction(()=>window.__audit.progressStore.read().endingViewed===true);
    assert.equal(await track(page),'waiting-commander');
    await archive(page);assert.equal(await track(page),'waiting-commander');
    // A directly opened introduction may still be playing the archive default.
    await page.evaluate(async()=>{const a=window.__audit;a.state.selectedRecordId='B-04';a.selectDisk('B',false);await a.openObjective();a.handleAction('show-settings');});
    assert.equal(await track(page),'waiting-commander');
    await page.locator('#settings-tab-audio').click();
    await page.locator('#setting-archive-music').selectOption('side-story');
    assert.equal(await track(page),'side-story');
    await page.locator('#setting-archive-music').selectOption('waiting-commander');
    await archive(page);
    await page.evaluate(()=>{window.__bgmAudit.audio.play=window.originalPlay;window.RustedPrayerBgm.setVolume(.23);window.RustedPrayerBgm.setMuted(true);});
    await page.evaluate(()=>window.__audit.handleAction('show-settings'));
    await page.locator('#settings-tab-audio').click();
    assert.equal(await page.locator('#setting-archive-music option[value="waiting-commander"]').isDisabled(),false);
    await page.locator('#setting-archive-music').selectOption('side-story');
    assert.equal(await track(page),'side-story','archive settings follow explicit music choice');
    const saved=await page.evaluate(()=>window.__audit.progressStore.read());
    await page.reload();await page.waitForFunction(()=>window.__audit&&!window.__audit.state.loading);
    await archive(page);
    assert.equal(await viewed(page),true);
    assert.equal(await track(page),'side-story');
    assert.equal(await page.evaluate(()=>window.__bgmAudit.audio.muted),true);
    assert.equal(await page.locator('#bgm-volume').inputValue(),'23');
    // Legacy import cannot clear the viewing flag or replace an omitted preference.
    await page.evaluate(async()=>{
      const a=window.__audit;a.handleAction('show-settings');
      await a.importProgress(new File([JSON.stringify({version:24,records:{'A-01':{completed:true,lineIndex:0}}})],'legacy.json'));
    });
    assert.equal(await viewed(page),true);
    assert.equal(await page.evaluate(()=>window.__audit.state.archiveMusic),'side-story');
    // Another tab receives the state and subsequent music changes.
    const second=await context.newPage();await ready(second);await archive(second);
    assert.equal(await viewed(second),true);assert.equal(await track(second),'side-story');
    await second.evaluate(()=>{window.RustedPrayerBgm.setVolume(.41);window.RustedPrayerBgm.setMuted(false);});
    await page.waitForFunction(()=>document.querySelector('#bgm-volume').value==='41'&&!window.__bgmAudit.audio.muted);
    await second.evaluate(()=>{window.RustedPrayerBgm.setVolume(.23);window.RustedPrayerBgm.setMuted(true);});
    await page.waitForFunction(()=>document.querySelector('#bgm-volume').value==='23'&&window.__bgmAudit.audio.muted);
    await page.locator('#settings-tab-audio').click();
    await page.locator('#setting-archive-music').selectOption('waiting-commander');
    await second.waitForFunction(()=>window.__audit.state.archiveMusic==='waiting-commander');
    assert.equal(await track(second),'waiting-commander');
    await second.evaluate(()=>window.__audit.handleAction('show-settings'));
    await second.locator('#settings-tab-audio').click();
    await second.locator('#setting-archive-music').selectOption('side-story');
    await page.waitForFunction(()=>window.__audit.state.archiveMusic==='side-story');
    await page.evaluate(()=>{const a=window.__audit;a.handleAction('open-reset');a.confirmReset();});
    await second.waitForFunction(()=>window.__audit.state.progress.endingViewed===false);
    assert.equal(await viewed(page),false);assert.equal(await track(second),'side-story');
    assert.equal(await page.evaluate(()=>window.__audit.progressStore.read().endingMusicUnlocked),false);
    assert.equal(await page.locator('#bgm-volume').inputValue(),'23');
    assert.equal(await page.evaluate(()=>window.__bgmAudit.audio.muted),true);
    // A valid backup restores actual viewing; invalid new fields are rejected atomically.
    await page.evaluate(async saved=>{const a=window.__audit;a.handleAction('show-settings');await a.importProgress(new File([JSON.stringify(saved)],'backup.json'));},saved);
    assert.equal(await viewed(page),true);
    await page.evaluate(()=>window.__audit.importProgress(new File([JSON.stringify({version:24,records:{},endingViewed:'yes',archiveMusic:'unknown'})],'invalid.json')));
    assert.match(await page.locator('#save-status').textContent(),/올바르지/);
    assert.equal(await viewed(page),true);
    assert.equal(await page.evaluate(()=>window.__audit.state.archiveMusic),'side-story');
    for(const selector of ['meta[name="description"]','meta[property="og:description"]','meta[name="twitter:description"]'])
      assert.equal(await page.locator(selector).getAttribute('content'),'기록 복원 완료. 접근 승인');
    out('music-ending',{mobile,legacyUnlockMigration:true,unlockBeforePlayback:true,earlyExit:true,mergedImportUnlock:true,a08Restored:true,relatedMusic:true,cancelAndFailure:true,viewedAfterPaint:true,blockedPlaybackIndependent:true,preferences:true,reload:true,import:true,reset:true,crossTab:true,metadata:true});
    await context.close();
  }
}
