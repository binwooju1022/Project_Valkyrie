(function () {
  'use strict';
  const audio=new Audio();
  audio.loop=true;
  audio.preload='metadata';
  const key='rusted-prayer-bgm-settings';
  let volume=.35,muted=false;
  try {
    const saved=JSON.parse(localStorage.getItem(key) || '{}');
    if(typeof saved.volume==='number' && Number.isFinite(saved.volume))volume=Math.max(0,Math.min(1,saved.volume));
    if(typeof saved.muted==='boolean')muted=saved.muted;
  } catch {}
  let location={record:null,index:0,screen:'boot-screen'};
  let endingPhotoSeen=false,postEndingBgm='waiting-commander';
  let settingsTrack=null,settingsUsesMain=false;
  let selected=null,unlocked=false,blocked=false,pending=false,revision=0;
  const FADE_IN_MS=800,FADE_OUT_MS=500;
  let gain=0,fadeTimer=null,fadeRevision=0,phase=null;
  const now=()=>typeof performance!=='undefined' ? performance.now() : Date.now();
  const $=selector=>document.querySelector(selector);
  const pause=()=>audio.pause?.();
  function resolve(record,index) {
    if(!record)return null;
    const manifest=window.RustedPrayerMediaManifest.bgm;
    const plan=manifest?.records[record.id];
    if(!plan)return null;
    let track=plan.track;
    for(const cue of plan.cues || [])if(cue.at<=index)track=cue.track;
    return track ? {id:track,...manifest.tracks[track]} : null;
  }
  function updateControls() {
    for(const button of document.querySelectorAll('[data-bgm-toggle]')) {
      button.textContent=muted ? '♫ BGM 꺼짐' : '♫ BGM 켜짐';
      button.setAttribute('aria-pressed',String(!muted));
      button.setAttribute('aria-label',muted ? 'BGM 켜기' : 'BGM 음소거');
    }
    if($('#bgm-enabled'))$('#bgm-enabled').value=muted ? 'off' : 'on';
    if($('#bgm-volume'))$('#bgm-volume').value=String(Math.round(volume*100));
    if($('#bgm-volume-value') && document.activeElement!==$('#bgm-volume-value'))$('#bgm-volume-value').value=String(Math.round(volume*100));
    if($('#bgm-note'))$('#bgm-note').textContent=blocked ? '음악이 재생되지 않았습니다. 배경음악을 다시 켜면 재시도할 수 있습니다.' : '보관소에서는 메인 음악, 기록에서는 해당 음악을 재생하며 설정에서도 이어집니다.';
  }
  function save() {
    try {localStorage.setItem(key,JSON.stringify({volume,muted}));} catch {}
  }
  function cancelFade() {
    clearTimeout(fadeTimer);fadeTimer=null;fadeRevision++;phase=null;
  }
  function setGain(value) {gain=value;audio.volume=Math.max(0,Math.min(1,volume*gain));}
  function fadeTo(target,duration,done=()=>{}) {
    cancelFade();
    phase=target===0 ? 'out' : 'in';
    const token=fadeRevision,from=gain,start=now();
    const tick=()=>{
      if(token!==fadeRevision)return;
      const progress=Math.min(1,Math.max(0,(now()-start)/duration));
      const eased=progress*progress*(3-2*progress);
      setGain(from+(target-from)*eased);
      if(progress>=1) {fadeTimer=null;phase=null;done();}
      else fadeTimer=setTimeout(tick,16);
    };
    tick();
  }
  function stop() {
    cancelFade();pause();setGain(0);revision++;pending=false;
    if(selected) {try {audio.currentTime=0;} catch {}}
    selected=null;
  }
  function suspend() {
    cancelFade();pause();setGain(0);revision++;pending=false;
  }
  function desired() {
    const {record,index,screen}=location;
    if(screen==='settings-screen')return settingsTrack;
    const active=screen==='story-screen' || screen==='objective-screen' && record?.readerMode==='report';
    if(active)return resolve(record,index);
    // Completion resets the reading cursor to zero, but music still belongs
    // to the last scene until the reader actually leaves this record.
    if(['complete-screen','transition-screen'].includes(screen))return resolve(record,Math.max(0,(record?.story.length || 0)-1));
    // Keep a shared song through the next record's introduction.
    if(screen==='objective-screen' && window.RustedPrayerMediaManifest.bgm?.records[record?.id]?.continueOnIntro) {
      const next=resolve(record,0);
      if(next && selected?.id===next.id)return next;
    }
    if(screen==='ending-screen') {
      const manifest=window.RustedPrayerMediaManifest.bgm,track=manifest?.ending;
      return track ? {id:track,...manifest.tracks[track]} : null;
    }
    if(!['boot-screen','archive-screen','objective-screen','library-screen','gallery-screen','reset-screen'].includes(screen))return null;
    const manifest=window.RustedPrayerMediaManifest.bgm;
    const track=endingPhotoSeen ? postEndingBgm : manifest?.main;
    return track ? {id:track,...manifest.tracks[track]} : null;
  }
  function suspended() {
    return document.hidden || muted || volume===0;
  }
  function fadeIn() {
    if(phase!=='in' && gain<1)fadeTo(1,FADE_IN_MS);
  }
  function apply() {
    setGain(gain);audio.muted=muted;
    if(suspended()) {suspend();return;}
    const next=desired();
    if(selected?.id!==next?.id) {
      // Re-read the latest location when fading ends; rapid input never queues old tracks.
      if(selected && !audio.paused && gain>0) {
        if(phase!=='out')fadeTo(0,FADE_OUT_MS,()=>{stop();apply();});
        return;
      }
      stop();
      if(!next)return;
      selected=next;blocked=false;
      audio.src=window.RustedPrayerMedia.url(next.src);
    }
    if(!next)return;
    if(phase==='out')cancelFade();
    if(!unlocked) {pause();return;}
    if(!audio.paused) {fadeIn();return;}
    if(pending || typeof audio.play!=='function')return;
    const token=revision;
    pending=true;
    try {
      Promise.resolve(audio.play()).then(()=>{
        if(token===revision) {
          blocked=false;updateControls();
          if(!suspended() && desired()?.id===selected?.id)fadeIn();
          else apply();
        }
      },()=>{if(token===revision){blocked=true;updateControls();}}).finally(()=>{if(token===revision)pending=false;});
    } catch {pending=false;blocked=true;updateControls();}
  }
  function usesMainTrack({record,screen}) {
    if(['boot-screen','archive-screen','library-screen','gallery-screen','reset-screen'].includes(screen))return true;
    if(screen!=='objective-screen' || record?.readerMode==='report')return false;
    const plan=window.RustedPrayerMediaManifest.bgm?.records[record?.id];
    return !(plan?.continueOnIntro && selected?.id===resolve(record,0)?.id);
  }
  function sync(record,index,screen) {
    // Settings keeps the music of its origin screen; only the archive theme is selectable.
    if(screen==='settings-screen' && location.screen!=='settings-screen') {
      settingsTrack=desired();
      settingsUsesMain=usesMainTrack(location);
    }
    location={record,index,screen};apply();
  }
  function setMuted(value) {muted=Boolean(value);save();updateControls();apply();}
  function setVolume(value) {volume=Math.max(0,Math.min(1,Number(value)||0));save();updateControls();apply();}
  function unlock(event) {
    if(event.isTrusted!==true)return;
    if(!unlocked || blocked) {unlocked=true;apply();}
  }
  document.addEventListener('pointerdown',unlock,true);
  document.addEventListener('keydown',unlock,true);
  document.addEventListener('visibilitychange',apply);
  window.addEventListener('pagehide',suspend);
  window.addEventListener('pageshow',apply);
  audio.addEventListener('error',()=>{suspend();blocked=true;updateControls();});
  for(const button of document.querySelectorAll('[data-bgm-toggle]'))button.addEventListener('click',()=>{unlocked=true;setMuted(!muted);});
  $('#bgm-enabled')?.addEventListener('change',event=>{unlocked=true;setMuted(event.target.value==='off');});
  $('#bgm-volume')?.addEventListener('input',event=>{unlocked=true;setVolume(Number(event.target.value)/100);});
  const volumeInput=$('#bgm-volume-value');
  function readVolumeInput(commit=false) {
    const raw=volumeInput.value.trim(),value=Number(raw);
    if(raw!=='' && Number.isFinite(value)) {unlocked=true;setVolume(Math.round(value)/100);}
    if(commit)volumeInput.value=String(Math.round(volume*100));
  }
  volumeInput?.addEventListener('input',()=>readVolumeInput());
  volumeInput?.addEventListener('change',()=>readVolumeInput(true));
  volumeInput?.addEventListener('blur',()=>readVolumeInput(true));
  volumeInput?.addEventListener('keydown',event=>{if(event.key==='Enter' || ['Enter','NumpadEnter'].includes(event.code)){event.preventDefault();readVolumeInput(true);}});
  updateControls();
  function setEndingPhotoSeen(value,track=postEndingBgm) {
    endingPhotoSeen=value===true;
    postEndingBgm=['waiting-commander','side-story'].includes(track) ? track : 'waiting-commander';
    apply();
  }
  function setPostEndingBgm(track) {
    if(!endingPhotoSeen || !['waiting-commander','side-story'].includes(track))return;
    postEndingBgm=track;
    if(location.screen==='settings-screen' && settingsUsesMain) {
      const manifest=window.RustedPrayerMediaManifest.bgm;
      settingsTrack={id:track,...manifest.tracks[track]};
    }
    apply();
  }
  window.RustedPrayerBgm={sync,resolve,setMuted,setVolume,setEndingPhotoSeen,setPostEndingBgm};
})();
