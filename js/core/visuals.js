(function () {
  'use strict';
  const aliases = {'UNIT-01':'연화','UNIT-02':'유라','UNIT-03':'세린','UNIT-04':'가은','UNIT-05':'초희'};
  const name = speaker => aliases[speaker] || speaker;
  const actor = speaker => /^(연화|유라|세린|가은|초희|연구원 [AB]|담당자|UNIT-0[1-5])$/.test(speaker || '');
  const number = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.min(max,Math.max(min,Number(value))) : fallback;
  function imageAlt(record,index,src) {
    const manifest=window.RustedPrayerMediaManifest || {};
    const sources=[];
    const add=value=>{if(value && !sources.includes(value)) sources.push(value);};
    add(manifest.cutscenes?.[record.id]);
    record.story.forEach((line,i)=>{
      const entry=manifest.scenes?.[record.id]?.[i];
      add(typeof entry==='string' ? entry : entry?.mode!=='stage' ? entry?.src : null);
      add(line.cutscene?.src || line.sceneArt?.src);
    });
    const base=record.id.toLowerCase();
    if(src && sources.length>1 && sources.includes(src)) return `${base}-${String(sources.indexOf(src)+1).padStart(2,'0')} 이미지`;
    const line=record.story[index] || {};
    return line.cutscene?.alt || line.sceneArt?.alt || base+' 이미지';
  }
  function resolve(record, index, visual = record.defaultVisual, page = 0) {
    const manifest = window.RustedPrayerMediaManifest || {};
    const line = record.story[index] || {};
    const entry = manifest.scenes?.[record.id]?.[index];
    const shot = typeof entry === 'string' ? {mode:'cutscene',src:entry} : entry || {};
    const defaults = manifest.stages?.[record.id] || {};
    const spec = {...defaults, ...line.sceneArt, ...shot};
    const sky = visual?.atmosphere === 'sky';
    const explicitCutscene = shot.pageImages?.[Math.min(page,shot.pageImages.length-1)] || shot.src || line.cutscene?.src || line.sceneArt?.src || (!sky && manifest.cutscenes?.[record.id]);
    const mode = spec.mode || (explicitCutscene || ['memory','cutscene'].includes(line.tone) ? 'cutscene' : 'stage');
    const src = mode === 'stage' ? shot.backgroundSrc || shot.src || visual?.backgroundSrc || (!sky && (spec.backgroundSrc || manifest.backgrounds?.[record.id])) : explicitCutscene;
    let cast = spec.cast;
    if (!Array.isArray(cast)) {
      cast = [];
      // Retain people already speaking in this scene, without previewing future arrivals.
      let start=index;
      while (start>0 && ['dialogue','narration'].includes(record.story[start-1]?.tone)) start--;
      for (let i=start; i<=index; i++) {
        const previous=record.story[i];
        if (previous?.tone==='dialogue' && !previous.instrument && actor(previous.speaker)
          && !cast.some(person=>name(person)===name(previous.speaker))) cast.push(previous.speaker);
      }
    }
    const visible = !sky && mode==='stage' && (['dialogue','narration'].includes(line.tone) || spec.layout==='confrontation' && line.tone==='chat') && !line.instrument;
    const actors = visible ? cast.map((person,index)=> {
      const spec = typeof person==='string' ? {speaker:person} : person;
      const speaker=spec.speaker || spec.name || '';
      return {speaker,src:spec.src || manifest.standings?.[speaker] || manifest.standings?.[name(speaker)],
        active:!line.speaker || name(speaker)===name(line.speaker),
        x:number(spec.x,cast.length===1 ? 50 : 15+index*70/(cast.length-1),0,100),
        scale:number(spec.scale,1,.2,2),flip:spec.flip===true,entry:spec.entry,effectSrc:spec.effectSrc};
    }) : [];
    const focus = spec.focus || [55,45];
    const mediaFrame=image=>({src:image.src,label:image.label || '복구 자료',alt:image.alt || image.label || '복구 자료',
      fit:image.fit==='cover' ? 'cover' : 'contain',zoom:number(image.zoom,1,1,5),
      focus:[number(image.focus?.[0],50,0,100),number(image.focus?.[1],50,0,100)],duration:0});
    const monitor=visible && spec.layout==='lab' && spec.monitor===true;
    const monitorImages=spec.monitorView?.images?.filter(image=>typeof image.src==='string' && image.src).map(mediaFrame) || [];
    const monitorView=monitor && monitorImages.length ? {images:monitorImages,
      layout:['camera-memory','armor-comparison'].includes(spec.monitorView.layout) ? spec.monitorView.layout : 'single',
      active:number(spec.monitorView.active,0,0,monitorImages.length-1),damaged:spec.monitorView.damaged===true} : null;
    return {mode,src,layout:['lab','confrontation'].includes(spec.layout) ? spec.layout : '',monitor,monitorView,
      cameraEffect:spec.cameraEffect || '',dronePanel:spec.dronePanel,
      faceCamera:spec.faceCamera,cameraPath:spec.cameraPath,stageCamera:spec.stageCamera,identities:spec.identities || [],
      authoredCamera:spec.pageCamera?.[page] || spec.authoredCamera,cameraReturn:spec.cameraReturn===true,
      cameraContinuity:spec.cameraContinuity===true,cameraDuration:spec.cameraDuration,
      particleGather:spec.particleGather===true && page===0,
      treatment:spec.pageTreatments?.[page] || '',transition:spec.transition || '',
      flashReturn:spec.flashReturn,flashDuration:spec.flashDuration,
      scanPreview:spec.scanPreview?.src ? mediaFrame(spec.scanPreview) : null,
      swapEffect:spec.swapEffect===true,hideArt:spec.hideArt===true,presentation:spec.presentation==='analysis' ? 'analysis' : '',
      overlaySrc:spec.overlaySrc,alt:imageAlt(record,index,src),actors,inactive:spec.inactive==='exit' ? 'exit' : 'dim',
      zoom:number(spec.zoom,line.camera==='close' ? 1.12 : 1,1,4),
      focus:[number(focus[0],50,0,100),number(focus[1],50,0,100)],
      duration:number(spec.duration,1600,0,10000),fit:spec.fit==='contain' ? 'contain' : 'cover'};
  }
  window.RustedPrayerVisuals={resolve};
})();
