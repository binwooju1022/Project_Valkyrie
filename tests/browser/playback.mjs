import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
// Run with Node and an installed Playwright package. Optional runtime overrides:
// PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM_EXECUTABLE, PLAYBACK_TEST_OUTPUT.
const testRoot=path.dirname(fileURLToPath(import.meta.url));
const root=process.env.PLAYBACK_TEST_OUTPUT || await fs.mkdtemp(path.join(os.tmpdir(),'valkyrie-playback-'));
await fs.mkdir(root,{recursive:true});
const source=path.resolve(testRoot,'../..');
const code=await fs.readFile(path.join(source,'js/app.js'),'utf8');
const exports='state,orderedRecords,mainRecords,startStory,openObjective,selectDisk,selectRecord,showScreen,handleAction,renderLine,finishTyping,clearPlaybackTimers,loadProgress,saveProgress,recordProgress,storyPages,restoreView,viewState,openReadLocation,completeRecord,importProgress,goBack,toggleAuto,setStoryMenu,toggleBookmark,confirmReset,progressStore,changeReadingSettings,cancelLoading,loadTransition,suspendPlayback,resumePlayback,playbackTasks';
const instrumented=code.replace(/  loadProgress\(\);\r?\n  selectReadingPosition\(\);/,`  window.__audit={${exports}};\n  loadProgress();\n  selectReadingPosition();`);
if(instrumented===code)throw Error('instrumentation point missing');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.mp3':'audio/mpeg','.ogg':'audio/ogg','.woff2':'font/woff2'};
const requests=[];
const server=http.createServer((req,res)=>{
 const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html';
 if(p==='blank'){res.end('<!doctype html><title>outside game</title><p>outside game</p>');return;}
 if(p==='js/app.js'){res.setHeader('Content-Type','text/javascript');res.end(instrumented);return;}
 const file=path.resolve(source,p);
 if(!file.startsWith(source+path.sep)||!fss.existsSync(file)){requests.push(p);res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
 fss.createReadStream(file).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--disable-back-forward-cache'],executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
const results=[],errors=[];
async function ready(page){
 page.on('pageerror',e=>errors.push(e.stack));
 await page.goto(url);try{await page.waitForFunction(()=>window.__audit&&!window.__audit.state.loading);}catch(e){console.log(await page.evaluate(()=>({audit:!!window.__audit,screen:window.__audit?.state.screen,loading:window.__audit?.state.loading,body:document.body.innerText.slice(-1800)})));throw e;}
}
async function setup({seed=false,instant=true,width=412,height=915,mobile=true}={}){
 const context=await browser.newContext({viewport:{width,height},hasTouch:mobile,isMobile:mobile});
 if(seed)await context.addInitScript(({instant})=>{
  const v={version:24,records:{},instant,readingSetupSeen:true,aIdentificationIntroSeen:true};
  for(const k of ['c02','b03','c03','d04','b07','d05'])v[k+'LayoutVersion']=1;
  for(const id of ['A-01','A-02','A-03','A-04','A-05','A-06','A-07','A-08','B-01','B-02','B-03','B-04','B-05','B-06','B-06-01','B-07','B-08','C-00','C-01','C-02','C-03','C-04','C-05','D-01','D-03','D-04','D-05','D-06','D-07','D-09','D-10','D-11','D-14'])v.records[id]={completed:true,lineIndex:0};
  if(!localStorage.getItem('rusted-prayer-mvp-progress'))localStorage.setItem('rusted-prayer-mvp-progress',JSON.stringify(v));
 },{instant});
 const page=await context.newPage();await ready(page);return {context,page};
}
async function story(page,id,index=0){
 await page.evaluate(async({id,index})=>{const a=window.__audit;a.state.selectedRecordId=id;a.selectDisk(id[0],false);await a.startStory(false,index);},{id,index});
 await page.waitForFunction(({id,index})=>window.__audit.state.screen==='story-screen'&&!window.__audit.state.loading&&window.__audit.state.selectedRecordId===id&&window.__audit.state.lineIndex===index,{id,index});
}
async function capture(page,name){await page.screenshot({path:path.join(root,name+'.png'),fullPage:true});}
const out=(name,value)=>{results.push({name,...value});console.log(JSON.stringify(results.at(-1)));};
try {
 await (await import(process.env.PLAYBACK_TEST_CASES||'./playback-cancel.mjs')).run({browser,url,ready,setup,story,capture,out,root});
}finally{
 await fs.writeFile(path.join(root,process.env.PLAYBACK_TEST_RESULT||'results.json'),JSON.stringify({baseCommit:'287ef9903d2a9fd868c0abdde7fbdc9056ae1201',results,errors,requests},null,2));
 await browser.close();server.close();
}
