(function () {
  'use strict';
  const $=selector=>document.querySelector(selector);
  const key='rusted-prayer-sfx-settings';
  let muted=false,volume=.6,unlocked=false,active=null,sceneAudio=null,sceneGain=1,sceneVisit=null,sceneRange=null,load=null,revision=0,sceneRevision=0;
  try {
    const saved=JSON.parse(localStorage.getItem(key) || '{}');
    if(typeof saved.muted==='boolean')muted=saved.muted;
    if(typeof saved.volume==='number' && Number.isFinite(saved.volume))volume=Math.max(0,Math.min(1,saved.volume));
  } catch {}
  const clips={};
  const sceneSources=window.RustedPrayerMediaManifest?.sfx?.clips || {};
  const sources=Object.fromEntries(['in-01','in-02','out-02','select','settings','cancel'].map(name=>[name,'./assets/audio/sfx/'+name+'.mp3']));
  Object.assign(sources,sceneSources);
  for(const [name,src] of Object.entries(sources)) {
    const audio=new Audio();
    audio.preload='auto';
    audio.src=window.RustedPrayerMedia.url(src);
    clips[name]=audio;
  }
  function silence() {
    active?.pause?.();
    if(active) {try {active.currentTime=0;} catch {}}
    active=null;
  }
  function stopScene() {
    sceneRevision++;
    sceneAudio?.pause?.();
    if(sceneAudio) {try {sceneAudio.currentTime=0;} catch {}}
    sceneAudio=null;sceneGain=1;sceneRange=null;
  }
  function play(name,relativeGain=1) {
    revision++;
    if(!clips[name] || !unlocked || muted || volume===0 || document.hidden)return;
    const audio=clips[name];
    const isScene=Object.hasOwn(sceneSources,name);
    if(isScene) {stopScene();sceneAudio=audio;sceneGain=Number.isFinite(relativeGain)?Math.max(0,Math.min(1,relativeGain)):1;}
    else {silence();active=audio;}
    audio.volume=volume*(isScene?sceneGain:1);
    const startedAt=sceneRevision;
    try {return {audio,started:Promise.resolve(audio.play?.()).then(()=>{
      // A delayed play request may settle after navigation has already stopped it.
      // Do not pause a newer valid play that reuses this same audio element.
      if(isScene && startedAt!==sceneRevision) {
        if(sceneAudio!==audio)audio.pause?.();
        return false;
      }
      return true;
    },()=>false)};} catch {return null;}
  }
  function syncScene(record,index,page,screen) {
    window.RustedPrayerAmbience?.sync(record,index,screen,page);
    if(screen!=='story-screen') {stopScene();return;}
    const visit=`${record?.id}:${index}:${page}`;
    if(sceneVisit===visit)return;
    const cue=window.RustedPrayerMediaManifest?.sfx?.records?.[record?.id]?.find(cue=>cue.at===index && cue.page===page);
    if(!cue && sceneRange && sceneAudio && sceneRange.recordId===record?.id && page===sceneRange.page && index>sceneRange.index && index<=sceneRange.through) {
      sceneRange.index=index;sceneVisit=visit;return;
    }
    stopScene();
    sceneVisit=visit;
    if(cue) {
      const started=play(cue.sound,cue.gain??1);
      if(started && Number.isInteger(cue.through) && cue.through>index)sceneRange={recordId:record.id,index,page,through:cue.through};
    }
  }
  function beginLoad(completion='out-02') {
    if(load)abortLoad(load);
    stopScene();sceneVisit=null;
    window.RustedPrayerAmbience?.setLoading(true);
    const token={audible:unlocked,completion:completion==='in-02' ? 'in-02' : 'out-02'};
    load=token;play('in-01');return token;
  }
  function finishLoad(token,{signal}={}) {
    if(!token || load!==token || signal?.aborted)return;
    load=null;
    window.RustedPrayerAmbience?.setLoading(false,false);
    if(token.audible)play(token.completion);
  }
  function abortLoad(token) {
    if(!token || load!==token)return;
    load=null;silence();window.RustedPrayerAmbience?.setLoading(false);
  }
  // Capture the meaning before a toggle changes, then let a loading sound
  // override the general button sound within the same user action.
  function deferSound(name) {
    if(!name)return;
    const before=revision;
    Promise.resolve().then(()=>{if(before===revision)play(name);});
  }
  function clickSound(target) {
    const button=target?.closest('button, summary');
    if(!button) {
      if(target===$('#profile-overlay') || target===$('#backlog') || target===$('#backlog-list') || target===$('#backlog-dismiss'))return 'cancel';
      if(target?.closest('#gallery-viewer') && !target.closest('#gallery-image, figcaption'))return 'cancel';
      return null;
    }
    if(button.disabled || button.getAttribute('aria-disabled')==='true' || button.closest('[inert]'))return null;
    const action=button.dataset.action;
    if(action==='show-settings')return 'settings';
    if(['back-archive','show-archive','exit-story','finish-record','return-ending','close-profile','close-gallery-image','cancel-reset','stop-transition','previous-line'].includes(action) || button.id==='loading-cancel')return 'cancel';
    if(action==='toggle-log')return $('#backlog').hidden ? 'select' : 'cancel';
    if(['toggle-archive-tools','toggle-story-menu'].includes(action))return button.getAttribute('aria-expanded')==='true' ? 'cancel' : 'select';
    if(button.closest('#story-options') && button.tagName==='SUMMARY')return $('#story-options').open ? 'cancel' : 'select';
    // Successful continuation has its own completion sound; retry starts a load.
    if(['loading-continue','loading-retry'].includes(button.id))return null;
    return 'select';
  }
  function save() {try {localStorage.setItem(key,JSON.stringify({muted,volume}));} catch {}}
  function controls() {
    window.RustedPrayerAmbience?.configure(volume,muted,unlocked);
    if($('#sfx-enabled'))$('#sfx-enabled').value=muted ? 'off' : 'on';
    if($('#sfx-volume'))$('#sfx-volume').value=String(Math.round(volume*100));
    if($('#sfx-volume-value') && document.activeElement!==$('#sfx-volume-value'))$('#sfx-volume-value').value=String(Math.round(volume*100));
  }
  function setMuted(value) {muted=Boolean(value);if(muted){silence();stopScene();}save();controls();}
  function setVolume(value) {volume=Math.max(0,Math.min(1,Number(value)||0));if(active)active.volume=volume;if(sceneAudio)sceneAudio.volume=volume*sceneGain;save();controls();}
  function unlock(event) {if(event.isTrusted===true && !unlocked){unlocked=true;window.RustedPrayerAmbience?.configure(volume,muted,unlocked);}}
  document.addEventListener('pointerdown',unlock,true);
  document.addEventListener('keydown',event=>{
    unlock(event);
    if(event.code!=='Escape' || event.repeat)return;
    Promise.resolve().then(()=>{if(event.defaultPrevented)play('cancel');});
  },true);
  document.addEventListener('click',event=>{unlock(event);deferSound(clickSound(event.target));},true);
  document.addEventListener('change',event=>{
    const target=event.target;
    if(target?.closest('#settings-screen, #reset-screen') && target.matches('select, input[type="range"], input[type="number"], input[type="checkbox"], input[type="file"]'))deferSound('select');
  },true);
  $('#sfx-enabled')?.addEventListener('change',event=>setMuted(event.target.value==='off'));
  $('#sfx-volume')?.addEventListener('input',event=>setVolume(Number(event.target.value)/100));
  const volumeInput=$('#sfx-volume-value');
  function readVolumeInput(commit=false) {
    const raw=volumeInput.value.trim(),value=Number(raw);
    if(raw!=='' && Number.isFinite(value))setVolume(Math.round(value)/100);
    if(commit)volumeInput.value=String(Math.round(volume*100));
  }
  volumeInput?.addEventListener('input',()=>readVolumeInput());
  volumeInput?.addEventListener('change',()=>readVolumeInput(true));
  volumeInput?.addEventListener('blur',()=>readVolumeInput(true));
  volumeInput?.addEventListener('keydown',event=>{if(event.key==='Enter' || ['Enter','NumpadEnter'].includes(event.code)){event.preventDefault();readVolumeInput(true);}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){abortLoad(load);silence();stopScene();}});
  window.addEventListener('pagehide',()=>{abortLoad(load);silence();stopScene();});
  controls();
  window.RustedPrayerSfx={play,beginLoad,finishLoad,abortLoad,syncScene,setMuted,setVolume};
})();
