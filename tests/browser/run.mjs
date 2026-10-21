// Local-only instrumentation: production files never expose the audit helpers.
// Usage: node tests/browser/run.mjs music-ending playback-smoke
// Install Playwright and its Chromium, or set PLAYWRIGHT_CHROMIUM_EXECUTABLE.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
let playwright;
try {playwright=require('playwright');} catch {playwright=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'));}
const project=fileURLToPath(new URL('../../',import.meta.url));
const root=process.env.BROWSER_TEST_OUTPUT || path.join(project,'test-results');
await fs.mkdir(root,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav'};
const server=http.createServer(async(req,res)=>{
 try {
  const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1) || 'index.html';
  if(relative==='blank'){res.end('<!doctype html><title>Blank</title>');return;}
  const file=path.resolve(project,relative);
  if(!file.startsWith(project)){res.writeHead(403);res.end();return;}
  let data=await fs.readFile(file);
  if(relative==='js/app.js') {
   let text=data.toString();
   const names=[...new Set([...text.matchAll(/^  (?:async )?function (\w+)\(/gm)].map(m=>m[1]))];
   text=text.replace('  loadProgress();',`  window.__audit={${names.join(',')},state,orderedRecords,progressStore,archiveNavigation,get cameraVisit(){return aCameraVisit},get pathRun(){return aPathRun}};\n  loadProgress();`);
   data=Buffer.from(text);
  }
  if(relative==='js/core/bgm.js')data=Buffer.from(data.toString().replace('  updateControls();\n  window.RustedPrayerBgm=', '  window.__bgmAudit={audio,desired};\n  updateControls();\n  window.RustedPrayerBgm='));
  res.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');
  const range=req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),data.length-1):data.length-1;res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${data.length}`,'Accept-Ranges':'bytes','Content-Length':end-start+1});res.end(data.subarray(start,end+1));}
  else {res.setHeader('Content-Length',data.length);res.end(data);}
 } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
const browser=await playwright.chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,headless:true,ignoreDefaultArgs:['--disable-back-forward-cache'],args:['--no-sandbox']});
const errors=[];
async function ready(page){page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>window.__audit&&!window.__audit.state.loading);}
async function setup({seed=false,instant=true,mobile=true,width=412,height=915}={}){
 const context=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
 const page=await context.newPage();await ready(page);
 await page.evaluate(({seed,instant})=>{
  const a=window.__audit;
  if(seed){for(const r of a.orderedRecords){const p=a.recordProgress(r.id);p.completed=true;p.seenIndex=Math.max(0,r.story.length-1);p.lineIndex=0;}a.state.progress.readingSetupSeen=true;}
  a.state.instant=instant;a.state.auto=false;a.state.autoEnabled=false;a.saveProgress();
 },{seed,instant});
 return {page,context};
}
async function story(page,id,index=0){await page.evaluate(async({id,index})=>{const a=window.__audit;a.state.selectedRecordId=id;a.selectDisk(window.RustedPrayerArchive.getRecord(id).diskId,false);await a.startStory(true,index);},{id,index});await page.waitForFunction(()=>!window.__audit.state.loading);}
const out=(name,data)=>console.log(JSON.stringify({test:name,...data}));
const capture=async(page,name)=>{await page.waitForTimeout(450);return page.screenshot({path:path.join(root,name+'.png')});};
try {
 for(const name of process.argv.slice(2)) {
  console.log('RUN',name);
  await (await import(new URL(name+'.mjs',import.meta.url))).run({setup,story,out,url,ready,root,capture,browser});
  if(errors.length)throw Error('Browser errors: '+errors.join('\n'));
  console.log('PASS',name);
 }
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
