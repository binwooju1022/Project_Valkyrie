(function () {
  "use strict";

  // Each change is durable before returning to the reader. Web Locks only compact
  // the journal; closing a tab before its lock runs cannot discard its changes.
  function create({storage, key, locks, normalize, onError}) {
    const prefix = key + ":change:";
    const clone = value => JSON.parse(JSON.stringify(value));
    const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
    const compare = (a=[0,""],b=[0,""]) => a[0]-b[0] || a[1].localeCompare(b[1]);
    const generation = value => value.resetGeneration || 0;
    let baseline = null, epoch = "", compacting = null;

    function fields(value) {
      const result = {};
      for (const [name,item] of Object.entries(value)) {
        if (["records","bookmarks","_sync","resetGeneration"].includes(name)) continue;
        result[JSON.stringify([name])] = item;
      }
      for (const [id,record] of Object.entries(value.records || {})) {
        // A cursor is one value: line and subpage must never come from different tabs.
        result[JSON.stringify(["records",id,"cursor"])] = {
          lineIndex:record.lineIndex || 0, telemetryPage:record.telemetryPage || 0
        };
        for (const [name,item] of Object.entries(record)) {
          if (["lineIndex","telemetryPage"].includes(name)) continue;
          if (name === "seenPages") {
            for (const [page,seen] of Object.entries(item || {}))
              result[JSON.stringify(["records",id,name,page])] = seen;
          } else result[JSON.stringify(["records",id,name])] = item;
        }
      }
      for (const mark of value.bookmarks || [])
        result[JSON.stringify(["bookmarks",mark.recordId,mark.index])] = mark;
      return result;
    }

    function apply(snapshot, change) {
      const meta = snapshot._sync;
      if (change.reset) {
        if (generation(change) < generation(snapshot) ||
            (generation(change) === generation(snapshot) &&
             compare(change.stamp,meta.reset) <= 0)) return snapshot;
        snapshot = clone(change.reset);
        snapshot._sync = {clock:change.stamp[0],epoch:change.id,reset:change.stamp,fields:{}};
        return snapshot;
      }
      if (generation(change) !== generation(snapshot) || change.epoch !== meta.epoch) return snapshot;
      meta.clock = Math.max(meta.clock,change.stamp[0]);
      for (const [path,value] of Object.entries(change.fields)) {
        const parts = JSON.parse(path), name = parts[2] || parts[0];
        const previousStamp = meta.fields[path];
        const monotone = ["completed","seenIndex","seenPages","profileViews","readingSetupSeen","aIdentificationIntroSeen"].includes(name);
        if (!monotone && compare(change.stamp,previousStamp) <= 0) continue;
        if (parts[0] === "bookmarks") {
          snapshot.bookmarks = (snapshot.bookmarks || []).filter(mark => mark.recordId !== parts[1] || mark.index !== parts[2]);
          if (value !== null) snapshot.bookmarks.push(value);
        } else {
          let target = snapshot;
          for (const part of parts.slice(0,-1)) target = target[part] ||= {};
          const field = parts.at(-1);
          if (name === "cursor") Object.assign(target,value);
          else if (["completed","readingSetupSeen","aIdentificationIntroSeen"].includes(name)) target[field] ||= value === true;
          else if (["seenIndex","seenPages"].includes(name)) target[field] = Math.max(target[field] ?? -1,value ?? -1);
          else if (name === "profileViews") target[field] = [...new Set([...(target[field] || []),...(value || [])])];
          else if (value === null) delete target[field];
          else target[field] = value;
        }
        // Tombstones retain their stamp so a stale addition cannot revive a deletion.
        if (compare(change.stamp,previousStamp) > 0) meta.fields[path] = change.stamp;
      }
      return snapshot;
    }

    function readBatch() {
      // Compaction may occur in another process between getItem and enumeration.
      // Retry if its checkpoint changed so removed journal entries are not missed.
      for (;;) {
        const raw = storage.getItem(key);
        const entries = [];
        for (let i=0;i<storage.length;i++) {
          const name = storage.key(i);
          if (name?.startsWith(prefix)) {
            const value = storage.getItem(name);
            if (value) entries.push([name,JSON.parse(value)]);
          }
        }
        if (storage.getItem(key) !== raw) continue;
        let snapshot;
        try { snapshot = JSON.parse(raw || "{}"); } catch { snapshot = {}; }
        if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) snapshot = {};
        if (!snapshot._sync) {
          snapshot = normalize(snapshot);
          snapshot._sync = {clock:0,epoch:"",reset:[0,""],fields:{}};
        }
        entries.sort((a,b)=>compare(a[1].stamp,b[1].stamp));
        for (const [,change] of entries) snapshot = apply(snapshot,change);
        return {snapshot,entries};
      }
    }

    function compact() {
      // Without Web Locks retain the journal rather than use an unsafe mutex.
      if (!locks || compacting) return compacting;
      compacting = locks.request(key,()=>{
        const {snapshot,entries} = readBatch();
        if (entries.length) {
          storage.setItem(key,JSON.stringify(snapshot));
          for (const [name] of entries) storage.removeItem(name);
        }
      }).catch(onError).finally(()=>{compacting=null;});
      return compacting;
    }

    function adopt(snapshot) {
      baseline = clone(snapshot);
      epoch = snapshot._sync?.epoch || "";
      return clone(snapshot);
    }

    function save(current, reset=false, forceFields=[]) {
      const latest = readBatch().snapshot;
      if (!reset && (generation(current) !== generation(latest) || epoch !== latest._sync.epoch))
        return {value:adopt(latest),reset:true};
      const nextFields = fields(current), oldFields = fields(baseline || current), delta = {};
      for (const path of new Set([...Object.keys(oldFields),...Object.keys(nextFields)])) {
        const forced = forceFields.includes(path);
        if (!forced && equal(oldFields[path],nextFields[path])) continue;
        const parts = JSON.parse(path);
        // Rendering the archive lazily creates empty record objects. That is
        // not a user's request to move an independently active reader to line 0.
        if (!forced && parts[0] === "records" && parts[2] === "cursor" && oldFields[path] === undefined &&
            equal(nextFields[path],{lineIndex:0,telemetryPage:0}) && !current.records[parts[1]].updatedAt) continue;
        delta[path] = nextFields[path] ?? null;
      }
      if (reset || Object.keys(delta).length) {
        const id = crypto.randomUUID(), stamp = [latest._sync.clock+1,id];
        const change = {id,stamp,epoch,resetGeneration:generation(latest),fields:delta};
        if (reset) {
          change.resetGeneration += 1;
          change.reset = {...clone(current),resetGeneration:change.resetGeneration};
          delete change.reset._sync;
        }
        storage.setItem(prefix+id,JSON.stringify(change));
      }
      const value = adopt(readBatch().snapshot);
      compact();
      return {value,reset:false};
    }

    return {
      read:()=>readBatch().snapshot,
      adopt,
      save,
      compact,
      isStorageKey:name=>name === key || name?.startsWith(prefix),
      get epoch(){return epoch;},
    };
  }
  window.RustedPrayerProgressStore = {create};
})();
