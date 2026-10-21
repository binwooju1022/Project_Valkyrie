(function () {
  'use strict';
  const base = new URL('../../', document.currentScript.src);
  const cache = new Map();
  const maxCacheBytes=96*1024*1024, maxCacheEntries=24;
  let cacheBytes=0,evictions=0;
  function remember(key,element,type) {
    const bytes=type==='image' ? Math.max(1,(element.naturalWidth || 1)*(element.naturalHeight || 1)*4) : 1024*1024;
    if(cache.has(key)){cacheBytes-=cache.get(key).bytes;cache.delete(key);}
    // The live scene owns its own DOM image. Evict only our preload reference;
    // clearing its URL could cancel another consumer's decode or display.
    while(cache.size && (cache.size>=maxCacheEntries || cacheBytes+bytes>maxCacheBytes)) {
      const oldest=cache.keys().next().value;
      cacheBytes-=cache.get(oldest).bytes;cache.delete(oldest);evictions++;
    }
    if(bytes<=maxCacheBytes){cache.set(key,{element,bytes});cacheBytes+=bytes;}
  }
  const url = src => new URL(src, base).href;
  const aborted = () => new DOMException('Loading cancelled', 'AbortError');

  function assetsFor(record) {
    const manifest = window.RustedPrayerMediaManifest || {};
    const assets = [...(manifest.common || []), ...(record ? manifest.records?.[record.id] || [] : [])];
    if(record) {
      const aliases={'UNIT-01':'연화','UNIT-02':'유라','UNIT-03':'세린','UNIT-04':'가은','UNIT-05':'초희'};
      const speakers=new Set(record.story.map(line=>line.speaker).filter(Boolean));
      const addImage=src=>{if(typeof src==='string' && src) assets.push({type:'image',src});};
      const addShot=shot=>{
        if(typeof shot==='string') {addImage(shot); return;}
        if(!shot) return;
        addImage(shot.src); addImage(shot.backgroundSrc); addImage(shot.overlaySrc);addImage(shot.dronePanel);
        addImage(shot.scanPreview?.src);
        (shot.monitorView?.images || []).forEach(image=>addImage(image.src));
        (shot.pageImages || []).forEach(addImage);
        for(const person of shot.cast || []) {
          if(typeof person==='string') speakers.add(person);
          else {addImage(person.src); addImage(person.effectSrc); if(person.speaker || person.name) speakers.add(person.speaker || person.name);}
        }
      };
      if(manifest.cutscenes?.[record.id]) assets.push({type:'image',src:manifest.cutscenes[record.id]});
      addImage(manifest.backgrounds?.[record.id]);
      addShot(manifest.stages?.[record.id]);
      // CSS scenery must be ready with the record, before the HUD is revealed.
      if (manifest.stages?.[record.id]?.monitor || Object.values(manifest.scenes?.[record.id] || {}).some(shot=>shot?.monitor))
        addImage('./assets/ui/lab-hud-frame.svg');
      Object.values(manifest.scenes?.[record.id] || {}).forEach(addShot);
      Object.values(manifest.attachments?.[record.id] || {}).forEach(addImage);
      (manifest.comparisons?.[record.id] || []).forEach(addImage);
      record.story.forEach(line=>addShot(line.sceneArt));
      if(record.diskId==='A' && record.story.some(line=>line.tone==='chat'))Object.values(manifest.aProfiles || {}).forEach(config=>Object.values(config.photos).forEach(photo=>addImage(photo.src)));
      for(const speaker of speakers) addImage(manifest.standings?.[speaker] || manifest.standings?.[aliases[speaker]]);
    }
    const visuals = record ? [record.defaultVisual, ...record.story.map(line => line.visual)] : [];
    visuals.forEach(visual => { if (visual?.backgroundSrc) assets.push({type:'image',src:visual.backgroundSrc}); });
    record?.story.forEach(line => { if (line.cutscene?.src) assets.push({type:'image',src:line.cutscene.src}); });
    const unique = new Map();
    assets.forEach(asset => {
      if (asset?.src && ['image','audio'].includes(asset.type)) unique.set(asset.type + ':' + url(asset.src), asset);
    });
    return [...unique.values()];
  }

  function load(asset, signal) {
    const src = url(asset.src), key = asset.type + ':' + src;
    if (signal?.aborted) return Promise.reject(aborted());
    if (cache.has(key)) {
      const cached=cache.get(key);cache.delete(key);cache.set(key,cached);
      return Promise.resolve(cached.element);
    }
    return new Promise((resolve, reject) => {
      const element = asset.type === 'audio' ? new Audio() : new Image();
      const event = asset.type === 'audio' ? 'loadeddata' : 'load';
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        element.removeEventListener(event, ready);
        element.removeEventListener('error', fail);
        if (error) {
          element.removeAttribute('src');
          if (asset.type === 'audio') element.load();
          reject(error);
        } else { remember(key,element,asset.type); resolve(element); }
      };
      const ready = () => {
        if (asset.type === 'image' && element.decode) element.decode().then(() => finish(), () => finish(new Error('Image decode failed')));
        else finish();
      };
      const fail = () => finish(new Error('Asset unavailable: ' + asset.src));
      const cancel = () => finish(aborted());
      const timer = setTimeout(() => finish(new Error('Asset loading timed out: ' + asset.src)), 12000);
      element.addEventListener(event, ready);
      element.addEventListener('error', fail);
      signal?.addEventListener('abort', cancel, {once:true});
      if (asset.type === 'audio') element.preload = 'auto';
      element.src = src;
      if (asset.type === 'audio') element.load();
    });
  }

  async function preload(record, {signal, onProgress = () => {}} = {}) {
    const assets = assetsFor(record), failed = [];
    let cursor = 0, completed = 0;
    onProgress({completed,total:assets.length,failed:0});
    const worker = async () => {
      while (cursor < assets.length) {
        if (signal?.aborted) throw aborted();
        const asset = assets[cursor++];
        try { await load(asset, signal); }
        catch (error) { if (error.name === 'AbortError') throw error; failed.push(asset); }
        completed += 1;
        onProgress({completed,total:assets.length,failed:failed.length});
      }
    };
    await Promise.all(Array.from({length:Math.min(3,assets.length)}, worker));
    if (signal?.aborted) throw aborted();
    return {assets,failed};
  }
  const cacheStats=()=>({entries:cache.size,estimatedBytes:cacheBytes,maxEntries:maxCacheEntries,maxBytes:maxCacheBytes,evictions});
  window.RustedPrayerMedia = {url, assetsFor, preload,cacheStats};
})();
