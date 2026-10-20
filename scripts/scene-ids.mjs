import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
const root=new URL('../',import.meta.url),records=[];
for(const name of fs.readdirSync(new URL('js/data/records/',root)).filter(n=>n.endsWith('.js'))){
  const path=new URL('js/data/records/'+name,root),source=fs.readFileSync(path,'utf8');
  const start=source.indexOf('registerRecord(')+15;
  const record=JSON.parse(source.slice(start,source.lastIndexOf(');')));
  let changed=false;
  for(const line of record.reportSections || record.story){
    if(line.sceneId || !process.argv.includes('--assign'))continue;
    line.sceneId=record.id.toLowerCase()+'-scene-'+randomUUID();changed=true;
  }
  if(changed)fs.writeFileSync(path,source.slice(0,start)+JSON.stringify(record,null,2)+');\n');
  records.push(record);
}
const context=vm.createContext({window:{}});
for(const file of ['js/core/bookmarks.js','js/data/bookmark-legacy.js'])
  vm.runInContext(fs.readFileSync(new URL(file,root),'utf8'),context);
const catalog=context.window.RustedPrayerBookmarks.create(records,context.window.RustedPrayerBookmarkLegacy);
console.log(`${records.length} records, ${catalog.size} unique scene IDs`);
