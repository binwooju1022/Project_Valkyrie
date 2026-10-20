(function () {
  'use strict';
  // Removed zero-based positions in the frozen v24 narrative layout.
  const removed={'C-04':[2,87],'B-07':[151]};
  const position=(id,index)=>Number.isInteger(index)?index-(removed[id] || []).filter(at=>at<=index).length:index;
  function progress(saved,version=saved.narrationLayoutVersion) {
    if(version===1){saved.narrationLayoutVersion=1;return saved;}
    for(const id of Object.keys(removed)) {
      const entry=saved.records?.[id];if(!entry)continue;
      for(const field of ['lineIndex','seenIndex'])if(Number.isInteger(entry[field]))entry[field]=position(id,entry[field]);
      if(entry.seenPages) {
        const pages={};
        for(const [index,page] of Object.entries(entry.seenPages)) {
          const at=position(id,Number(index));pages[at]=Math.max(pages[at]??-1,page);
        }
        entry.seenPages=pages;
      }
    }
    saved.narrationLayoutVersion=1;
    return saved;
  }
  function path(raw) {
    const parts=JSON.parse(raw);
    if(parts[0]==='records' && parts[2]==='seenPages')parts[3]=String(position(parts[1],Number(parts[3])));
    return JSON.stringify(parts);
  }
  function sync(meta) {
    if(!meta)return meta;
    const fields={};
    for(const [key,stamp] of Object.entries(meta.fields || {})) {
      const target=path(key),previous=fields[target];
      if(!previous || stamp[0]>previous[0] || stamp[0]===previous[0] && stamp[1]>previous[1])fields[target]=stamp;
    }
    return {...meta,fields};
  }
  function change(change,normalize) {
    if(change.narrationLayoutVersion===1)return change;
    if(change.reset)return {...change,reset:normalize(change.reset),narrationLayoutVersion:1};
    const fields={};
    for(const [key,value] of Object.entries(change.fields || {})) {
      const parts=JSON.parse(key),target=path(key);
      let next=value;
      if(parts[0]==='records' && parts[2]==='cursor' && value)next={...value,lineIndex:position(parts[1],value.lineIndex)};
      if(parts[0]==='records' && parts[2]==='seenIndex')next=position(parts[1],value);
      if(parts[0]==='records' && parts[2]==='seenPages')next=Math.max(fields[target]??-1,value??-1);
      fields[target]=next;
    }
    return {...change,fields,narrationLayoutVersion:1};
  }
  window.RustedPrayerSceneLayout={position,progress,sync,change};
})();
