(function () {
  "use strict";
  const key = mark => JSON.stringify([mark.recordId,mark.sceneId || mark.index]);
  function create(records,legacy) {
    const locations=new Map();
    for(const record of records) {
      (record.reportSections || record.story).forEach((line,index)=>{
        if(typeof line.sceneId!=='string' || !/^[a-z0-9-]+$/.test(line.sceneId) || locations.has(line.sceneId))
          throw Error(`장면 ID 누락 또는 중복: ${record.id} / ${index+1}`);
        locations.set(line.sceneId,{recordId:record.id,index,line});
      });
    }
    const redirects=legacy.redirects || {};
    function destination(sceneId) {
      const visited=new Set();
      while(Object.hasOwn(redirects,sceneId)) {
        if(visited.has(sceneId))throw Error('장면 ID 연결이 순환합니다: '+sceneId);
        visited.add(sceneId);
        sceneId=redirects[sceneId];
        if(sceneId===null)return null;
      }
      return sceneId;
    }
    for(const id of Object.keys(redirects)) {
      if(locations.has(id))throw Error('현재 장면 ID를 다른 장면으로 연결할 수 없습니다: '+id);
      const target=destination(id);
      if(target!==null && !locations.has(target))throw Error('연결할 장면이 없습니다: '+id);
    }
    function locate(recordId,sceneId) {
      const target=destination(sceneId),location=locations.get(target);
      // Redirects may explicitly move a scene to another record.
      return location && (location.recordId===recordId || target!==sceneId) ? location : null;
    }
    function legacyId(recordId,index) {
      return Number.isInteger(index) && index>=0 && index<(legacy.counts[recordId] ?? 0)
        ? `${recordId.toLowerCase()}-scene-${String(index+1).padStart(4,'0')}` : null;
    }
    function resolve(mark) {
      if(!mark || typeof mark.recordId!=='string')return null;
      let sceneId=mark.sceneId;
      if(!sceneId) {
        if(mark.status==='unresolved' || !legacyId(mark.recordId,mark.index))
          return {...mark,status:'unresolved'};
        sceneId=legacyId(mark.recordId,mark.index);
      }
      const location=locate(mark.recordId,sceneId);
      if(!location)return {...mark,sceneId,status:'missing'};
      return {recordId:location.recordId,sceneId:location.line.sceneId,index:location.index,text:location.line.text || ''};
    }
    function normalize(marks) {
      const unique=new Map();
      for(const mark of marks || []) {
        const resolved=resolve(mark);
        if(resolved)unique.set(key(resolved),resolved);
      }
      return [...unique.values()].slice(0,2000);
    }
    return {locate,resolve,normalize,key,legacyId,size:locations.size};
  }
  window.RustedPrayerBookmarks={create,key};
})();
