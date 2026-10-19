(function () {
  'use strict';
  let volume=.6,muted=false,unlocked=false,loading=false;
  let location={record:null,index:0,screen:'boot-screen'};
  const layers=new Map();
  const now=()=>typeof performance!=='undefined' ? performance.now() : Date.now();
  function resolve(record,index,page=0) {
    const plan=window.RustedPrayerMediaManifest?.sfx?.ambience;
    return (plan?.records?.[record?.id] || []).filter(layer=>layer.from<=index && index<layer.to &&
      (!layer.until || index<layer.until.at || index===layer.until.at && page<layer.until.page)).map(layer=>{
      let gain=layer.gain;
      for(const level of layer.levels || [])if(level.at<=index)gain=level.gain;
      return {...layer,key:(layer.group || record.id)+':'+layer.id,src:plan.sources[layer.sound],gain};
    });
  }
  function plans() {
    const resolved=resolve(location.record,location.index,location.page);
    return location.screen==='transition-screen' ? resolved.filter(layer=>layer.continuous) : resolved;
  }
  function audible() {
    return unlocked && !muted && volume>0 && !document.hidden &&
      (location.screen==='story-screen' && !loading || location.screen==='transition-screen');
  }
  function level(layer,gain) {layer.gain=gain;layer.audio.volume=Math.max(0,Math.min(1,volume*gain));}
  function cancelFade(layer) {clearTimeout(layer.timer);layer.timer=null;layer.fadeRevision++;layer.target=null;}
  function pause(layer) {cancelFade(layer);layer.revision++;layer.pending=false;layer.audio.pause?.();level(layer,0);}
  function remove(layer) {pause(layer);try{layer.audio.currentTime=0;}catch{}layers.delete(layer.key);}
  function fade(layer,target,duration,done=()=>{}) {
    if(layer.target===target)return;
    cancelFade(layer);layer.target=target;
    if(duration<=0) {level(layer,target);layer.target=null;done();return;}
    const revision=layer.fadeRevision,from=layer.gain,start=now();
    const tick=()=>{
      if(layer.fadeRevision!==revision)return;
      const progress=Math.min(1,Math.max(0,(now()-start)/Math.max(1,duration)));
      level(layer,from+(target-from)*progress);
      if(progress>=1) {layer.timer=null;layer.target=null;done();}
      else layer.timer=setTimeout(tick,16);
    };
    tick();
  }
  function create(plan) {
    const audio=new Audio();audio.loop=true;audio.preload='metadata';audio.src=window.RustedPrayerMedia.url(plan.src);
    const layer={...plan,audio,gain:0,target:null,fadeRevision:0,revision:0,pending:false,failed:false};
    level(layer,0);
    if(plan.offset) {
      const offset=()=>{try{if(Number.isFinite(audio.duration) && audio.duration>plan.offset)audio.currentTime=plan.offset;}catch{}};
      audio.addEventListener?.('loadedmetadata',offset,{once:true});offset();
    }
    audio.addEventListener?.('error',()=>{pause(layer);layer.failed=true;});
    layers.set(plan.key,layer);return layer;
  }
  function apply() {
    if(!audible()) {for(const layer of layers.values())pause(layer);return;}
    const wanted=new Map(plans().map(plan=>[plan.key,plan]));
    for(const layer of layers.values())if(!wanted.has(layer.key)) {
      if(location.screen==='transition-screen')pause(layer);
      else if(layer.gain>0 && !layer.audio.paused)fade(layer,0,layer.fadeOut,()=>remove(layer));
      else remove(layer);
    }
    for(const plan of wanted.values()) {
      const layer=layers.get(plan.key) || create(plan);layer.desiredGain=plan.gain;
      // A shared clip can cross records whose entrance/exit timings differ.
      layer.fadeIn=plan.fadeIn;layer.fadeOut=plan.fadeOut;
      layer.audio.volume=volume*layer.gain;
      if(layer.failed || layer.pending || typeof layer.audio.play!=='function')continue;
      if(!layer.audio.paused) {
        if(layer.gain!==plan.gain)fade(layer,plan.gain,plan.fadeIn);
        else cancelFade(layer);
        continue;
      }
      cancelFade(layer);layer.pending=true;
      const revision=++layer.revision;
      try {
        Promise.resolve(layer.audio.play()).then(()=>{
          if(revision!==layer.revision || layers.get(layer.key)!==layer)return;
          layer.pending=false;
          if(audible() && plans().some(plan=>plan.key===layer.key))fade(layer,layer.desiredGain,layer.fadeIn);
          else pause(layer);
        },()=>{if(revision===layer.revision){pause(layer);layer.failed=true;}});
      } catch {pause(layer);layer.failed=true;}
    }
  }
  function sync(record,index,screen,page=0) {
    // Completion resets the cursor; continuous ambience belongs to the final scene.
    if(screen==='transition-screen')index=Math.max(0,(record?.story?.length || index+1)-1);
    location={record,index,screen,page};apply();
  }
  function configure(nextVolume,nextMuted,nextUnlocked) {volume=nextVolume;muted=nextMuted;unlocked=nextUnlocked;apply();}
  function setLoading(value,refresh=true) {loading=value;if(refresh)apply();}
  document.addEventListener('visibilitychange',apply);
  window.addEventListener('pagehide',()=>{for(const layer of layers.values())pause(layer);});
  window.addEventListener('pageshow',apply);
  window.RustedPrayerAmbience={sync,resolve,configure,setLoading};
})();
