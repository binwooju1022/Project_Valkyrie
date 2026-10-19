(function () {
  "use strict";

  const archive = window.RustedPrayerArchive;
  archive.validate();
  const orderedRecords = archive.getDisks().flatMap(disk => archive.getRecordsByDisk(disk.id));
  const mainRecords=orderedRecords.filter(record=>!record.relatedReport);
  const media = window.RustedPrayerMedia;
  const recordNumber=record=>record?.displayId || record?.id || '';
  const numberedText=(text,record)=>String(text || '').replace(new RegExp('^'+record.id,'i'),recordNumber(record).toLowerCase());
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const archiveMobileQuery=window.matchMedia('(max-width:760px), (max-width:1180px) and (hover:none) and (pointer:coarse)');
  const archivePanelIds=['archive-media-panel','archive-files-panel','archive-detail-panel'];
  const defaultDialoguePosition=()=>archiveMobileQuery.matches ? 'left' : 'center';

  const STORAGE_KEY = "rusted-prayer-mvp-progress";
  // Only adjacent recordings of one event share a playback flow.
  const CONTINUOUS_LINKS = {'B-05':'B-06', 'B-06':'B-06-01', 'C-03':'C-04', 'C-04':'C-05','D-05':'D-06','D-06':'D-11'};
  const SPEAKER_THEMES = {
    "연화": "yeonhwa", "UNIT-01": "yeonhwa",
    "유라": "yura", "UNIT-02": "yura",
    "가은": "gaeun", "UNIT-04": "gaeun",
    "세린": "serin", "UNIT-03": "serin",
    "초희": "chohee", "UNIT-05": "chohee",
    "담당자": "researcher",
    "연구원": "researcher",
    "연구원 A": "researcher-a",
    "연구원 B": "researcher-b",
    "시스템": "system",
    "드론 시스템": "system",
    "인지 데이터 오류": "system",
    "원본 기록": "system",
  };
  const screens = [...document.querySelectorAll(".screen")];
  let storageAvailable = true;

  const state = {
    selectedDisk: "A",
    selectedRecordId: null,
    lineIndex: 0,
    auto: false,
    autoTimer: null,
    typeTimer: null,
    isTyping: false,
    typingTarget: null,
    fullText: "",
    typingCredit: 0,
    uiHidden: false,
    instant: false,
    continuous: true,
    transition: null,
    transitionPaused: false,
    textSize: 'normal',
    dialoguePosition: defaultDialoguePosition(),
    textSpeed: 'normal',
    autoSpeed: 'normal',
    rememberAuto: true,
    autoEnabled: false,
    settingsPlaybackReturn: null,
    settingsStartRecordId: null,
    settingsCategory: 'reading',
    effectsReduced: false,
    endingAnimation: true,
    characterLabels: false,
    autoResume: false,
    identificationIntroActive: false,
    libraryRecordLimits: {},
    previewTimer: null,
    progress: { records: {} },
    screen: 'boot-screen',
    loading: null,
    reportContext: null,
    presentedRecordId: null,
    reportScrollTimer: null,
    advanceLocked: false,
    gateTimer: null,
    attachmentPending: false,
    profileReturnFocus: null,
    beatPresses: 0,
    telemetryPage: 0,
    telemetryLineIndex: -1,
    endingAttempt: 0,
    endingShutterTimer:null,
    endingDetailsOpen:false,
    menuOpen:false,
    galleryIndex:0,
    galleryLoading:null,
    galleryFilter:'all',
    endingFromGallery:false,
    archivePane:1,
    archiveToolsOpen:false,
    archiveRecordKind:'main',
    archiveScrollPositions:{},
  };

  const $ = (selector) => document.querySelector(selector);
  const motionReduced = () => reduceMotion;
  const speedFactor = value => ({slow:1.5, normal:1, fast:.6}[value] || 1);
  function readingDuration(text, line = null) {
    const value=String(text || '').trim();
    const factor={fast:1,normal:1.4,slow:1.9}[state.autoSpeed] || 1.4;
    const sound=/^(?:탕|타앙|쾅|콰앙|철컥|찰칵|딸깍|탁|쿵|퍽|툭|짤랑|끼익|총성|폭발음)[\s\-—–.!！·…]*$/u.test(value);
    let duration=sound ? 600 : /^[.·…\s]+$/u.test(value) ? 1200 : Math.max(800,350+value.length*40);
    if (['memo','document','report','comparison','objective'].includes(line?.tone)) duration=Math.max(1200,duration*1.2);
    return Math.round(Math.min(18000,duration)*factor);
  }
  function telemetryPages(text) {
    const sentences=String(text || '').trim().split(/(?<=[.!?。])\s+/u).filter(Boolean);
    const pages=[];
    let page='';
    let sentenceCount=0;
    for (const sentence of sentences.length ? sentences : [String(text || '')]) {
      const combined=page ? page+' '+sentence : sentence;
      if (page && (combined.length>42 || sentenceCount>=2)) { pages.push(page); page=sentence; sentenceCount=1; }
      else { page=combined; sentenceCount+=1; }
    }
    if(page)pages.push(page);
    return pages.length ? pages : [''];
  }

  function storyPages(line) {
    return line && line.instrument!=='scan' && (line.tone==='telemetry' || line.instrument==='drone')
      ? line.telemetryPages || telemetryPages(line.text) : [line?.text || ''];
  }

  function seenPage(record, index, progress = recordProgress(record.id)) {
    const pages=storyPages(record.story[index]);
    if (progress.completed) return pages.length-1;
    const seen=Number.isInteger(progress.seenIndex) ? Math.max(progress.seenIndex,progress.lineIndex || 0)
      : progress.lineIndex>0 ? progress.lineIndex : -1;
    if (index>seen) return -1;
    const saved=progress.seenPages?.[index];
    if (Number.isInteger(saved) && saved>=0) return Math.min(saved,pages.length-1);
    // Older saves know complete earlier lines, but only the current subpage at the frontier.
    if (index<seen) return pages.length-1;
    return index===progress.lineIndex && Number.isInteger(progress.telemetryPage)
      ? Math.max(0,Math.min(progress.telemetryPage,pages.length-1)) : 0;
  }

  function readableText(record, index) {
    const line=(record.readerMode==='report' ? record.reportSections : record.story)[index];
    if (!line) return '';
    const pages=storyPages(line);
    return stripTechnicalMetadata(pages.length>1
      ? pages.slice(0,seenPage(record,index)+1).join('\n') : line.text);
  }
  function systemText(text) {
    return String(text || '').replace(/\[드론 시스템 기록\]\s*/g,'').replace(/^시스템\s*:\s*/,'').replace(/(?:[ \t]+:\s*|:\s+)/g,'. ');
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function currentRecord() {
    return archive.getRecord(state.selectedRecordId);
  }

  function currentStory() {
    return currentRecord()?.story || [];
  }

  function readingPosition() {
    const index = mainRecords.findIndex(record => !recordProgress(record.id).completed);
    return index === -1 ? mainRecords.length - 1 : index;
  }

  function isRecordUnlocked(record) {
    if(record?.relatedReport)return recordProgress(record.unlockAfter).completed;
    const index = mainRecords.findIndex(item => item.id === record?.id);
    return index >= 0 && index <= readingPosition();
  }

  function selectReadingPosition() {
    const resume = archive.getRecord(state.progress.resumeRecordId);
    const record = !resume?.relatedReport && (resume?.story.length || resume?.readerMode==='report') && recordProgress(resume.id).inProgress && isRecordUnlocked(resume)
      ? resume : mainRecords[readingPosition()];
    if (!record) return;
    state.selectedRecordId = record.id;
    state.archiveRecordKind='main';
    selectDisk(record.diskId);
  }

  const D_MAIN_GUIDANCE='D편 본편에서 읽을 기록을 선택해 주세요.';
  function dMainResumeRecord() {
    const resume=archive.getRecord(state.progress.resumeRecordId);
    return resume?.diskId==='D' && !resume.relatedReport &&
      (resume.story.length || resume.readerMode==='report') &&
      recordProgress(resume.id).inProgress && isRecordUnlocked(resume) ? resume : null;
  }

  function dMainReturnMarkup() {
    const resume=dMainResumeRecord();
    return `${resume ? '' : `<p class="reading-note">${D_MAIN_GUIDANCE}</p>`}<button class="button" data-action="resume-main" type="button">${resume ? '본편 이어보기' : 'D편 본편 보기'}</button>`;
  }

  function resumeDMain() {
    if(syncResetFromStorage())return;
    if(validReportContext()) {returnReportMain();return;}
    const resume=dMainResumeRecord();
    if(!mainRecords.some(record=>record.diskId==='D' && isRecordUnlocked(record)))return;
    clearPlaybackTimers();state.auto=false;updateAutoButton();
    state.archiveRecordKind='main';
    state.selectedRecordId=resume?.id || null;
    selectDisk('D');
    if(resume) {
      if(resume.story.length)startStory();
      else openObjective();
    } else {
      showScreen('archive-screen');
      $('#d-record-hint').textContent=D_MAIN_GUIDANCE;
      moveArchivePane(1);
    }
  }

  function validReportContext(context=state.reportContext) {
    const record=archive.getRecord(context?.recordId);
    return record?.diskId==='D' && !record.relatedReport && isRecordUnlocked(record) ? context : null;
  }

  function rememberReportPosition() {
    if(state.loading)return;
    const record=currentRecord();
    if(state.screen!=='objective-screen' || record?.readerMode!=='report' || record.relatedReport)return;
    const progress=recordProgress(record.id);progress.reportScroll=Math.max(0,window.scrollY || 0);
    if(state.reportContext?.recordId===record.id)state.reportContext.scrollTop=progress.reportScroll;
  }

  function captureReportContext() {
    const record=currentRecord();if(record?.diskId!=='D' || record.relatedReport)return;
    rememberReportPosition();saveProgress();
    state.reportContext={recordId:record.id,screen:state.screen==='story-screen'?'story-screen':'objective-screen',lineIndex:state.lineIndex,telemetryPage:state.telemetryPage,scrollTop:window.scrollY || 0};
  }

  function syncReadingMusic(record,index,screen) {
    const context=validReportContext(),main=context&&archive.getRecord(context.recordId);
    if(main && (screen==='objective-screen' && record?.relatedReport || screen==='archive-screen' && state.archiveRecordKind==='related')) {
      window.RustedPrayerBgm?.sync(main,context.lineIndex,main.readerMode==='report'?'objective-screen':'story-screen');
    }else window.RustedPrayerBgm?.sync(record,index,screen);
  }

  function reportCompletionLabel(record) {
    if(record?.diskId==='D' && !record.relatedReport && record.readerMode==='report') {
      const next=archive.getRecord(record.nextId);return next?`${recordNumber(next)}으로 계속`:'마지막 사진 보기';
    }
    return record?.relatedReport && validReportContext()?'확인하고 본편으로 돌아가기':record?.epilogue?'기록 마치기':'보고서 열람 완료';
  }

  async function returnReportMain() {
    const context=validReportContext();if(!context)return;
    const previousId=state.selectedRecordId,previousKind=state.archiveRecordKind;
    const record=archive.getRecord(context.recordId);
    state.selectedRecordId=record.id;state.archiveRecordKind='main';selectDisk('D',false);
    if(record.readerMode==='report') {
      recordProgress(record.id).reportScroll=context.scrollTop;await openObjective('replace');
    }else if(context.screen==='objective-screen')await openObjective('replace');
    else {
      await startStory(false,context.lineIndex,'replace',null,context.telemetryPage);
      if(state.screen!=='story-screen'){state.selectedRecordId=previousId;state.archiveRecordKind=previousKind;selectDisk('D',false);}
    }
  }

  async function continueMainReport() {
    const context=validReportContext(),record=context&&archive.getRecord(context.recordId);
    if(!record || record.readerMode!=='report')return;
    const progress=recordProgress(record.id);progress.completed=true;progress.inProgress=false;progress.lineIndex=0;progress.reportScroll=0;
    if(state.progress.resumeRecordId===record.id)delete state.progress.resumeRecordId;
    saveProgress();
    const next=archive.getRecord(record.nextId);
    if(next && isRecordUnlocked(next))await startStory(true,0,'push',next);
    else if(record.epilogue && allRecordsRead())await openEnding('replace',false);
  }

  function recordProgress(recordId) {
    const saved = state.progress.records[recordId];
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
      state.progress.records[recordId] = { completed: false, lineIndex: 0 };
    }
    const progress = state.progress.records[recordId];
    progress.lineIndex = Number.isInteger(progress.lineIndex) && progress.lineIndex >= 0 ? progress.lineIndex : 0;
    progress.completed = progress.completed === true;
    if (!progress.seenPages || typeof progress.seenPages!=='object' || Array.isArray(progress.seenPages)) progress.seenPages={};
    return state.progress.records[recordId];
  }

  function migrateDProgress(saved) {
    if(saved.dLayoutVersion===20 || saved.version>=20)return;
    const layout=window.RustedPrayerDLayout;
    if(!layout)return;
    const original={...saved.records}, version=saved.version || 1;
    const next={...original};
    for(const id of Object.keys(layout.migrations))delete next[id];
    const entries=Object.entries(layout.migrations).sort(([a],[b])=>Number(a===saved.resumeRecordId)-Number(b===saved.resumeRecordId));
    for(const [id,spec] of entries) {
      const progress=original[id];
      if(!progress || typeof progress!=='object' || Array.isArray(progress))continue;
      const mapped={...progress};
      for(const field of ['lineIndex','seenIndex'])if(Number.isInteger(mapped[field]))mapped[field]=spec.indices[version]?.[mapped[field]] ?? 0;
      next[spec.targetId]={...next[spec.targetId],...mapped};
    }
    if(next['D-01'])next['D-01'].completed=original['D-01']?.completed===true && original['D-02']?.completed===true;
    if(next['D-07'])next['D-07'].completed=original['D-07']?.completed===true && original['D-12']?.completed===true;
    if(next['D-14'])next['D-14'].completed=original['D-14']?.completed===true;
    saved.records=next;
    if(saved.resumeRecordId) {
      saved.resumeRecordId=layout.migrations[saved.resumeRecordId]?.targetId || saved.resumeRecordId;
      if(archive.getRecord(saved.resumeRecordId)?.relatedReport)delete saved.resumeRecordId;
    }
    if(Array.isArray(saved.bookmarks))saved.bookmarks=saved.bookmarks.map(mark=>{
      const spec=layout.migrations[mark?.recordId];
      if(!spec)return mark;
      const record=archive.getRecord(spec.targetId),index=spec.indices[version]?.[mark.index] ?? 0;
      const line=(record?.reportSections || record?.story)?.[index];
      return line ? {...mark,recordId:spec.targetId,index,text:line.text} : mark;
    });
    saved.dLayoutVersion=20;
  }

  function migrateDView(view) {
    if(view?.presentationVersion>=20)return view;
    const spec=window.RustedPrayerDLayout?.migrations[view?.recordId];
    return spec ? {...view,recordId:spec.targetId,lineIndex:spec.indices[view.presentationVersion || 1]?.[view.lineIndex] ?? 0,dPositionCurrent:true} : view;
  }

  function loadProgress(imported = null) {
    try {
      const parsed = imported || JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      state.progress = {records:{}};
      const saved = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      const migrateC02=saved.c02LayoutVersion!==1;
      const migrateB03=saved.version===24 && saved.b03LayoutVersion!==1;
      const migrateC03=saved.version===24 && saved.c03LayoutVersion!==1;
      const migrateD04=saved.version===24 && saved.d04LayoutVersion!==1;
      const migrateB07=saved.version===24 && saved.b07LayoutVersion!==1;
      const migrateD05=saved.version===24 && saved.d05LayoutVersion!==1;
      migrateDProgress(saved);
      const migrationRecords=orderedRecords.filter(record=>record.diskId!=='D');
      if (typeof saved.resumeRecordId === 'string' && archive.getRecord(saved.resumeRecordId)) state.progress.resumeRecordId = saved.resumeRecordId;
      state.progress.resetGeneration = Number.isSafeInteger(saved.resetGeneration) && saved.resetGeneration >= 0 ? saved.resetGeneration : 0;
      if (saved.records && typeof saved.records === "object" && !Array.isArray(saved.records)) {
        state.progress.records = saved.records;
      } else if ("completed" in saved || "lineIndex" in saved) {
        state.progress.records["B-06"] = {
          completed: Boolean(saved.completed),
          lineIndex: Number.isInteger(saved.lineIndex) ? saved.lineIndex : 0,
        };
      }
      // The old sample kept RUN.DAT inside B-06; migrate to the complete manuscript layout.
      if ((!saved.version || saved.version < 2) && state.progress.records['B-06']) {
        state.progress.records['B-06-01'] = { completed: state.progress.records['B-06'].completed === true, lineIndex: 0 };
        state.progress.records['B-06'].lineIndex = 0;
      }
      if (!saved.version || saved.version < 3) {
        migrationRecords.forEach(record => {
          const existing = state.progress.records[record.id];
          if (!existing || !Number.isInteger(existing.lineIndex) || existing.lineIndex < 0) return;
          const progress = recordProgress(record.id);
          progress.lineIndex = record.legacyIndexMap?.[progress.lineIndex] ?? 0;
        });
      } else if (saved.version === 3) {
        migrationRecords.forEach(record => {
          if (!state.progress.records[record.id]) return;
          const progress = recordProgress(record.id);
          progress.lineIndex = record.v4IndexMap?.[Math.max(0, progress.lineIndex - (record.introSceneCount || 0))] ?? 0;
        });
      } else if (saved.version === 4) {
        migrationRecords.forEach(record => {
          if (!state.progress.records[record.id]) return;
          const progress = recordProgress(record.id);
          progress.lineIndex = record.v4IndexMap?.[progress.lineIndex] ?? 0;
        });
      }
      if (saved.version === 5) migrationRecords.forEach(record => {
        if (state.progress.records[record.id]) {
          const progress = recordProgress(record.id);
          progress.lineIndex = record.v5IndexMap?.[progress.lineIndex] ?? 0;
        }
      });
      if (saved.version === 6) migrationRecords.forEach(record => {
        if (state.progress.records[record.id]) {
          const progress=recordProgress(record.id);
          progress.lineIndex=record.v6IndexMap?.[progress.lineIndex] ?? 0;
        }
      });
      if (saved.version === 7) migrationRecords.forEach(record => {
        const progress=state.progress.records[record.id];
        if(progress && record.v7IndexMap && Number.isInteger(progress.lineIndex)) {
          progress.lineIndex=record.v7IndexMap[progress.lineIndex] ?? 0;
        }
      });
      if (saved.version === 8) migrationRecords.forEach(record => {
        const progress=state.progress.records[record.id];
        if(progress && record.v8IndexMap && Number.isInteger(progress.lineIndex)) {
          progress.lineIndex=record.v8IndexMap[progress.lineIndex] ?? 0;
        }
      });
      if (saved.version === 9) migrationRecords.forEach(record => {
        const progress = state.progress.records[record.id];
        if (!progress || !record.v9IndexMap) return;
        for (const field of ['lineIndex','seenIndex']) {
          if (Number.isInteger(progress[field])) progress[field] = record.v9IndexMap[progress[field]] ?? 0;
        }
      });
      if (saved.version === 10) migrationRecords.forEach(record => {
        const progress = state.progress.records[record.id];
        if (!progress || !record.v10IndexMap) return;
        for (const field of ['lineIndex','seenIndex']) {
          if (Number.isInteger(progress[field])) progress[field] = record.v10IndexMap[progress[field]] ?? 0;
        }
      });
      if(saved.version===11)migrationRecords.forEach(record=>{
        const progress=state.progress.records[record.id];
        if(progress && record.v11IndexMap)for(const field of ['lineIndex','seenIndex'])if(Number.isInteger(progress[field]))progress[field]=record.v11IndexMap[progress[field]] ?? 0;
      });
      if(saved.version===11 || saved.version===12)migrationRecords.forEach(record=>{
        if(saved.version===11 && record.v11IndexMap && (record.presentationVersion===19 || record.id==='C-03'))return;
        const progress=state.progress.records[record.id];
        if(progress && record.v12IndexMap)for(const field of ['lineIndex','seenIndex'])if(Number.isInteger(progress[field]))progress[field]=record.v12IndexMap[progress[field]] ?? 0;
      });
      if(saved.version===13)migrationRecords.forEach(record=>{
        const progress=state.progress.records[record.id];
        if(progress && record.v13IndexMap)for(const field of ['lineIndex','seenIndex'])if(Number.isInteger(progress[field]))progress[field]=record.v13IndexMap[progress[field]] ?? 0;
      });
      if(saved.version===14)migrationRecords.forEach(record=>{
        const progress=state.progress.records[record.id];
        if(progress && record.v14IndexMap)for(const field of ['lineIndex','seenIndex'])if(Number.isInteger(progress[field]))progress[field]=record.v14IndexMap[progress[field]] ?? 0;
      });
      if(saved.version===15)migrationRecords.forEach(record=>{
        const progress=state.progress.records[record.id];
        if(progress && record.v15IndexMap)for(const field of ['lineIndex','seenIndex'])if(Number.isInteger(progress[field]))progress[field]=record.v15IndexMap[progress[field]] ?? 0;
      });
      if(saved.version===16)migrationRecords.forEach(record=>{
        const progress=state.progress.records[record.id];
        if(progress && record.v16IndexMap)for(const field of ['lineIndex','seenIndex'])if(Number.isInteger(progress[field]))progress[field]=record.v16IndexMap[progress[field]] ?? 0;
      });
      if(saved.version===17)migrationRecords.forEach(record=>{
        const progress=state.progress.records[record.id];
        if(progress && record.v17IndexMap)for(const field of ['lineIndex','seenIndex'])if(Number.isInteger(progress[field]))progress[field]=record.v17IndexMap[progress[field]] ?? 0;
      });
      if(saved.version===18)migrationRecords.forEach(record=>{
        const progress=state.progress.records[record.id];
        if(progress && record.v18IndexMap)for(const field of ['lineIndex','seenIndex'])if(Number.isInteger(progress[field]))progress[field]=record.v18IndexMap[progress[field]] ?? 0;
      });
      if(migrateC02 && state.progress.records['C-02']) {
        const progress=recordProgress('C-02');
        for(const field of ['lineIndex','seenIndex'])if(Number.isInteger(progress[field]))progress[field]=c02Position(progress[field]);
      }
      if(saved.version===20 || saved.version===19)orderedRecords.forEach(record=>{
        if(saved.version===19 && record.diskId==='D')return; // D layout already maps directly to current positions.
        const progress=state.progress.records[record.id];
        if(!progress || !record.v20IndexMap)return;
        const oldIndex=progress.lineIndex;
        for(const field of ['lineIndex','seenIndex'])if(Number.isInteger(progress[field]))progress[field]=record.v20IndexMap[progress[field]] ?? 0;
        if(Number.isInteger(progress.telemetryPage))progress.telemetryPage=record.v20PageMap?.[oldIndex]?.[progress.telemetryPage] ?? 0;
      });
      if(saved.version===21)orderedRecords.forEach(record=>{
        const progress=state.progress.records[record.id];
        if(progress && record.v21IndexMap)for(const field of ['lineIndex','seenIndex'])if(Number.isInteger(progress[field]))progress[field]=record.v21IndexMap[progress[field]] ?? 0;
      });
      if(saved.version===22)orderedRecords.forEach(record=>{
        const progress=state.progress.records[record.id];
        if(progress && record.v22IndexMap)for(const field of ['lineIndex','seenIndex'])if(Number.isInteger(progress[field]))progress[field]=record.v22IndexMap[progress[field]] ?? 0;
      });
      if(saved.version===23)orderedRecords.forEach(record=>{
        const progress=state.progress.records[record.id];
        if(progress && record.v23IndexMap)for(const field of ['lineIndex','seenIndex'])if(Number.isInteger(progress[field]))progress[field]=record.v23IndexMap[progress[field]] ?? 0;
      });
      if(migrateB03 && state.progress.records['B-03']) {
        const progress=state.progress.records['B-03'],map=archive.getRecord('B-03').v24IndexMap;
        for(const field of ['lineIndex','seenIndex'])if(Number.isInteger(progress[field]))progress[field]=map[progress[field]]??0;
      }
      state.progress.b03LayoutVersion=1;
      if(migrateC03 && state.progress.records['C-03']) {
        const progress=state.progress.records['C-03'],map=archive.getRecord('C-03').v24IndexMap;
        for(const field of ['lineIndex','seenIndex'])if(Number.isInteger(progress[field]))progress[field]=map[progress[field]]??0;
      }
      state.progress.c03LayoutVersion=1;
      if(migrateD04 && state.progress.records['D-06']) {
        const progress=state.progress.records['D-06'],map=archive.getRecord('D-06').v24IndexMap;
        for(const field of ['lineIndex','seenIndex'])if(Number.isInteger(progress[field]))progress[field]=map[progress[field]]??0;
      }
      state.progress.d04LayoutVersion=1;
      if(migrateB07 && state.progress.records['B-07']) {
        const progress=state.progress.records['B-07'],record=archive.getRecord('B-07'),map=record.v24IndexMap;
        if(Number.isInteger(progress.lineIndex))progress.lineIndex=map[progress.lineIndex]??0;
        if(Number.isInteger(progress.seenIndex))progress.seenIndex=record.b07SplitSeenIndexMap[progress.seenIndex]??0;
        if(progress.seenPages && typeof progress.seenPages==='object') {
          const pages={};
          for(const [index,page] of Object.entries(progress.seenPages))if(Number.isInteger(map[index])) {
            pages[map[index]]=page;
            if(record.b07SplitSeenIndexMap[index]!==map[index])pages[record.b07SplitSeenIndexMap[index]]=page;
          }
          progress.seenPages=pages;
        }
      }
      // Historical maps already target the new positions; a formerly whole line was fully seen.
      if(saved.version<24 && state.progress.records['B-07']) {
        const progress=state.progress.records['B-07'],record=archive.getRecord('B-07');
        for(const oldIndex of [25,81])if(progress.seenIndex===record.v24IndexMap[oldIndex])progress.seenIndex=record.b07SplitSeenIndexMap[oldIndex];
      }
      state.progress.b07LayoutVersion=1;
      if(migrateD05 && state.progress.records['D-11']) {
        const progress=state.progress.records['D-11'],record=archive.getRecord('D-11'),map=record.v24IndexMap;
        if(Number.isInteger(progress.lineIndex))progress.lineIndex=map[progress.lineIndex]??0;
        if(Number.isInteger(progress.seenIndex))progress.seenIndex=record.d05SplitSeenIndexMap[progress.seenIndex]??0;
        if(progress.seenPages && typeof progress.seenPages==='object') {
          const pages={};for(const [index,page] of Object.entries(progress.seenPages))if(Number.isInteger(map[index])){pages[map[index]]=page;if(record.d05SplitSeenIndexMap[index]!==map[index])pages[record.d05SplitSeenIndexMap[index]]=page;}progress.seenPages=pages;
        }
      }
      if(saved.version<24 && state.progress.records['D-11']?.seenIndex===archive.getRecord('D-11').v24IndexMap[24])state.progress.records['D-11'].seenIndex=archive.getRecord('D-11').d05SplitSeenIndexMap[24];
      state.progress.d05LayoutVersion=1;
      state.progress.c02LayoutVersion=1;
      if (!saved.version || saved.version<24) for (const progress of Object.values(state.progress.records)) {
        if (progress && typeof progress==='object') delete progress.seenPages;
      }
      state.progress.version = 24;
      state.progress.dLayoutVersion=20;
      state.instant = saved.instant === true;
      state.continuous = saved.continuous !== false;
      state.textSize = ['small','normal','large'].includes(saved.textSize) ? saved.textSize : 'normal';
      state.dialoguePosition = ['left','center','right'].includes(saved.dialoguePosition) ? saved.dialoguePosition : defaultDialoguePosition();
      state.textSpeed = ['slow','normal','fast'].includes(saved.textSpeed) ? saved.textSpeed : 'normal';
      state.autoSpeed = ['slow','normal','fast'].includes(saved.autoSpeed) ? saved.autoSpeed : 'normal';
      state.rememberAuto = saved.rememberAuto !== false;
      state.autoEnabled = saved.autoEnabled === true;
      state.progress.readingSetupSeen = saved.readingSetupSeen === true || Object.values(state.progress.records).some(progress=>
        progress && (progress.completed || progress.inProgress || Number.isInteger(progress.seenIndex) || progress.lineIndex>0));
      state.effectsReduced = saved.effectsReduced === true;
      state.endingAnimation = saved.endingAnimation !== false;
      state.characterLabels = saved.characterLabels === true;
      state.autoResume = saved.autoResume === true;
      state.progress.aIdentificationIntroSeen = saved.aIdentificationIntroSeen === true;
      state.identificationIntroActive = false;
      state.progress.bookmarks = Array.isArray(saved.bookmarks) ? saved.bookmarks.map(mark => {
        const octoberRecord=archive.getRecord(mark?.recordId);
        if(migrateD05 && mark?.recordId==='D-11' && Number.isInteger(mark.index)) {
          const index=octoberRecord.v24IndexMap[mark.index],line=octoberRecord.story[index];return line?{...mark,index,text:line.text}:null;
        }
        if(migrateB07 && mark?.recordId==='B-07' && Number.isInteger(mark.index)) {
          const index=octoberRecord.v24IndexMap[mark.index],line=octoberRecord.story[index];
          return line?{...mark,index,text:line.text}:null;
        }
        if(migrateD04 && mark?.recordId==='D-06' && Number.isInteger(mark.index)) {
          const index=octoberRecord.v24IndexMap[mark.index],line=octoberRecord.story[index];
          return line?{...mark,index,text:line.text}:null;
        }
        if(migrateC03 && mark?.recordId==='C-03' && Number.isInteger(mark.index)) {
          const index=octoberRecord.v24IndexMap[mark.index],line=octoberRecord.story[index];
          return line?{...mark,index,text:line.text}:null;
        }
        if(migrateB03 && mark?.recordId==='B-03' && Number.isInteger(mark.index)) {
          const index=octoberRecord.v24IndexMap[mark.index],line=octoberRecord.story[index];
          return line?{...mark,index,text:line.text}:null;
        }
        if(saved.version===23 && octoberRecord?.v23IndexMap && Number.isInteger(mark.index)) {
          const index=octoberRecord.v23IndexMap[mark.index],line=(octoberRecord.reportSections || octoberRecord.story)[index];
          return line ? {...mark,index,text:line.text} : null;
        }
        if(saved.version===22 && octoberRecord?.v22IndexMap && Number.isInteger(mark.index)) {
          const index=octoberRecord.v22IndexMap[mark.index],line=(octoberRecord.reportSections || octoberRecord.story)[index];
          return line ? {...mark,index,text:line.text} : null;
        }
        if(saved.version===21 && octoberRecord?.v21IndexMap && Number.isInteger(mark.index)) {
          const index=octoberRecord.v21IndexMap[mark.index],line=(octoberRecord.reportSections || octoberRecord.story)[index];
          return line ? {...mark,index,text:line.text} : null;
        }
        if((saved.version===20 || saved.version===19 && octoberRecord?.diskId!=='D') && octoberRecord?.v20IndexMap && Number.isInteger(mark.index)) {
          const index=octoberRecord.v20IndexMap[mark.index],line=(octoberRecord.reportSections || octoberRecord.story)[index];
          return line ? {...mark,index,text:line.text} : null;
        }
        if(mark?.recordId==='C-02' && migrateC02) {
          if(mark.text==='장비를 바닥에 내려놓는 소리.' || !Number.isInteger(mark.index))return null;
          const index=c02Position(mark.index,saved.version || 1),line=archive.getRecord('C-02').story[index];
          return line ? {...mark,index,text:line.text} : null;
        }
        if(mark?.recordId?.startsWith('D-')) {
          const record=archive.getRecord(mark.recordId);
          const correction=record?.bookmarkTextAliases?.find(alias=>alias.index===mark.index && alias.before===mark.text);
          return correction ? {...mark,text:(record.reportSections || record.story)[correction.index].text} : mark;
        }
        const record = archive.getRecord(mark?.recordId);
        const lines = record?.reportSections || record?.story;
        if(saved.version===18 && record?.v18IndexMap && Number.isInteger(mark.index)) {
          const index=record.v18IndexMap[mark.index];
          if(lines?.[index])return {...mark,index,text:lines[index].text};
        }
        if(saved.version===17 && record?.v17IndexMap && Number.isInteger(mark.index)) {
          const index=record.v17IndexMap[mark.index];
          if(lines?.[index])return {...mark,index,text:lines[index].text};
        }
        if(saved.version===16 && record?.v16IndexMap && Number.isInteger(mark.index)) {
          const index=record.v16IndexMap[mark.index];
          if(lines?.[index])return {...mark,index,text:lines[index].text};
        }
        if(saved.version===15 && record?.v15IndexMap && Number.isInteger(mark.index)) {
          const index=record.v15IndexMap[mark.index];
          if(lines?.[index])return {...mark,index,text:lines[index].text};
        }
        if(saved.version===14 && record?.v14IndexMap && Number.isInteger(mark.index)) {
          const index=record.v14IndexMap[mark.index];
          if(lines?.[index])return {...mark,index,text:lines[index].text};
        }
        if(saved.version===13 && record?.v13IndexMap && Number.isInteger(mark.index)) {
          const index=record.v13IndexMap[mark.index];
          if(lines?.[index])return {...mark,index,text:lines[index].text};
        }
        if((saved.version===11 || saved.version===12) && record?.v12IndexMap && Number.isInteger(mark.index)) {
          const index=record.v12IndexMap[mark.index];
          if(lines?.[index])return {...mark,index,text:lines[index].text};
        }
        const correction = record?.bookmarkTextAliases?.find(alias=>alias.index===mark.index && alias.before===mark.text);
        if (correction) return {...mark, text:lines[correction.index].text};
        const map = saved.version === 11 ? record?.v11IndexMap : saved.version === 10 ? record?.v10IndexMap : saved.version === 9 ? record?.v9IndexMap : null;
        if (!map || !Number.isInteger(mark.index) || !lines?.[map[mark.index]]) return mark;
        const index = map[mark.index];
        return {...mark, index, text:lines[index].text};
      }).filter(mark => {
        const record = archive.getRecord(mark?.recordId);
        const lines = record?.reportSections || record?.story;
        return lines && Number.isInteger(mark.index) && mark.index >= 0 && lines[mark.index]?.text === mark.text;
      }).slice(0,2000) : [];
    } catch {
      // A malformed save is recoverable; availability is checked on the next write.
      state.progress = { version:24, c02LayoutVersion:1, records: {} };
    }
  }

  function c02Position(index,version=20) {
    const record=archive.getRecord('C-02');
    const source=version===3 ? Math.max(0,index-(record.introSceneCount || 0)) : index;
    const map=version<3 ? record.legacyIndexMap : record['v'+(version===3 ? 4 : version)+'IndexMap'];
    return record.c02IndexMap?.[map?.[source] ?? source] ?? 0;
  }

  function saveProgress() {
    if (syncResetFromStorage()) return;
    const record = currentRecord();
    if (record && (state.screen === 'story-screen' || (state.screen === 'objective-screen' && record.readerMode === 'report'))) {
      const progress = recordProgress(record.id);
      progress.lineIndex = state.lineIndex;
      progress.updatedAt = new Date().toISOString();
      if (state.screen === 'story-screen') {
        progress.seenIndex = Math.max(progress.seenIndex || 0, state.lineIndex);
        progress.telemetryPage = state.telemetryLineIndex === state.lineIndex ? state.telemetryPage : 0;
        if (storyPages(record.story[state.lineIndex]).length>1) {
          progress.seenPages[state.lineIndex]=Math.max(seenPage(record,state.lineIndex,progress),progress.telemetryPage);
        }
        if (progress.inProgress) state.progress.resumeRecordId = record.id;
      }
      if(state.screen==='objective-screen' && !record.relatedReport && progress.inProgress) {
        rememberReportPosition();state.progress.resumeRecordId=record.id;
      }
    }

    Object.assign(state.progress, {version:24,b03LayoutVersion:1,c03LayoutVersion:1,d04LayoutVersion:1,b07LayoutVersion:1,d05LayoutVersion:1,instant:state.instant,continuous:state.continuous,textSize:state.textSize,
      dialoguePosition:state.dialoguePosition,textSpeed:state.textSpeed,autoSpeed:state.autoSpeed,rememberAuto:state.rememberAuto,autoEnabled:state.autoEnabled,effectsReduced:state.effectsReduced,endingAnimation:state.endingAnimation,characterLabels:state.characterLabels,autoResume:state.autoResume});
    if (!storageAvailable) return;

    try {
      state.progress.version = 24;
      state.progress.instant = state.instant;
      state.progress.continuous = state.continuous;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
    } catch {
      storageAvailable = false;
      $("#storage-notice").hidden = false;
    }
  }

  function viewState() {
    return {rustedPrayer:true, presentationVersion:24, c02LayoutVersion:1, b03LayoutVersion:1, c03LayoutVersion:1, d04LayoutVersion:1, b07LayoutVersion:1,d05LayoutVersion:1, reportContext:state.reportContext?{...state.reportContext}:null,resetGeneration:state.progress.resetGeneration || 0, screen:state.screen, diskId:state.selectedDisk, recordId:state.selectedRecordId, lineIndex:state.lineIndex,telemetryPage:state.telemetryLineIndex===state.lineIndex ? state.telemetryPage : 0,transitionPaused:state.screen==='transition-screen' && state.transitionPaused,transitionAuto:state.screen==='transition-screen' && state.auto,settingsStartRecordId:state.screen==='settings-screen' ? state.settingsStartRecordId : null,endingFromGallery:state.endingFromGallery,archiveRecordKind:state.archiveRecordKind};
  }

  function rememberView() {
    const previous = history.state;
    if (previous?.rustedPrayer && previous.screen === state.screen) history.replaceState({...viewState(), depth:previous.depth}, '');
  }

  function showScreen(id, historyMode = 'push') {
    if(state.screen==='archive-screen' && id!=='archive-screen')rememberArchiveScroll();
    if (!['settings-screen','reset-screen'].includes(id)) state.settingsStartRecordId=null;
    if (!['settings-screen','reset-screen'].includes(id)) state.settingsPlaybackReturn=null;
    if (!['transition-screen','settings-screen','reset-screen'].includes(id)) state.transitionPaused=false;
    if(id!=='ending-screen')clearEndingShutter();
    if(id!=='gallery-screen')cancelGalleryLoading();
    if (id !== 'story-screen') settleACamera();
    if (id !== 'story-screen' && id !== 'settings-screen') state.identificationIntroActive=false;
    closeProfile(false);
    clearTimeout(state.previewTimer);
    state.screen = id;
    state.presentedRecordId=currentRecord()?.id || null;
    if(['story-screen','ending-screen','gallery-screen','boot-screen'].includes(id))state.reportContext=null;
    syncReadingMusic(currentRecord(),state.lineIndex,id);
    if(id!=='story-screen')window.RustedPrayerSfx?.syncScene(currentRecord(),state.lineIndex,state.telemetryPage,id);
    if (id !== 'story-screen') $('#screen-fx').hidden = true;
    screens.forEach((screen) => {
      const active = screen.id === id;
      screen.hidden = !active;
      screen.classList.toggle("is-active", active);
    });
    window.scrollTo({ top: id==='archive-screen' ? state.archiveScrollPositions[state.selectedDisk+':'+state.archiveRecordKind]?.top || 0 : 0, behavior: "instant" });
    if (historyMode !== 'none') {
      const previous = history.state;
      const view = viewState();
      if (historyMode === 'replace' || (previous?.screen === id && previous.recordId === view.recordId)) {
        history.replaceState({...view, depth:previous?.depth || 0}, '');
      } else history.pushState({...view, depth:(previous?.depth || 0) + 1}, '');
    }
    const active = $('#' + id);
    active.setAttribute('tabindex', '-1');
    active.focus({preventScroll:true});
    if (id === 'archive-screen') {syncArchiveLayout();restoreArchiveScroll();}
    if (id === 'settings-screen') startSettingsPreview();
  }

  function cancelLoading() {
    const job = state.loading;
    if (!job) return;
    state.loading = null;
    window.RustedPrayerSfx?.abortLoad(job.sound);
    job.controller.abort();
    job.decide?.('cancel');
    if (state.screen === 'transition-screen') {
      clearTimeout(state.autoTimer);
      state.transitionPaused = true;
      updateAutoButton();
      rememberView();
    }
    $('#loading-overlay').hidden = true;
    $('#app').inert = false;
    $('#app').setAttribute('aria-busy', 'false');
    $('#' + state.screen).focus({preventScroll:true});
  }

  function waitForSignal(milliseconds, signal) {
    if (!milliseconds) return Promise.resolve();
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, milliseconds);
      signal.addEventListener('abort', done, {once:true});
    });
  }

  async function loadTransition(title, record, duration = 420, initial = false, commit = null, audible = true, completionSound = 'out-02') {
    cancelLoading();
    const job = {controller:new AbortController(), decide:null, sound:audible ? window.RustedPrayerSfx?.beginLoad(completionSound) : null};
    state.loading = job;
    $('#app').inert = true;
    $('#app').setAttribute('aria-busy', 'true');
    $('#loading-overlay').hidden = false;
    $('#loading-title').textContent = title;
    $('#loading-cancel').hidden = initial;
    $('#loading-overlay').setAttribute('tabindex', '-1');
    $('#loading-overlay').focus();
    let failedAssets=[];
    try {
      while (!job.controller.signal.aborted) {
        $('#loading-retry').hidden = true;
        $('#loading-continue').hidden = true;
        const [result] = await Promise.all([
          media.preload(record, {signal:job.controller.signal, onProgress:({completed,total,failed}) => {
            if (state.loading !== job) return;
            const progress = $('#loading-progress');
            if (total) progress.value = Math.round(completed / total * 100);
            else progress.removeAttribute('value');
            $('#loading-status').textContent = total ? `미디어 준비 ${completed} / ${total}` : '기록 데이터 확인 완료';
            $('#loading-detail').textContent = failed ? `${failed}개 자료를 확인하지 못했습니다.` : total ? '현재 기록에 필요한 자료를 불러옵니다.' : '화면 신호 동기화 중';
          }}),
          waitForSignal(motionReduced() ? 0 : duration, job.controller.signal),
        ]);
        if (job.controller.signal.aborted || state.loading !== job) return false;
        failedAssets=result.failed;
        if (!result.failed.length) break;
        $('#loading-status').textContent = `${result.failed.length}개 미디어를 불러오지 못했습니다.`;
        $('#loading-detail').textContent = '다시 시도하거나 미디어 없이 기록을 계속 볼 수 있습니다.';
        $('#loading-retry').hidden = false;
        $('#loading-continue').hidden = false;
        $('#loading-retry').focus();
        const decision = await new Promise(resolve => { job.decide = resolve; });
        job.decide = null;
        if (decision === 'continue') break;
        if (decision !== 'retry') return false;
        job.sound=audible ? window.RustedPrayerSfx?.beginLoad(completionSound) : null;
      }
      if (job.controller.signal.aborted || state.loading !== job) return false;
      // Keep the opaque cover until the actual displayed image and destination are ready.
      const reveal=commit ? await commit(job.controller.signal,{failed:failedAssets}) : null;
      if (reveal === false) {
        if (state.loading === job) cancelLoading();
        return false;
      }
      if (job.controller.signal.aborted || state.loading !== job) return false;
      await window.RustedPrayerSfx?.finishLoad(job.sound,{signal:job.controller.signal});
      if (job.controller.signal.aborted || state.loading !== job) return false;
      if(typeof reveal==='function' && reveal()===false) {cancelLoading();return false;}
      state.loading = null;
      $('#loading-overlay').hidden = true;
      $('#app').inert = false;
      $('#app').setAttribute('aria-busy', 'false');
      if (commit) $('#' + state.screen).focus({preventScroll:true});
      return true;
    } catch (error) {
      if (state.loading === job) cancelLoading();
      return false;
    }
  }

  async function restoreView(view) {
    if (syncResetFromStorage()) return;
    if (view?.screen==='settings-screen' && ['story-screen','transition-screen'].includes(state.screen)) rememberSettingsPlayback();
    const settingsReturn=state.screen==='settings-screen' && state.settingsPlaybackReturn;
    cancelLoading();
    clearPlaybackTimers();
    state.auto = false; state.isTyping = false; state.uiHidden = false;
    state.transition = null;
    updateAutoButton();
    setLogOpen(false);
    if (!view?.rustedPrayer) return;
    if ((view.resetGeneration || 0) !== (state.progress.resetGeneration || 0)) {
      selectReadingPosition(); showScreen('archive-screen','replace'); return;
    }
    view=migrateDView(view);
    state.reportContext=validReportContext(view.reportContext)?{...view.reportContext}:null;
    const record = archive.getRecord(view.recordId);
    if (record && isRecordUnlocked(record)) {
      state.selectedRecordId = record.id;
      state.archiveRecordKind=view.archiveRecordKind || (record.relatedReport ? 'related' : 'main');
      selectDisk(record.diskId, false);
    } else selectReadingPosition();
    if (view.screen === 'story-screen' && isRecordUnlocked(record)) {
      const oldPosition = view.presentationVersion === 4 ? view.lineIndex : Math.max(0, (view.lineIndex || 0) - (record.introSceneCount || 0));
      const position = view.dPositionCurrent || view.presentationVersion >= 24 ? view.lineIndex : view.presentationVersion === 23 ? record.v23IndexMap?.[view.lineIndex] ?? view.lineIndex : view.presentationVersion === 22 ? record.v22IndexMap?.[view.lineIndex] ?? view.lineIndex : view.presentationVersion === 21 ? record.v21IndexMap?.[view.lineIndex] ?? view.lineIndex : view.presentationVersion >= 19 ? record.v20IndexMap?.[view.lineIndex] ?? view.lineIndex : view.presentationVersion === 18 ? record.v18IndexMap?.[view.lineIndex] ?? view.lineIndex : view.presentationVersion === 17 ? record.v17IndexMap?.[view.lineIndex] ?? view.lineIndex : view.presentationVersion === 16 ? record.v16IndexMap?.[view.lineIndex] ?? view.lineIndex : view.presentationVersion === 15 ? record.v15IndexMap?.[view.lineIndex] ?? view.lineIndex : view.presentationVersion === 14 ? record.v14IndexMap?.[view.lineIndex] ?? view.lineIndex : view.presentationVersion === 13 ? record.v13IndexMap?.[view.lineIndex] ?? view.lineIndex : (view.presentationVersion === 12 || view.presentationVersion === 11 && record.v12IndexMap) ? record.v12IndexMap?.[view.lineIndex] ?? view.lineIndex : view.presentationVersion === 11 ? record.v11IndexMap?.[view.lineIndex] ?? view.lineIndex : view.presentationVersion === 10 ? record.v10IndexMap?.[view.lineIndex] ?? view.lineIndex : view.presentationVersion === 9 ? record.v9IndexMap?.[view.lineIndex] ?? view.lineIndex : view.presentationVersion === 8 ? record.v8IndexMap?.[view.lineIndex] ?? view.lineIndex : view.presentationVersion === 7 ? record.v7IndexMap?.[view.lineIndex] ?? view.lineIndex : view.presentationVersion === 6 ? record.v6IndexMap?.[view.lineIndex] ?? 0 : view.presentationVersion === 5 ? record.v5IndexMap?.[view.lineIndex] ?? 0 : record.v4IndexMap?.[oldPosition] ?? 0;
      if (record.readerMode === 'report') {
        await openObjective('replace');
        $('#report-section-'+position)?.scrollIntoView?.({block:'start'});
      } else {
        const target=record.id==='B-03' && view.presentationVersion===24 && view.b03LayoutVersion!==1 ? record.v24IndexMap[position]??0
          : record.id==='D-11' && view.presentationVersion===24 && view.d05LayoutVersion!==1 ? record.v24IndexMap[position]??0
          : record.id==='B-07' && view.presentationVersion===24 && view.b07LayoutVersion!==1 ? record.v24IndexMap[position]??0
          : record.id==='C-03' && view.presentationVersion===24 && view.c03LayoutVersion!==1 ? record.v24IndexMap[position]??0
          : record.id==='D-06' && view.presentationVersion===24 && view.d04LayoutVersion!==1 ? record.v24IndexMap[position]??0
          : record.id==='C-02' && view.c02LayoutVersion!==1 ? c02Position(position) : position;
        const page=Number.isInteger(view.telemetryPage) && view.presentationVersion>=24 ? view.telemetryPage
          : recordProgress(record.id).lineIndex===target ? recordProgress(record.id).telemetryPage : 0;
        await startStory(false,target,'none',null,page);
      }
    } else if (view.screen === 'transition-screen' && recordProgress(currentRecord().id).completed) {
      const next = continuousNext(currentRecord());
      if (next) {
        if (view.transitionPaused===true) state.auto=view.transitionAuto===true;
        openRecordTransition(currentRecord(), next, 'none',view.transitionPaused===true);
      }
      else { renderCompletion(currentRecord()); showScreen('complete-screen', 'none'); }
    } else if (view.screen === 'settings-screen') {
      state.settingsStartRecordId=view.settingsStartRecordId===currentRecord()?.id && currentRecord()?.readerMode!=='report' ? view.settingsStartRecordId : null;
      renderSettings(); showScreen('settings-screen','none');
    }
    else if (view.screen === 'library-screen') { renderLibrary(); showScreen('library-screen','none'); }
    else if (view.screen === 'gallery-screen') {renderGallery();showScreen('gallery-screen','none');}
    else if (view.screen === 'ending-screen' && allRecordsRead()) await openEnding('none',view.endingFromGallery===true);
    else if (view.screen === 'objective-screen' && isRecordUnlocked(record)) await openObjective('none');
    else if (view.screen === 'complete-screen' && recordProgress(currentRecord().id).completed) {
      renderCompletion(currentRecord()); showScreen('complete-screen', 'none');
    } else showScreen(view.screen === 'boot-screen' ? 'boot-screen' : 'archive-screen', 'none');
    if (settingsReturn && state.screen===settingsReturn.screen &&
      state.selectedRecordId===settingsReturn.recordId && state.lineIndex===settingsReturn.lineIndex &&
      (state.progress.resetGeneration || 0)===settingsReturn.resetGeneration) {
      state.auto=settingsReturn.auto;
      updateAutoButton();
      scheduleAutoAdvance();
    }
  }

  function goBack() {
    if (state.screen === 'reset-screen') { cancelReset(); return; }
    if (state.loading) { cancelLoading(); return; }
    clearPlaybackTimers();
    state.auto = false; updateAutoButton();
    if(state.screen==='objective-screen' && currentRecord()?.relatedReport && validReportContext()) {returnReportMain();return;}
    // Closing a record follows its screen hierarchy, independent of previously visited records.
    if (state.screen === 'story-screen') openObjective('replace');
    else if (state.screen === 'objective-screen' || state.screen === 'complete-screen') {
      rememberReportPosition();saveProgress();state.reportContext=null;
      selectDisk(currentRecord().diskId);
      showScreen('archive-screen', 'replace');
    }
    else if (state.screen === 'archive-screen' || state.screen === 'boot-screen') return;
    else if (history.state?.rustedPrayer && history.state.depth > 0) history.back();
    else showScreen('archive-screen', 'replace');
  }

  function renderDisks() {
    const all = mainRecords;
    $("#archive-progress").textContent = `전체 ${all.filter(record => recordProgress(record.id).completed).length} / ${all.length} 기록 열람`;
    $("#disk-list").innerHTML = archive
      .getDisks()
      .map((disk) => {
        const records = archive.getRecordsByDisk(disk.id).filter(record=>!record.relatedReport);
        const available = disk.available !== false && records.some(isRecordUnlocked);
        const selected = disk.id === state.selectedDisk;
        const completed = records.filter((record) => recordProgress(record.id).completed).length;
        const progressLabel = available ? `${completed}/${records.length} 열람` : '이전 디스크 완료 후 해제';

        return `
          <button
            class="disk ${selected ? "is-selected" : ""} ${available ? "" : "is-locked"}"
            data-disk="${escapeHtml(disk.id)}"
            type="button"
            aria-pressed="${selected}"
            aria-disabled="${!available}"
            ${available ? '' : 'disabled'}
          >
            <span class="disk-state">${escapeHtml(progressLabel)}</span>
            <span class="disk-shutter" aria-hidden="true"></span>
            <span class="disk-label">
              <strong>디스크 ${escapeHtml(disk.id)}</strong>
              <span>${available ? escapeHtml(disk.label) : '잠김'}</span>
              <small>${available ? escapeHtml(disk.subtitle) : '순차 복구 대기'}</small>
            </span>
          </button>
        `;
      })
      .join("");

    // These attributes also describe the playback screen. Bind only archive
    // cards; binding the stage on every render multiplies click handlers.
    $('#disk-list').querySelectorAll("[data-disk]").forEach((button) => {
      button.addEventListener("click", () => selectDisk(button.dataset.disk));
    });
  }

  function selectDisk(id, remember = true) {
    const disk = archive.getDisk(id);
    if (!disk || disk.available === false || !archive.getRecordsByDisk(id).some(isRecordUnlocked)) return;

    if(id!=='D')state.archiveRecordKind='main';
    const records = archive.getRecordsByDisk(id).filter(record=>Boolean(record.relatedReport)===(id==='D' && state.archiveRecordKind==='related'));
    state.selectedDisk = id;
    renderDisks();
    $("#disk-integrity").textContent = `${records.length}개 기록 / ${disk.status}`;
    $("#disk-summary").innerHTML = `
      <p class="eyebrow">디스크 ${escapeHtml(disk.id)} / ${escapeHtml(disk.label)}</p>
      <h2>${escapeHtml(disk.subtitle)}</h2>
      <p>${escapeHtml(disk.description || "복구된 설명이 없습니다.")}</p>
      <details class="volume-document"><summary>매체 정보</summary>${renderDocument(disk.sourceDocument || [])}</details>
    `;
    $('#archive-media-info').innerHTML=$('#disk-summary').innerHTML;
    $('#d-record-switch').hidden=id!=='D';
    $('#d-record-hint').hidden=id!=='D';
    $('#resume-d-main').hidden=id!=='D' || state.archiveRecordKind!=='related';
    const dResume=dMainResumeRecord();
    $('#resume-d-main').textContent=dResume ? '본편 이어보기' : 'D편 본편 보기';
    $('#d-record-hint').textContent=state.archiveRecordKind==='related' ? '장면 진행에 따라 추가되는 자료입니다. 읽지 않아도 본편을 계속 볼 수 있습니다.' : '대화와 기억 재생을 따라 읽습니다. 상세 자료는 관련 보고서에서 볼 수 있습니다.';
    if(id==='D' && state.archiveRecordKind==='related' && !dResume)$('#d-record-hint').textContent+=' '+D_MAIN_GUIDANCE;
    $('#d-record-switch').querySelectorAll('[data-kind]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.kind===state.archiveRecordKind)));

    if (disk.available === false || !records.length) {
      state.selectedRecordId = null;
      $("#record-list").innerHTML = `<div class="empty-state">복구 가능한 파일 없음</div>`;
      renderRecordDetail(null);
      return;
    }

    const selectedRecord = records.some((record) => record.id === state.selectedRecordId && isRecordUnlocked(record))
      ? state.selectedRecordId
      : (records.find(record => isRecordUnlocked(record) && !recordProgress(record.id).completed) || records[0]).id;
    state.selectedRecordId = selectedRecord;
    renderRecordList(records);
    renderRecordDetail(currentRecord());
    if (remember && state.screen === 'archive-screen' && archiveMobileQuery.matches) moveArchivePane(1);
    if (remember && state.screen === 'archive-screen') rememberView();
  }

  function renderRecordList(records = archive.getRecordsByDisk(state.selectedDisk).filter(record=>Boolean(record.relatedReport)===(state.selectedDisk==='D' && state.archiveRecordKind==='related'))) {
    $("#record-list").innerHTML = records
      .map((record) => {
        const progress = recordProgress(record.id);
        const unlocked = isRecordUnlocked(record);
        return `
          <button class="record-row ${record.id === state.selectedRecordId ? "is-selected" : ""} ${unlocked ? '' : 'is-locked'}" type="button" data-record="${escapeHtml(record.id)}" aria-disabled="${!unlocked}" ${unlocked ? '' : 'disabled'}>
            <span class="record-index">${escapeHtml(recordNumber(record))}</span>
            <span class="record-name">
              <strong>${unlocked ? escapeHtml(record.fileName) : '잠긴 기록'}</strong>
              <small>${unlocked ? escapeHtml(record.title || record.type) : `${escapeHtml(recordNumber(archive.getRecord(record.unlockAfter || record.previousId)))} 열람 완료 후 해제`}</small>
            </span>
            <span class="record-progress">${!unlocked ? '잠김' : progress.completed ? "열람 완료" : '열람 가능'}</span>
          </button>
        `;
      })
      .join("");

    $('#record-list').querySelectorAll("[data-record]").forEach((button) => {
      button.addEventListener("click", () => selectRecord(button.dataset.record));
    });
  }

  function selectRecord(id) {
    if (!isRecordUnlocked(archive.getRecord(id))) return;
    state.selectedRecordId = id;
    renderRecordList();
    renderRecordDetail(currentRecord());
    if (state.screen === 'archive-screen') rememberView();
  }

  function renderRecordDetail(record) {
    renderArchiveOpenBar(record);
    if (!record) {
      $("#record-state").textContent = "미복구";
      $("#record-detail").innerHTML = `<div class="empty-state">열람할 기록을 선택하세요.</div>`;
      return;
    }

    const progress = recordProgress(record.id);
    const hasStory = record.story.length > 0;
    $("#record-state").textContent = progress.completed ? "열람 완료" : record.status;
    $("#record-detail").innerHTML = `
      <p class="detail-code">${escapeHtml(recordNumber(record))}</p>
      <h2>${escapeHtml(record.title || record.fileName)}</h2>
      <p class="detail-filename">${escapeHtml(record.fileName)}</p>
      ${record.sample ? '<p class="eyebrow">구조 검증용 발췌</p>' : ""}
      <dl class="metadata-list">
        <div><dt>데이터 무결성</dt><dd>${escapeHtml(record.integrity)}</dd></div>
        <div><dt>데이터 크기</dt><dd>${escapeHtml(record.dataSize)}</dd></div>
      </dl>
      <button id="open-record" class="button button-primary" type="button">기록 열기</button>
    `;
    $("#open-record").addEventListener("click", () => openObjective());
  }

  function renderArchiveOpenBar(record) {
    const available=record && isRecordUnlocked(record);
    $('#archive-selected-code').textContent=available ? recordNumber(record) : '기록 미선택';
    $('#archive-selected-title').textContent=available ? record.title || record.fileName : '열람할 기록을 선택하세요.';
    $('#archive-open-record').disabled=!available;
    $('#archive-open-record').setAttribute('aria-label',available ? `${recordNumber(record)} 기록 열기` : '기록 열기');
  }

  function updateArchiveTabs() {
    const mobile=archiveMobileQuery.matches;
    archivePanelIds.forEach((id,index)=>{
      const panel=$('#'+id), tab=$('#archive-tab-'+index), selected=index===state.archivePane;
      panel.inert=mobile && !selected;
      if (mobile) {
        panel.setAttribute('role','tabpanel');
        panel.setAttribute('aria-labelledby',tab.id);
        panel.setAttribute('aria-hidden',String(!selected));
        panel.setAttribute('tabindex',selected ? '0' : '-1');
      } else {
        panel.removeAttribute('role');
        panel.removeAttribute('aria-hidden');
        panel.removeAttribute('tabindex');
        if (index===0) panel.removeAttribute('aria-labelledby');
        else panel.setAttribute('aria-labelledby',index===1 ? 'record-list-title' : 'detail-title');
      }
      tab.setAttribute('aria-selected',String(selected));
      tab.setAttribute('tabindex',selected ? '0' : '-1');
    });
  }

  function syncArchiveTools() {
    $('#archive-screen').dataset.toolsOpen=String(state.archiveToolsOpen);
    $('#archive-tools-toggle').setAttribute('aria-expanded',String(state.archiveToolsOpen));
  }

  function syncArchiveLayout() {
    updateArchiveTabs();
    syncArchiveTools();
    const layout=$('#archive-layout');
    if (state.screen!=='archive-screen' || !layout.clientWidth) return;
    // Resize and screen return restore the same page; inner panel scroll stays.
    layout.scrollTo({left:archiveMobileQuery.matches ? layout.clientWidth*state.archivePane : 0,behavior:'instant'});
  }

  function moveArchivePane(index, focusTab=false) {
    if (!archiveMobileQuery.matches) return;
    state.archivePane=Math.max(0,Math.min(2,index));
    updateArchiveTabs();
    if (focusTab) $('#archive-tab-'+state.archivePane).focus({preventScroll:true});
    const layout=$('#archive-layout');
    if (layout.clientWidth) layout.scrollTo({left:layout.clientWidth*state.archivePane,behavior:motionReduced() ? 'instant' : 'smooth'});
  }

  function stripTechnicalMetadata(value, state = {skipValue:false}) {
    const kept=[];
    for (const rawLine of String(value || '').split(/\r?\n/)) {
      if (state.skipValue) { state.skipValue=false; continue; }
      const metadata=rawLine.match(/^\s*(해상도|출처)\s*:\s*(.*)$/);
      if (metadata) { state.skipValue=!metadata[2].trim(); continue; }
      kept.push(rawLine);
    }
    return kept.join('\n').replace(/\n{3,}/g,'\n\n').trim();
  }

  function visibleRows(rows) {
    const metadataState={skipValue:false};
    return rows.map(row=>({...row,text:stripTechnicalMetadata(row.text,metadataState)})).filter(row=>row.text);
  }

  function renderDocument(items, introduction = false) {
    const metadataState={skipValue:false};
    let groupOpen=false;
    const closeGroup=()=>{
      if (!groupOpen) return '';
      groupOpen=false;
      return '</div>';
    };
    const content=items.map(item => {
      if (item.type === 'separator') return closeGroup()+'<hr class="document-rule">';
      const text=stripTechnicalMetadata(item.text,metadataState);
      if (!text) return '';
      let prefix='';
      if (introduction) {
        if (item.type === 'stamp') prefix=closeGroup();
        else {
          // A new field starts a group; its value and following explanation stay together.
          if (/^[^\n:：]{1,40}\s*[:：]/u.test(text)) prefix=closeGroup();
          if (!groupOpen) { prefix+='<div class="intro-group">'; groupOpen=true; }
        }
      }
      const body=introduction ? escapeHtml(text).replace(/\b(?:UNIT|DRONE)-\d{2}\b/g,token=>`<span class="intro-token">${token}</span>`) : escapeHtml(text);
      return prefix+`<p class="objective-line ${escapeHtml(item.type || 'text')}">${body}</p>`;
    }).join('');
    return content+closeGroup();
  }

  function openObjective(historyMode = 'push') {
    const record=currentRecord();if(!record || !isRecordUnlocked(record))return;
    if(record.readerMode!=='report' || !media.assetsFor(record).some(asset=>asset.type==='image'))return renderObjective(historyMode);
    return prepareReport(record,historyMode);
  }

  async function prepareReport(record,historyMode) {
    const previous={recordId:['objective-screen','story-screen'].includes(state.screen)?state.presentedRecordId:record.id,screen:state.screen,lineIndex:state.lineIndex,context:state.reportContext?{...state.reportContext}:null,scrollTop:window.scrollY || 0};
    const ready=await loadTransition('기록 자료 준비',record,0,false,async(signal,{failed})=>{
      const reveal=renderObjective(historyMode,false);
      const unavailable=new Set(failed.filter(asset=>asset.type==='image').map(asset=>media.url(asset.src)));
      let abort;
      const cancelled=new Promise(resolve=>{abort=()=>resolve(false);signal.addEventListener('abort',abort,{once:true});});
      try {
        const images=[...$('#objective-body').querySelectorAll('img')];
        const decoded=Promise.all(images.map(async image=>{
          try {if(unavailable.has(image.src))throw Error('unavailable');if(image.decode)await image.decode();}
          catch {if(signal.aborted)return;image.hidden=true;image.parentElement?.insertAdjacentHTML?.('beforeend','<p class="report-image-unavailable">이미지를 불러오지 못했습니다.</p>');}
        })).then(()=>true);
        if(!await Promise.race([decoded,cancelled]) || signal.aborted)return false;
        return reveal;
      }finally{signal.removeEventListener('abort',abort);}
    },false);
    if(!ready && state.screen===previous.screen) {
      const original=archive.getRecord(previous.recordId);state.reportContext=previous.context;
      if(original){state.selectedRecordId=original.id;state.archiveRecordKind=original.relatedReport?'related':'main';state.lineIndex=previous.lineIndex;
        if(previous.screen==='objective-screen'){renderObjective('none');window.scrollTo({top:previous.scrollTop,behavior:'instant'});}
      }
    }
    return ready;
  }

  function renderObjective(historyMode = 'push',reveal = true) {
    const record = currentRecord();
    if (!isRecordUnlocked(record)) return;

    const progress = recordProgress(record.id);
    const hasStory = record.story.length > 0;
    $('#objective-related-reports').hidden=record.diskId!=='D' || record.relatedReport;
    $('#objective-screen').classList.toggle('epilogue-reader',Boolean(record.epilogue));
    state.lineIndex = Math.min(Math.max(progress.lineIndex || 0, 0), Math.max((record.reportSections || record.story).length - 1, 0));

    $("#objective-code").textContent = recordNumber(record);
    $("#objective-title").textContent = record.fileName;
    $("#objective-source").textContent = '';
    $("#objective-integrity").textContent = `무결성 ${record.integrity}`;
    $("#objective-body").innerHTML = record.objective.length ? renderDocument(record.objective,record.readerMode !== 'report') : '<div class="reconstruction-notice"><span aria-hidden="true">⌖</span><p>재구성 가능한 기록을 확인했습니다.</p><small>장면 재구성을 시작하면 보존된 자료가 순서대로 표시됩니다.</small></div>';
    $("#objective-body").hidden = false;
    $("#analysis-list").innerHTML = record.analysis
      .map(([term, value]) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd></div>`)
      .join("");
    $("#analysis-card").hidden = false;
    $("#recommendation").hidden = !record.recommendation;
    $("#recommendation-text").textContent = record.recommendation;
    $("#start-story").classList.toggle("button-danger", Boolean(record.recommendation));
    $("#start-story").classList.toggle("button-primary", !record.recommendation);
    $("#restart-story").hidden = !hasStory || (!state.lineIndex && !progress.inProgress);
    $("#objective-code").textContent = `${recordNumber(record)} / ${record.title || ''}`;
    setLogOpen(false);
    const report = record.readerMode === 'report';
    $('#objective-screen').classList.toggle('report-reader', report);
    $('#objective-screen').classList.toggle('terminal-reader', report && record.reportStyle==='terminal');
    if (report) {
      $('#objective-title').textContent = record.title;
      $('#objective-body').innerHTML = record.reportSections.map((section,index) => `<section id="report-section-${index}" class="report-section${record.id==='C-00' && index===0 ? ' report-section-no-divider' : ''}">${record.id==='C-00' && section.attachmentImage ? '' : `<h2>${escapeHtml(section.cardTitle || '기록')}</h2>`}${renderSheet(section,index)}</section>`).join('') + `<footer class="report-end"><span>${record.epilogue ? '— 복구 기록의 끝 —' : '— 문서 끝 —'}</span><button id="report-finish" class="button button-primary" data-action="complete-report" type="button">${reportCompletionLabel(record)}</button>${record.relatedReport ? dMainReturnMarkup() : ''}</footer>`;
      if(record.reportStyle==='terminal') {
        $('#objective-title').textContent=record.fileName;
        $('#objective-body').innerHTML=renderTerminalReport(record);
      }
      $('#analysis-card').hidden = true;
      $('#start-story').hidden = true;
    } else $('#start-story').hidden = false;
    syncReadingSetupGuide();
    renderDReportBrowser();
    const finish=()=>{
      // Completed reports reopen at the top; interrupted readings keep their scroll position.
      const resumeScroll=progress.inProgress && Number.isFinite(progress.reportScroll) ? Math.max(0,progress.reportScroll) : 0;
      if(report && !record.relatedReport) {
        progress.inProgress=true;state.progress.resumeRecordId=record.id;
        if(record.diskId==='D')state.reportContext={recordId:record.id,screen:'objective-screen',lineIndex:state.lineIndex,scrollTop:resumeScroll,telemetryPage:0};
      }
      showScreen('objective-screen',historyMode);
      if(report && !record.relatedReport) {window.scrollTo({top:resumeScroll,behavior:'instant'});saveProgress();}
      return true;
    };
    return reveal?finish():finish;
  }

  function rememberArchiveScroll() {
    state.archiveScrollPositions[state.selectedDisk+':'+state.archiveRecordKind]={top:window.scrollY || 0,files:$('#archive-files-panel').scrollTop || 0,detail:$('#archive-detail-panel').scrollTop || 0};
  }
  function restoreArchiveScroll() {
    const saved=state.archiveScrollPositions[state.selectedDisk+':'+state.archiveRecordKind];
    $('#archive-files-panel').scrollTop=saved?.files || 0;
    $('#archive-detail-panel').scrollTop=saved?.detail || 0;
  }
  function renderDReportBrowser() {
    const record=currentRecord(),visible=record.diskId==='D' && record.readerMode==='report';
    $('#d-report-browser').hidden=!visible;$('#objective-screen').classList.toggle('d-report-folder',visible);
    if(!visible) {$('#d-report-tree').innerHTML='';return;}
    const reports=archive.getRecordsByDisk('D').filter(item=>item.readerMode==='report');
    $('#d-report-tree').innerHTML=[false,true].map(related=>`<h3>${related?'▾ 관련 보고서':'▾ 본편 문서'}</h3>`+reports.filter(item=>Boolean(item.relatedReport)===related).map(item=>{
      const unlocked=isRecordUnlocked(item),progress=recordProgress(item.id);
      return `<button type="button" data-action="open-d-report" data-report-id="${item.id}" ${unlocked?'':'disabled'} ${item.id===record.id?'aria-current="page"':''}>${escapeHtml(recordNumber(item))}<small>${unlocked?escapeHtml(item.title)+' · '+(progress.completed?'열람 완료':'열람 가능'):'잠긴 기록'}</small></button>`;
    }).join('')).join('');
  }

  function syncReadingSetupGuide() {
    const record=currentRecord(),progress=recordProgress(record.id);
    const playable=record.readerMode!=='report' && record.story.length>0;
    const first=playable && !state.progress.readingSetupSeen;
    $('#reading-setup-guide').hidden=!first;
    $('#objective-reading-settings').hidden=!playable || first;
    $('#dialogue-position-guide').hidden=!playable;
    $('#start-story').textContent=first ? '바로 읽기' : state.lineIndex>0 || progress.inProgress ? '이어 보기' : '재생하기';
  }

  function renderTerminalReport(record) {
    const lines=record.reportSections.map((section,index)=>{
      const text=section.text;
      const kind=text==='[스캔]' ? 'scan' : /우선순위.*(?:긴급|심각|최고)/.test(text) ? 'critical'
        : /우선순위.*높음/.test(text) ? 'priority' : /자동 제외할 수 없습니다|강제 재생/.test(text) ? 'override'
        : text.startsWith('시스템 :') ? 'system' : text==='분석 대상에서 제외.' ? 'excluded' : 'output';
      const src=window.RustedPrayerMediaManifest?.attachments?.[record.id]?.[index];
      const label=text.startsWith('전투 행동 없음.') ? '미분류 기억 / UNIT-01 · UNIT-02' : text.split(' 확인.')[0];
      const attachment=src ? `<figure class="terminal-attachment"><img src="${escapeHtml(media.url(src))}" alt="${escapeHtml(label)}"><figcaption>첨부 이미지 / ${escapeHtml(label)}</figcaption></figure>` : '';
      return `<section id="report-section-${index}" class="terminal-log-line" data-kind="${kind}"><span class="terminal-line-number" aria-hidden="true">&gt;</span><div><p>${escapeHtml(text)}</p>${attachment}</div></section>`;
    }).join('');
    return `<div class="terminal-command"><span>RECOVERY&gt; type ${escapeHtml(record.fileName)}</span><span class="terminal-session-state">복구 로그</span></div><div class="terminal-preamble">${renderDocument(record.objective)}</div><div class="terminal-output" aria-label="스캔 출력 기록">${lines}</div><footer class="report-end terminal-end"><span>출력 종료 <span class="terminal-cursor" aria-hidden="true">▌</span></span><button id="report-finish" class="button button-primary" data-action="complete-report" type="button">${reportCompletionLabel(record)}</button></footer>`;
  }

  function handleObjectiveAction() {
    const record = currentRecord();
    if (!isRecordUnlocked(record)) return;
    if (record.readerMode === 'report') return;
    startStory();
  }

  async function startStory(restart = false, resumeIndex = null, historyMode = 'push', nextRecord = null, resumePage = null) {
    if (syncResetFromStorage()) return;
    const record = nextRecord || currentRecord();
    if (!record?.story.length || !isRecordUnlocked(record)) return;

    const progress = recordProgress(record.id);
    if (!await loadTransition('인지 기록 동기화', record, 420, false, null, historyMode!=='none')) return;
    state.progress.readingSetupSeen=true;
    resetACameraVisit();
    standingCameraVisit=null;
    const position = Number.isInteger(resumeIndex) ? resumeIndex : restart ? 0 : progress.lineIndex;
    state.lineIndex = Math.max(0, Math.min(position || 0, record.story.length - 1));
    state.telemetryPage = !restart && Number.isInteger(resumePage) ? Math.max(0,resumePage)
      : !restart && !Number.isInteger(resumeIndex) && Number.isInteger(progress.telemetryPage) ? Math.max(0,progress.telemetryPage) : 0;
    state.telemetryLineIndex = state.lineIndex;
    resumePresentation=!restart && (progress.inProgress || state.lineIndex>0 || Number.isInteger(resumeIndex))
      ? {recordId:record.id,index:state.lineIndex,page:state.telemetryPage} : null;
    progress.inProgress = true;
    state.selectedRecordId = record.id;
    if (nextRecord) {
      state.transition = null;
      state.transitionPaused = false;
      selectDisk(record.diskId, false);
    }
    state.uiHidden = false;
    state.menuOpen=false;
    $("#story-stage").classList.remove("ui-hidden");
    $("#story-source").textContent = record.storySource;
    $('#story-related-reports').hidden=record.diskId!=='D';
    $("#story-reliability").textContent = record.reliability;
    // New playback honors the saved choice; settings restore their own prior state.
    if (!nextRecord && historyMode !== 'none' && state.screen !== 'library-screen') {
      state.auto ||= state.rememberAuto && state.autoEnabled;
    }
    updateAutoButton();
    showScreen("story-screen", historyMode);
    renderLine();
  }

  function getActiveVisual(index) {
    const record = currentRecord();
    const story = currentStory();
    for (let current = index; current >= 0; current -= 1) {
      if (story[current]?.visual) return story[current].visual;
    }
    return record.defaultVisual;
  }

  function getSpeakerTheme(line) {
    return line.speakerTheme || SPEAKER_THEMES[line.speaker] || "neutral";
  }

  function clearPlaybackTimers() {
    clearTimeout(state.autoTimer);
    clearTimeout(state.typeTimer);
    state.autoTimer = null;
    state.typeTimer = null;
    clearTimeout(state.gateTimer);
    state.gateTimer = null;
    state.advanceLocked = false;
  }

  function scheduleAutoAdvance() {
    clearTimeout(state.autoTimer);
    if (state.loading || document.hidden || !state.auto || !$('#profile-overlay').hidden) return;
    if (state.screen === 'transition-screen' && state.transition) {
      if (state.transitionPaused) return;
      const next = archive.getRecord(state.transition.toId);
      const length = next.objective.map(item => item.text || '').join('').length + next.title.length;
      state.autoTimer = setTimeout(continueRecordTransition, Math.max(4000, Math.min(24000, length * 85 * speedFactor(state.autoSpeed))));
      return;
    }
    if (state.screen !== 'story-screen') return;
    if (!state.auto || state.isTyping || state.advanceLocked || state.attachmentPending) return;
    if (state.menuOpen || !$("#backlog").hidden || $('#story-options').open || state.uiHidden || document.hidden) return;
    const story=currentStory(),line=story[state.lineIndex],next=story[state.lineIndex+1];
    const chatEnd=line?.tone==='chat' && (!next || next.tone!=='chat' || next.channel!==line.channel || next.session!==line.session);
    const delay = Math.max(250,readingDuration(state.fullText,line)-state.typingCredit,line?.autoPause || 0) + (line?.readingBeat?.extraAutoDelay || 0) + (chatEnd ? 1000 : 0);
    state.autoTimer = setTimeout(() => nextLine(true), delay);
  }

  function finishTyping() {
    clearTimeout(state.typeTimer);
    if (state.typingTarget) writeTypedText(state.typingTarget,state.fullText);
    state.typeTimer = null;
    state.isTyping = false;
    revealDecision();
    scheduleAutoAdvance();
  }

  function writeTypedText(target, text) {
    if (target.id === 'telemetry-text') {
      const authoredLines=currentStory()[state.lineIndex]?.preserveTelemetryLines;
      target.textContent=authoredLines ? String(text || '') : String(text || '').replace(/(?<=[.!?。])\s+/gu,'\n');
      return;
    }
    if (target.id !== 'dialogue-text') { target.textContent=text; return; }
    // Reserve complete sentences during typing; wrapping prefers a sentence boundary.
    let offset=0;
    target.innerHTML=state.fullText.split(/(?<=[.!?。])\s+/u).map(sentence=> {
      const start=state.fullText.indexOf(sentence,offset);
      offset=start+sentence.length;
      const shown=sentence.slice(0,Math.max(0,text.length-start));
      const ink=value=>escapeHtml(value).replace(/·+/g,match=>`<span class="ellipsis">${match}</span>`);
      return `<span class="spoken-sentence"><span class="sentence-measure" aria-hidden="true">${ink(sentence)}</span><span class="sentence-ink">${ink(shown)}</span></span>`;
    }).join(' ');
  }

  function startTypewriter(target, text) {
    state.typingTarget = target;
    state.fullText = text || "";
    state.typingCredit = 0;
    state.isTyping = Boolean(state.fullText);
    writeTypedText(target, "");

    if (state.instant) { finishTyping(); return; }

    if (!state.fullText) {
      finishTyping();
      return;
    }

    let index = 0;
    let wait = 120;
    const typeNext = () => {
      if (!state.isTyping) return;
      if (state.screen==='story-screen' && !state.menuOpen && !document.hidden && !state.uiHidden && $('#backlog').hidden && $('#profile-overlay').hidden && !$('#story-options').open) state.typingCredit+=wait;
      index += 1;
      writeTypedText(target,state.fullText.slice(0, index));

      if (index >= state.fullText.length) {
        state.isTyping = false;
        state.typeTimer = null;
        revealDecision();
        scheduleAutoAdvance();
        return;
      }

      const character = state.fullText[index - 1];
      const delay = /[.!?·。]/.test(character) ? 105 : character === " " ? 18 : 34;
      wait=Math.round(delay * speedFactor(state.textSpeed));
      state.typeTimer = setTimeout(typeNext, wait);
    };

    state.typeTimer = setTimeout(typeNext, 120);
  }

  function configureCutscene(line) {
    const cutscene = {...line.cutscene};
    const shot=activeCutsceneShot || window.RustedPrayerVisuals.resolve(currentRecord(),state.lineIndex,getActiveVisual(state.lineIndex));
    cutscene.src = shot.src || cutscene.src;
    const image = $("#memory-image");
    $('.cutscene-copy').hidden=line.silentMemory===true;
    $('#memory-kind').hidden=line.silentMemory===true;
    $('#memory-asset-label').hidden=line.silentMemory===true;
    const placeholder = $("#memory-placeholder");
    const hasImage = Boolean(cutscene.src);
    image.setAttribute('style',cameraStyle(shot));
    delete image.dataset.geometry;

    image.hidden = !hasImage;
    placeholder.hidden = hasImage;
    $("#memory-kind").textContent = cutscene.label || (line.tone === "memory" ? "기억 파편" : "장면 재구성");
    $("#memory-asset-label").textContent = cutscene.assetLabel || recordNumber(currentRecord());

    if (hasImage) {
      image.src = media.url(cutscene.src);
      image.alt = shot.alt;
    } else {
      image.removeAttribute("src");
      image.alt = "";
    }
  }

  function revealPage(text) {
    state.typingTarget = null;
    state.fullText = text;
    state.typingCredit = 0;
    state.isTyping = false;
    scheduleAutoAdvance();
  }

  function signalImageSwap(surface, key, restoring = false) {
    if (surface.dataset.swapKey === key) return;
    surface.dataset.swapKey = key;
    surface.dataset.swap = '';
    if (!key || restoring) return;
    surface.dataset.swapCount = String((Number(surface.dataset.swapCount) || 0) + 1);
    if (motionReduced()) return;
    void surface.offsetWidth;
    surface.dataset.swap = state.effectsReduced ? 'soft' : 'glitch';
  }

  function renderResearchMedia(shot) {
    const viewport = $('#lab-monitor-viewport');
    const view = shot.monitorView;
    const key = JSON.stringify([currentRecord().id,view]);
    if (viewport.dataset.media !== key) {
      viewport.dataset.media = key;
      viewport.innerHTML = view ? `<div class="lab-source-grid" data-layout="${escapeHtml(view.layout)}" data-active="${view.active}" data-damaged="${view.damaged}">${view.images.map((image,index)=>`<figure class="lab-source" data-source="${index}"><img class="research-image" draggable="false" src="${escapeHtml(media.url(image.src))}" alt="${escapeHtml(image.alt)}" style="${cameraStyle(image)}"><figcaption>${escapeHtml(image.label)}</figcaption></figure>`).join('')}</div>` : '';
    }
    // Labels and dialogue changes do not replay the image transition.
    const compact = window.matchMedia('(max-width:760px)').matches;
    const shown = view?.layout === 'camera-memory' && compact ? [view.images[view.active]] : view?.images;
    signalImageSwap(viewport,shown ? JSON.stringify(shown.map(image=>[image.src,image.fit,image.zoom,image.focus])) : '',Boolean(shot.resumeCamera));
    const preview = $('#scan-preview');
    preview.hidden = !shot.scanPreview;
    if (shot.scanPreview) {
      const image = $('#scan-preview-image');
      const src = media.url(shot.scanPreview.src);
      if (image.src !== src) image.src = src;
      image.hidden = false;
      image.alt = shot.scanPreview.alt;
      $('#scan-preview-label').textContent = shot.scanPreview.label;
    }
    signalImageSwap(preview,shot.scanPreview ? JSON.stringify([currentRecord().id,shot.scanPreview.src]) : '',Boolean(shot.resumeCamera));
    signalImageSwap($('#scene-art'),shot.swapEffect && !$('#scene-art').hidden ? JSON.stringify([currentRecord().id,shot.src,shot.fit,shot.zoom,shot.focus]) : '',Boolean(shot.resumeCamera));
  }

  function renderSheet(line, sceneIndex = state.lineIndex) {
    if(line.reportTable)return `<div class="report-table-scroll"><table class="report-data-table" data-kind="${escapeHtml(line.reportTable.kind || '')}" aria-label="${escapeHtml(line.cardTitle || '비교 표')}"><thead><tr>${line.reportTable.columns.map(text=>`<th scope="col">${escapeHtml(text)}</th>`).join('')}</tr></thead><tbody>${line.reportTable.rows.map(row=>`<tr><th scope="row">${escapeHtml(row[0])}</th><td>${escapeHtml(row[1])}</td></tr>`).join('')}</tbody></table></div>`;
    if (line.columns) return `<div class="comparison-grid">${line.columns.map((column, index) => {
      const src=window.RustedPrayerMediaManifest?.comparisons?.[currentRecord().id]?.[index];
      return `<article class="comparison-column"><span class="eyebrow">${escapeHtml(column.label)}</span><div class="comparison-field ${src ? 'has-image d-image-surface' : ''}" data-swap="${src && !motionReduced() ? state.effectsReduced ? 'soft' : 'glitch' : ''}">${src ? `<img class="real-art" src="${escapeHtml(media.url(src))}" alt="${escapeHtml(column.alt || recordNumber(currentRecord()).toLowerCase()+'-'+String(index+1).padStart(2,'0')+' 이미지')}">` : `<span>${index ? '관측 자료' : '시험 자료'}</span><i></i>`}</div><p>${escapeHtml(column.text)}</p></article>`;
    }).join('')}</div>${currentRecord().id==='D-10' ? '' : '<p class="comparison-note">보존된 판독문을 대조합니다.</p>'}`;
    const decision=line.request ? `<footer class="decision-footer"><span id="decision-stamp" class="decision-stamp" data-decision="${escapeHtml(line.decision)}" ${line.typeRequest ? 'hidden' : ''}>${escapeHtml(line.decision)}</span></footer>` : '';
    if (currentRecord().id==='A-06' && line.request) {
      const item=line.text.match(/요청 품목\s*:\s*([\s\S]*?)(?=\s*수량\s*:)/)?.[1]?.trim() || line.rows[0].text;
      const quantity=line.text.match(/수량\s*:\s*([\s\S]*?)(?=\s*결과\s*:)/)?.[1]?.trim() || '';
      return `<div class="supply-request"><div class="request-row"><strong>요청 품목</strong><div class="request-value"><p class="request-measure" aria-hidden="true">${escapeHtml(item)}</p><p id="request-typewriter">${line.typeRequest ? '' : escapeHtml(item)}</p></div></div><div class="request-row"><strong>수량</strong><p>${escapeHtml(quantity)}</p></div>${decision}</div>`;
    }
    const attachment=Boolean(line.attachmentImage || window.RustedPrayerMediaManifest?.attachments?.[currentRecord().id]?.[sceneIndex]);
    const rows=visibleRows(line.rows || [{text:line.text}]).map((row,index) => {
      if(row.type==='handwriting-heading') return `${decision}<h3 class="handwriting-heading">${escapeHtml(row.text)}</h3>`;
      if(row.type==='section-heading') return `<h3 class="sheet-heading">${escapeHtml(row.text)}</h3>`;
      const theme = SPEAKER_THEMES[row.speaker] || 'neutral';
      if (line.typeRequest && index === 0) return '<p id="request-typewriter" class="sheet-row"></p>';
      if (line.typeRequest && /^결과/.test(row.text)) return '';
      return row.speaker ? `<div class="sheet-speech" data-speaker-theme="${theme}"><strong>${escapeHtml(row.speaker)}</strong><p>${escapeHtml(row.text)}</p></div>` : `<p class="sheet-row ${row.highlight ? 'is-emphasis' : ''}">${escapeHtml(row.text)}</p>`;
    }).join('');
    const attachmentLabel=(line.attachmentLabel || '대화 LOG').replace(/^첨부 기록\s*[·/]?\s*/, '');
    const image=attachment && currentRecord().epilogue ? `<figure class="repaired-unit-photo"><img src="${escapeHtml(media.url(window.RustedPrayerMediaManifest.attachments[currentRecord().id][sceneIndex]))}" alt="${escapeHtml(line.attachmentAlt)}"></figure>` : attachment ? artMarkup('cutscene', line, true, sceneIndex) : '';
    return `${image}${attachment ? `<section class="attachment-log"><span class="eyebrow">${escapeHtml(attachmentLabel)}</span>` : ''}${rows}${attachment ? '</section>' : ''}${line.hasHandwriting ? '' : decision}`;
  }

  function revealDecision() {
    if (currentStory()[state.lineIndex]?.typeRequest && $('#decision-stamp')) $('#decision-stamp').hidden=false;
  }

  function cameraStyle(shot) {
    const zoom = state.effectsReduced ? 1+(shot.zoom-1)*.3 : shot.zoom;
    return `--camera-zoom:${zoom};--camera-x:${shot.focus[0]}%;--camera-y:${shot.focus[1]}%;--camera-offset-x:${(50-shot.focus[0])*(zoom-1)}%;--camera-offset-y:${shot.focus[1]===100 ? -60 : 0}%;--camera-duration:${motionReduced() || shot.resumeCamera ? 0 : shot.duration}ms;object-fit:${shot.fit};`;
  }

  let activeCutsceneShot = null;
  let cutsceneGeometry = null;
  let aCameraVisit = null;
  let aCameraTimer = null;
  let aPathRun = null;
  let resumePresentation = null;
  // Reconstruct the settled framing from authored cues, not from animation time
  // or a saved pixel transform. This also works after reload and on older saves.
  function resumeCameraAt(record, index, page) {
    let visit=null;
    for(let at=0;at<=index;at++) {
      const line=record.story[at];
      const paged=line.instrument!=='scan' && (line.tone==='telemetry' || line.instrument==='drone');
      const pages=paged ? line.telemetryPages || telemetryPages(line.text) : [line.text];
      const last=at===index ? Math.min(page,pages.length-1) : pages.length-1;
      for(let part=0;part<=last;part++) {
        const shot=window.RustedPrayerVisuals.resolve(record,at,getActiveVisual(at),part);
        if(shot.mode!=='cutscene' || shot.zoom!==1 || shot.hideArt || shot.scanPreview
          || line.attachmentImage || ['memo','document','report','comparison','time','slate','status'].includes(line.tone))continue;
        const key=record.id+'|'+(shot.flashReturn || shot.src);
        if(visit?.key!==key)visit=shot.cameraContinuity && visit ? {...visit,key} : {key,phase:'overview'};
        if(shot.authoredCamera) {
          visit.authoredCamera=shot.authoredCamera;
          visit.authoredId=shot.authoredCamera.id;
          visit.phase=shot.authoredCamera.hold ? 'focus' : 'overview';
        }
        if(shot.cameraReturn)visit.phase='overview';
      }
    }
    return visit || {phase:'overview'};
  }
  const aPathAnimations = new Map();
  function stopAPath() {
    for(const {animation} of aPathAnimations.values())animation.cancel();
    aPathAnimations.clear();
    if(aPathRun)aPathRun.settled=true;
  }
  function animateAPath(element, geometry) {
    if(!element?.animate || !geometry.pathFrames || !aPathRun || aPathRun.settled)return;
    const elapsed=performance.now()-aPathRun.started;
    if(elapsed>=aPathRun.duration){stopAPath();return;}
    const key=JSON.stringify(geometry.pathFrames),existing=aPathAnimations.get(element);
    if(existing?.key===key)return;
    existing?.animation.cancel();
    const animation=element.animate(geometry.pathFrames,{duration:aPathRun.duration,fill:'both',easing:'linear'});
    animation.id='a-camera-path';
    animation.currentTime=elapsed;
    aPathAnimations.set(element,{key,animation});
  }
  function settleACamera() {
    clearTimeout(aCameraTimer);
    aCameraTimer=null;
    if (aCameraVisit?.phase === 'focus' && !aCameraVisit.authoredCamera?.hold) aCameraVisit.phase='overview';
    stopAPath();
  }
  function resetACameraVisit() {
    settleACamera();
    aCameraVisit=null;
    aPathRun=null;
  }
  function renderParticleGather(shot) {
    const art=$('#scene-art');
    let layer=art.querySelector('.ebla-gather');
    if (!shot.particleGather || motionReduced() || state.effectsReduced) { layer?.remove();delete art.dataset.gatherKey;return; }
    if (!cutsceneGeometry) return;
    const {bw,bh,x,y,zoom}=cutsceneGeometry;
    const key=currentRecord().id+'|'+state.lineIndex;
    if (!layer && art.dataset.gatherKey!==key) {
      art.dataset.gatherKey=key;
      layer=document.createElement('div');
      layer.className='ebla-gather';layer.setAttribute('aria-hidden','true');
      // Deterministic motes converge on the armor and rifle, never across the HUD.
      layer.innerHTML=Array.from({length:36},(_,i)=>{
        const rifle=i%3===0,tx=rifle?44:53,ty=rifle?34:29;
        const angle=i*2.39996,radius=10+i%5*3;
        return `<i style="left:${tx}%;top:${ty}%;--dx:${Math.cos(angle)*radius*bw/100}px;--dy:${Math.sin(angle)*radius*bh/100}px;--delay:${i%9*120}ms"></i>`;
      }).join('')+'<span class="ebla-rifle-glow"></span>';
      art.querySelector('.art-fixture').appendChild(layer);
    }
    if (layer) layer.setAttribute('style',`width:${bw}px;height:${bh}px;transform:translate(${x}px,${y}px) scale(${zoom});`);
  }
  // Shared full-image composition; explicitly authored face entrances retain
  // their short focus and return without blocking dialogue progression.
  function renderCutsceneComposition(shot, resizing = false) {
    const memory=!$('#memory-card').hidden;
    const image = memory ? $('#memory-image') : !$('#scene-art').hidden ? $('#stage-camera') : null;
    const stage = $('#story-stage');
    const copies=[$('#dialogue-box'),$('.cutscene-copy'),$('#story-caption'),$('#telemetry-panel'),$('#communication-panel')];
    if(currentRecord()?.diskId==='B')copies.push($('#system-panel'));
    copies.forEach(copy=>copy.classList.remove('composition-copy'));
    const copy=memory ? $('.cutscene-copy').hidden ? null : $('.cutscene-copy') : copies.find(copy=>copy!==$('.cutscene-copy') && !copy.hidden);
    if(copy)copy.classList.add('composition-copy');
    const feed=copy===$('#communication-panel') ? $('#communication-feed') : null;
    const followFeed=feed && (!resizing || feed.scrollHeight-feed.clientHeight-feed.scrollTop<4);
    delete stage.dataset.aMobileLayout;
    delete stage.dataset.aComposition;
    delete stage.dataset.aPath;
    cutsceneGeometry = null;
    if (shot.mode !== 'cutscene' || !image?.naturalWidth
      || typeof image.parentElement?.getBoundingClientRect !== 'function' || shot.zoom !== 1) {stopAPath();return false;}
    const bounds=image.parentElement.getBoundingClientRect();
    // A visual transform must never change the dimensions used to fit the image.
    const width=image.parentElement.clientWidth || bounds.width,height=image.parentElement.clientHeight || bounds.height;
    if (!width || !height) return false;
    const visitKey=currentRecord().id+'|'+shot.src;
    if (aCameraVisit?.key !== visitKey) {
      if (shot.cameraContinuity && aCameraVisit?.key.startsWith(currentRecord().id+'|')) aCameraVisit.key=visitKey;
      else {
        resetACameraVisit();
        aCameraVisit={...shot.resumeCamera,key:visitKey,phase:shot.resumeCamera
          ? motionReduced() || state.effectsReduced ? 'overview' : shot.resumeCamera.phase : 'wide'};
      }
    }
    if (shot.faceCamera && aCameraVisit.phase === 'wide') {
      aCameraVisit.phase=motionReduced() || state.effectsReduced ? 'overview' : 'focus';
      if (aCameraVisit.phase === 'focus') {
        const visit=aCameraVisit;
        aCameraTimer=setTimeout(()=>{
          aCameraTimer=null;
          if (aCameraVisit !== visit) return;
          visit.phase='overview';
          if (state.screen === 'story-screen' && activeCutsceneShot?.src === shot.src
            && currentRecord()?.id+'|'+activeCutsceneShot.src === visitKey) refreshCutsceneComposition();
        },1400);
      }
    }
    if(shot.authoredCamera) {
      const camera=shot.authoredCamera;
      if(aCameraVisit.authoredId!==camera.id) {
        clearTimeout(aCameraTimer);
        aCameraVisit.authoredId=camera.id;
        aCameraVisit.phase=motionReduced() || state.effectsReduced ? 'overview' : 'focus';
        if(!camera.hold && aCameraVisit.phase==='focus') {
          const visit=aCameraVisit;
          aCameraTimer=setTimeout(()=>{
            if(aCameraVisit!==visit)return;
            visit.phase='overview';aCameraTimer=null;refreshCutsceneComposition();
          },1500);
        }
      }
      aCameraVisit.authoredCamera=camera;
      if(camera.hold && !motionReduced() && !state.effectsReduced)aCameraVisit.phase='focus';
    }
    if(shot.cameraReturn) {clearTimeout(aCameraTimer);aCameraTimer=null;aCameraVisit.phase='overview';}
    const pathKey=shot.cameraPath ? visitKey+'|'+shot.cameraPath.id : '';
    if(aPathRun && aPathRun.key!==pathKey){stopAPath();aPathRun=null;}
    if(pathKey && !motionReduced() && !state.effectsReduced && image.animate) {
      if(!aPathRun)aPathRun={key:pathKey,started:performance.now(),duration:shot.cameraPath.duration,settled:Boolean(shot.resumeCamera)};
      stage.dataset.aPath=shot.cameraPath.id;
    }
    const phase=aCameraVisit.phase;
    $('#story-stage').dataset.aCameraPhase=phase;
    stage.dataset.aComposition='true';
    // Keep the complete artwork and its dialogue together in portrait view.
    // Reserve the measured text/HUD height before fitting the original image.
    const compact = width <= 760 && height > width && Boolean(copy);
    let captionHeight=0, hudHeight=0;
    if (compact) {
      stage.dataset.aMobileLayout='contained';
      captionHeight=copy.getBoundingClientRect().height;
      const hud=$('#a-identity-hud');
      hudHeight=hud.hidden ? 0 : hud.getBoundingClientRect().height+12;
    }
    // Keep one image size for both directions; animate only its transform.
    const pictureHeight=compact ? Math.max(1,height-captionHeight-hudHeight-68) : height;
    const scale = Math.min(width/image.naturalWidth,pictureHeight/image.naturalHeight);
    const bw=image.naturalWidth*scale, bh=image.naturalHeight*scale;
    const pictureTop=compact ? Math.max(28,(height-bh-captionHeight-hudHeight-12)/2) : 0;
    // Desktop captions stay at the screen bottom, independent of image fit/zoom.
    // Portrait keeps its separate picture and text regions below.
    stage.style.setProperty('--a-composition-left',`${(width-bw)/2}px`);
    stage.style.setProperty('--a-composition-width',`${bw}px`);
    stage.style.setProperty('--a-composition-bottom',`${compact ? Math.max(0,height-pictureTop-bh) : 0}px`);
    stage.style.setProperty('--a-caption-height',`${copy?.getBoundingClientRect().height || 0}px`);
    let zoom=1;
    let x=(width-bw)/2, y=pictureTop;
    if (compact) {
      stage.style.setProperty('--a-picture-top',`${pictureTop}px`);
      stage.style.setProperty('--a-picture-bottom',`${pictureTop+bh}px`);
      stage.style.setProperty('--a-hud-top',`${pictureTop+bh+12}px`);
      stage.style.setProperty('--a-dialogue-top',`${pictureTop+bh+12+hudHeight}px`);
    }
    const camera=shot.faceCamera || aCameraVisit.authoredCamera;
    if (camera && phase === 'focus') {
      const available=Math.max(height*.55,height-Math.min(210,Math.max(150,height*.24)));
      const faceHeight=Math.min(available*.36,width*.5);
      zoom=camera.zoom || Math.min(5,Math.max(1,faceHeight/(bh*camera.faceHeight)));
      const [fx,fy]=camera.focus;
      x=bw*zoom>width ? Math.max(width-bw*zoom,Math.min(0,width/2-fx/100*bw*zoom)) : (width-bw*zoom)/2;
      y=compact ? pictureTop+bh*.45-fy/100*bh*zoom
        : Math.max(Math.min(0,available-bh*zoom),Math.min(0,available*.42-fy/100*bh*zoom));
    }
    const pathEntrance=shot.cameraPath?.snapEntrance && pathKey && aPathRun && !aPathRun.settled;
    const entrance=camera?.snapEntrance && phase==='focus' || pathEntrance;
    image.dataset.startZoomed=String(Boolean(entrance));
    const duration=camera && !entrance && !resizing && !shot.resumeCamera && !motionReduced() && !state.effectsReduced ? shot.cameraDuration ?? (phase==='overview' ? 650 : 450) : 0;
    const key=JSON.stringify([shot.src,width,height,x,y,zoom]);
    if (image.dataset.geometry !== key) {
      image.setAttribute('style',`position:absolute;left:0;top:0;width:${bw}px;height:${bh}px;max-width:none;object-fit:fill;transform-origin:0 0;transform:translate(${x}px,${y}px) scale(${zoom});transition:transform ${duration}ms ease;`);
      image.dataset.geometry=key;
    }
    let pathFrames=null;
    if(pathKey && aPathRun && !aPathRun.settled) {
      const wide={transform:`translate(${(width-bw)/2}px,${pictureTop}px) scale(1)`};
      pathFrames=shot.cameraPath.snapEntrance ? [] : [{...wide,offset:0}];
      const pathZoom=shot.cameraPath.zoom,points=shot.cameraPath.points;
      const visibleHeight=compact ? bh : Math.max(1,bh-$('#dialogue-box').getBoundingClientRect().height);
      points.forEach(([fx,fy],index)=>{
        const px=Math.max(width-bw*pathZoom,Math.min(0,width/2-fx/100*bw*pathZoom));
        const py=Math.max(pictureTop+visibleHeight-bh*pathZoom,Math.min(pictureTop,pictureTop+visibleHeight*.48-fy/100*bh*pathZoom));
        const transform=`translate(${px}px,${py}px) scale(${pathZoom})`,offset=(shot.cameraPath.snapEntrance ? 0 : .08)+index*.72/Math.max(1,points.length-1);
        pathFrames.push({transform,offset},{transform,offset:offset+.06});
      });
      pathFrames.push({...wide,offset:1});
    }
    cutsceneGeometry={width,height,bw,bh,zoom,x,y,duration,pathFrames};
    renderParticleGather(shot);
    animateAPath(image,cutsceneGeometry);
    if(followFeed)feed.scrollTop=feed.scrollHeight;
    return true;
  }

  function renderAIdentities(shot) {
    const record=currentRecord(), hud=$('#a-identity-hud'), targets=$('#a-identity-targets');
    if (record?.id !== 'A-01' || state.lineIndex !== 1) state.identificationIntroActive=false;
    if (record?.id === 'A-01' && state.lineIndex === 1 && !state.progress.aIdentificationIntroSeen) {
      state.identificationIntroActive=true;
      state.progress.aIdentificationIntroSeen=true;
    }
    const visible=!$('#scene-art').hidden && shot.identities.length>0
      && (state.characterLabels || state.identificationIntroActive);
    hud.hidden=!(visible && state.identificationIntroActive); targets.hidden=true;
    if (!visible) return;
    const roster=$('#a-identity-roster'), key=JSON.stringify([shot.src,shot.identities]);
    if (roster.dataset.media !== key) {
      roster.dataset.media=key;
      roster.innerHTML=shot.identities.map(({speaker,bounds})=>`<div class="a-identity-person" data-person="${escapeHtml(speaker)}"><span class="a-identity-photo"><img draggable="false" src="${escapeHtml(media.url(shot.src))}" alt="" style="${profileCropStyle({crop:bounds.map(value=>value/100)})}"></span><span>${escapeHtml(speaker)}</span></div>`).join('');
    }
    roster.querySelectorAll('[data-person]').forEach(person=>person.dataset.active=String(person.dataset.person===currentStory()[state.lineIndex]?.speaker));
    $('#a-identity-note').textContent=state.identificationIntroActive ? '인물 표시는 읽기 설정에서 다시 켤 수 있습니다.' : '인물 표시 · 읽기 설정에서 변경';
    if (cutsceneGeometry) {
      const {width,height,bw,bh,zoom,x,y,duration}=cutsceneGeometry;
      if (targets.dataset.media !== key) {
        targets.dataset.media=key;
        targets.innerHTML=shot.identities.map(({speaker,bounds:[left,top,w,h]})=>`<span class="a-identity-target" data-person="${escapeHtml(speaker)}" style="left:${left}%;top:${top}%;width:${w}%;height:${h}%"><span>${escapeHtml(speaker)}</span></span>`).join('');
      }
      // Use exactly the image's transform, including its transition. Fixed-size
      // screen markers drift during zoom and do not scale with desktop faces.
      targets.setAttribute('style',`width:${bw}px;height:${bh}px;transform-origin:0 0;transform:translate(${x}px,${y}px) scale(${zoom});transition:transform ${duration}ms ease;--identity-zoom:${zoom};`);
      animateAPath(targets,cutsceneGeometry);
      const stageBounds=$('#story-stage').getBoundingClientRect();
      // Only full-width captions define a shared lower edge. A small radio
      // panel must not clip unrelated faces on the other side of the artwork.
      const panels=[$('#dialogue-box'),$('.cutscene-copy'),$('#story-caption'),$('#telemetry-panel'),$('#communication-panel'),$('#system-panel')]
        .filter(panel=>!panel.hidden && panel.getBoundingClientRect().height>0)
        .map(panel=>{const rect=panel.getBoundingClientRect();return {left:rect.left-stageBounds.left-12,right:rect.right-stageBounds.left+12,top:rect.top-stageBounds.top-12,bottom:rect.bottom-stageBounds.top+12};});
      const widePanels=panels.filter(panel=>panel.left<=width*.15 && panel.right>=width*.85);
      const safeBottom=Math.max(0,Math.min(height,...widePanels.map(panel=>panel.top)));
      const overlapsPanel=rect=>panels.some(panel=>rect.left<panel.right && rect.right>panel.left && rect.top<panel.bottom && rect.bottom>panel.top);
      targets.parentElement.style.clipPath=`inset(0 0 ${height-safeBottom}px 0)`;
      targets.querySelectorAll('[data-person]').forEach((target,index)=>{
        const [left,top,w,h]=shot.identities[index].bounds;
        const px=x+(left+w/2)/100*bw*zoom, py=y+(top+h/2)/100*bh*zoom;
        const frame={left:x+left/100*bw*zoom,right:x+(left+w)/100*bw*zoom,top:y+top/100*bh*zoom,bottom:y+(top+h)/100*bh*zoom};
        target.hidden=px<0 || px>width || py<0 || py>safeBottom
          || panels.some(panel=>!widePanels.includes(panel) && frame.left<panel.right && frame.right>panel.left && frame.top<panel.bottom && frame.bottom>panel.top);
        const label=target.querySelector('span');
        label.hidden=false;
        const labelHeight=label.offsetHeight*zoom;
        const halfWidth=label.offsetWidth*zoom/2;
        const below={left:px-halfWidth,right:px+halfWidth,top:frame.bottom,bottom:frame.bottom+labelHeight};
        const aboveRect={left:px-halfWidth,right:px+halfWidth,top:frame.top-labelHeight,bottom:frame.top};
        const above=below.bottom>safeBottom || overlapsPanel(below);
        target.dataset.labelAbove=String(above);
        label.hidden=above && (aboveRect.top<0 || overlapsPanel(aboveRect));
      });
      targets.hidden=false;
    }
  }

  function refreshCutsceneComposition(resizing = false) {
    if (state.screen !== 'story-screen' || !activeCutsceneShot) return;
    renderAIdentities(activeCutsceneShot);
    renderCutsceneComposition(activeCutsceneShot,resizing);
    renderAIdentities(activeCutsceneShot);
    renderStandingCamera(activeCutsceneShot,resizing);
  }

  let standingCameraVisit = null;
  function renderStandingCamera(shot, resizing = false) {
    const stage=$('#story-stage'),camera=shot.stageCamera;
    if(shot.mode!=='stage' || shot.layout!=='confrontation' || !camera || !shot.actors.length) {
      delete stage.dataset.standingCamera;
      delete stage.dataset.standingCameraReady;
      delete stage.dataset.standingCameraFocus;
      delete stage.dataset.standingSingle;
      standingCameraVisit=null;
      return;
    }
    stage.dataset.standingCamera='true';
    stage.dataset.standingCameraFocus=camera.speaker || 'overview';
    const width=stage.clientWidth,height=stage.clientHeight;
    // Hide a fresh closeup until its layout is known, rather than flashing all
    // three expressions for one frame on entry or while images decode.
    if(!width || !height) {stage.dataset.standingCameraReady='false';return;}
    const single=width<=1000;
    stage.dataset.standingSingle=String(single);
    const visibleSpeaker=camera.speaker || '유라';
    shot.actors.forEach((actor,index)=>{
      const person=$('#standing-actor-'+index);
      person.hidden=single && actor.speaker!==visibleSpeaker;
      person.style.setProperty('--actor-x',`${single ? 50 : actor.x}%`);
    });
    const key=currentRecord().id+'|'+shot.layout;
    const entering=standingCameraVisit?.key!==key;
    let zoom=1,x=0,y=0;
    if(camera.speaker) {
      const index=shot.actors.findIndex(actor=>actor.speaker===camera.speaker);
      const person=$('#standing-actor-'+index),image=person?.querySelector('.standing-image');
      if(!person?.offsetWidth || !person.offsetHeight || !image?.naturalWidth) {stage.dataset.standingCameraReady='false';return;}
      const actor=shot.actors[index];
      const imageScale=Math.max(person.offsetWidth/image.naturalWidth,person.offsetHeight/image.naturalHeight);
      const imageWidth=image.naturalWidth*imageScale,imageHeight=image.naturalHeight*imageScale;
      const [fx,fy]=camera.face || [.47,.105];
      const faceX=width*(single ? 50 : actor.x)/100+(fx-.5)*imageWidth;
      const faceY=person.offsetTop+fy*imageHeight;
      const copy=$('#dialogue-box');
      const captionHeight=copy.hidden ? 0 : copy.getBoundingClientRect().height;
      const available=Math.max(height*.45,height-captionHeight);
      zoom=camera.zoom || 3;
      x=Math.max(width-width*zoom,Math.min(0,width/2-faceX*zoom));
      y=Math.max(height-height*zoom,Math.min(0,available*.44-faceY*zoom));
    }
    const geometryKey=JSON.stringify([width,height,x,y,zoom]);
    if(standingCameraVisit?.geometryKey===geometryKey) {stage.dataset.standingCameraReady='true';return;}
    const skip=entering || camera.snapEntrance || resizing || shot.resumeCamera || motionReduced() || state.effectsReduced;
    stage.style.setProperty('--standing-camera-duration',`${skip ? 0 : camera.duration || 650}ms`);
    stage.style.setProperty('--standing-camera-transform',`translate(${x}px,${y}px) scale(${zoom})`);
    stage.dataset.standingCameraReady='true';
    standingCameraVisit={key,geometryKey};
  }

  function artMarkup(kind, line = {}, embedded = false, sceneIndex = state.lineIndex, resolvedShot = null) {
    const record = currentRecord();
    const manifest = window.RustedPrayerMediaManifest || {};
    const shot=resolvedShot || window.RustedPrayerVisuals.resolve(record,sceneIndex,getActiveVisual(sceneIndex),state.telemetryPage);
    const src=embedded ? manifest.attachments?.[record.id]?.[sceneIndex] || line.sceneArt?.src || manifest.cutscenes?.[record.id] || shot.src : shot.src;
    const alt=embedded && line.attachmentAlt ? line.attachmentAlt : embedded && record.id==='C-00' ? '전방 손잡이 탈착식 소총 무기 시트' : numberedText(shot.alt,record);
    // A CSS fixture also remains underneath a failed real image.
    const overlay=!embedded && shot.overlaySrc ? `<img class="cutscene-overlay" draggable="false" src="${escapeHtml(media.url(shot.overlaySrc))}" alt="참새 드론 표정 패널">` : '';
    const startZoomed=!embedded && (shot.resumeCamera ? shot.resumeCamera.phase==='focus' : shot.authoredCamera?.snapEntrance || shot.faceCamera?.snapEntrance || shot.cameraPath?.snapEntrance);
    return `<div class="art-fixture fixture-${embedded ? 'attachment' : shot.mode} ${embedded ? 'embedded-art' : ''}" role="img" aria-label="${escapeHtml(alt)}"><span>${escapeHtml(recordNumber(record)+' · 복구 장면')}</span>${src ? `<img ${embedded ? '' : 'id="stage-camera"'} class="real-art ${embedded ? '' : 'scene-camera'}" draggable="false" data-start-zoomed="${Boolean(startZoomed)}" style="${startZoomed ? 'visibility:hidden;' : ''}${embedded ? 'object-fit:contain;' : cameraStyle(shot)}" src="${escapeHtml(media.url(src))}" alt="${escapeHtml(alt)}">` : ''}${overlay}</div>`;
  }

  function renderStandingCast(shot) {
    const layer=$('#standing-art');
    layer.hidden=!shot.actors.length;
    layer.dataset.inactive=shot.inactive;
    const key=JSON.stringify([currentRecord().id,shot.actors.map(({speaker,src,effectSrc})=>({speaker,src,effectSrc}))]);
    if (layer.dataset.cast!==key) {
      layer.dataset.cast=key;
      layer.innerHTML=shot.actors.map((actor,index)=>`<div id="standing-actor-${index}" class="standing-person" data-actor="${escapeHtml(actor.speaker)}"><div class="standing-figure"><div class="standing-placeholder" aria-hidden="true"><span>${escapeHtml(actor.speaker)}</span></div>${actor.src ? `<img class="standing-image" draggable="false" src="${escapeHtml(media.url(actor.src))}" alt="${escapeHtml(actor.speaker+' 스탠딩')}">${actor.effectSrc ? `<img class="standing-effect" draggable="false" src="${escapeHtml(media.url(actor.effectSrc))}" alt="" aria-hidden="true">` : ''}` : ''}</div></div>`).join('');
    }
    shot.actors.forEach((actor,index)=>{
      const person=$('#standing-actor-'+index);
      person.hidden=false;
      person.className='standing-person '+(actor.active ? 'is-speaking' : 'is-listening')+(actor.entry==='rush' && !shot.resumeCamera ? ' entry-rush' : '');
      person.setAttribute('style',`--actor-x:${actor.x}%;--actor-scale:${actor.scale};--actor-flip:${actor.flip ? -1 : 1};--exit-direction:${actor.x<50 ? -1 : 1};z-index:${actor.active ? 10 : index+1}`);
    });
  }

  function profileAtScene(speaker) {
    const config = (currentRecord()?.diskId==='A' ? window.RustedPrayerMediaManifest.aProfiles?.[speaker] : null) || window.RustedPrayerMediaManifest.profiles?.[speaker];
    if (!config) return null;
    let key = config.initial;
    for (const record of orderedRecords) {
      for (const change of config.timeline || []) {
        if (change.recordId === record.id) key = change.photo;
      }
      const limit = record.id === state.selectedRecordId ? state.lineIndex : Infinity;
      for (const change of record.profileChanges || []) {
        if (change.speaker === speaker && change.at <= limit) key = change.photo;
      }
      if (record.id === state.selectedRecordId) break;
    }
    const photo = config.photos[key] || config.photos[config.initial];
    return {...photo, key, speaker, status:photo.status ?? config.status ?? '', statusKind:photo.statusKind ?? config.statusKind ?? 'message'};
  }

  function profileButton(speaker, compact = false) {
    const photo = profileAtScene(speaker);
    if (!photo) return `<strong>${escapeHtml(speaker)}</strong>`;
    const fallback = ['landscape','pair'].includes(photo.key) ? photo.key : 'default';
    return `<button class="profile-trigger ${compact ? 'profile-member' : ''}" type="button" data-action="open-profile" data-profile="${escapeHtml(speaker)}" aria-label="${escapeHtml(speaker)} 프로필 보기"><span class="profile-thumb" data-photo="${fallback}" aria-hidden="true"><span class="profile-initial">${escapeHtml(speaker.slice(0,1))}</span>${photo.src ? `<img class="profile-avatar-image" style="${profileCropStyle(photo,true)}" src="${escapeHtml(media.url(photo.src))}" alt="">` : ''}</span><span>${escapeHtml(speaker)}</span></button>`;
  }

  function profileCropStyle(photo, thumbnail = false) {
    const crop = thumbnail && photo?.thumbCrop || photo?.crop;
    if(!crop)return '';
    const [x,y,w,h]=crop;
    return `inset:auto;left:${-100*x/w}%;top:${-100*y/h}%;width:${100/w}%;height:${100/h}%;max-width:none;object-fit:fill;`;
  }
  function setStoryMenu(open) {
    state.menuOpen=open;
    syncStoryMenu();
    scheduleAutoAdvance();
  }
  function syncStoryMenu() {
    const scoped=Boolean(currentRecord());
    const hud=$('.story-hud');
    if(scoped && typeof hud.getBoundingClientRect==='function')$('#story-screen').style.setProperty('--story-menu-height',`${hud.getBoundingClientRect().height}px`);
    $('#story-screen').dataset.menu=state.menuOpen ? 'open' : 'closed';
    $('#story-menu-toggle').hidden=!scoped;
    $('#story-menu-toggle').setAttribute('aria-expanded',String(state.menuOpen));
    $('#story-menu-toggle').textContent=state.menuOpen ? '메뉴 닫기 · Esc ▴' : '메뉴 ▾';
    hud.inert=scoped && !state.menuOpen;
    hud.setAttribute('aria-hidden',String(scoped && !state.menuOpen));
  }
  function galleryItems() {
    const manifest=window.RustedPrayerMediaManifest;
    const items=(manifest.gallery || []).filter(item=>{
      const record=archive.getRecord(item.recordId);
      if(!record || !isRecordUnlocked(record))return false;
      const progress=recordProgress(item.recordId);
      return progress.completed || record.readerMode!=='report' && Number.isInteger(progress.seenIndex) && progress.seenIndex>=item.index;
    });
    if(allRecordsRead() && manifest.ending?.src)items.push({kind:'ending',src:manifest.ending.src,preview:manifest.ending.preview,title:'마지막 사진'});
    return items.filter(item=>state.galleryFilter==='all' || (state.galleryFilter==='ending' ? item.kind==='ending' : item.diskId===state.galleryFilter));
  }
  function renderGallery() {
    cancelGalleryLoading();
    if(state.galleryFilter==='ending')state.galleryFilter='all';
    const filters=[['all','전체'],['A','A편'],['B','B편'],['C','C편'],['D','D편'],...(allRecordsRead() ? [['ending','마지막 사진']] : [])];
    $('#gallery-filters').innerHTML=filters.map(([value,label])=>`<button class="text-button" data-action="filter-gallery" data-gallery-filter="${value}" aria-pressed="${state.galleryFilter===value}" type="button">${label}</button>`).join('');
    const items=galleryItems();
    $('#gallery-count').textContent=`열람한 이미지 ${items.length}개 · 읽은 장면의 사진이 이곳에 모입니다.`;
    $('#gallery-grid').innerHTML=items.length ? items.map((item,index)=>`<button class="gallery-tile" data-action="open-gallery-image" data-gallery-index="${index}" data-gallery-kind="${item.kind}" type="button"><img loading="lazy" decoding="async" width="512" height="288" src="${escapeHtml(media.url(item.preview || item.src))}" alt="${escapeHtml(item.title)}"><span>${escapeHtml(item.title)}</span></button>`).join('') : '<p>아직 열람한 이미지가 없습니다.</p>';
    $('#gallery-viewer').hidden=true;
    $('#gallery-grid').inert=false;
  }
  function cancelGalleryLoading() {
    state.galleryLoading?.abort();
    state.galleryLoading=null;
    $('#gallery-viewer').setAttribute('aria-busy','false');
  }
  async function openGalleryImage(index) {
    const items=galleryItems();if(!items.length)return;
    cancelGalleryLoading();
    state.galleryIndex=(index+items.length)%items.length;
    const item=items[state.galleryIndex],img=$('#gallery-image');
    if(item.kind==='ending') {openEnding();return;}
    const controller=new AbortController();state.galleryLoading=controller;
    const current=()=>state.galleryLoading===controller && !controller.signal.aborted && state.screen==='gallery-screen' && !$('#gallery-viewer').hidden;
    const caption=item.title+` · ${state.galleryIndex+1} / ${items.length}`;
    img.hidden=true;
    $('#gallery-caption').textContent='이미지 준비 중';
    $('#gallery-viewer').hidden=false;
    $('#gallery-grid').inert=true;
    $('#gallery-viewer').setAttribute('aria-busy','true');
    $('#gallery-prev').disabled=$('#gallery-next').disabled=items.length<2;
    $('#gallery-close').focus({preventScroll:true});
    try {
      const result=await media.preload({id:'GALLERY',story:[],defaultVisual:{backgroundSrc:item.src}},{signal:controller.signal});
      if(!current())return;
      if(result.failed.length)throw new Error('Gallery image unavailable');
      img.src=media.url(item.src);img.alt=item.title;
      if(img.decode)await img.decode();
      if(!current())return;
      img.hidden=false;$('#gallery-caption').textContent=caption;
    } catch(error) {
      if(!current())return;
      img.hidden=true;$('#gallery-caption').textContent='이미지를 불러오지 못했습니다. 다른 컷신을 선택해 주세요.';
    } finally {
      if(state.galleryLoading===controller) {
        state.galleryLoading=null;$('#gallery-viewer').setAttribute('aria-busy','false');
      }
    }
  }
  function closeGalleryImage(restoreFocus=true) {
    cancelGalleryLoading();$('#gallery-viewer').setAttribute('aria-busy','false');
    $('#gallery-viewer').hidden=true;$('#gallery-grid').inert=false;
    if(restoreFocus)$('#gallery-grid').querySelectorAll('button')[state.galleryIndex]?.focus({preventScroll:true});
  }

  function openProfile(speaker, trigger) {
    if (state.screen !== 'story-screen' || currentStory()[state.lineIndex]?.tone !== 'chat') return;
    const photo = profileAtScene(speaker);
    if (!photo) return;
    clearTimeout(state.autoTimer);
    const picture = $('#profile-picture');
    picture.dataset.photo = ['landscape','pair'].includes(photo.key) ? photo.key : 'default';
    picture.setAttribute('role','img');
    picture.setAttribute('aria-label',photo.alt);
    $('#profile-initial').textContent = speaker.slice(0,1);
    $('#profile-name').textContent = speaker;
    const status = photo.status;
    $('#profile-photo-label').textContent = status;
    $('#profile-photo-label').hidden = !status;
    $('#profile-photo-label').dataset.kind = photo.statusKind;
    $('#profile-photo-label').setAttribute('aria-label',(photo.statusKind==='music' ? '프로필 뮤직 · ' : photo.statusKind==='anniversary' ? '디데이 · ' : '')+status);
    const img = $('#profile-image');
    img.setAttribute('style',profileCropStyle(photo));
    img.hidden = !photo.src;
    if (photo.src) img.src = media.url(photo.src);
    else img.removeAttribute('src');
    state.profileReturnFocus = trigger;
    $('#profile-overlay').hidden = false;
    $('#story-stage').inert = true;
    $('.story-hud').inert = true;
    $('#profile-close').focus();
    const progress = recordProgress(state.selectedRecordId);
    const views = Array.isArray(progress.profileViews) ? progress.profileViews : [];
    progress.profileViews = [...new Set([...views,`${speaker}:${photo.key}`])];
    saveProgress();
  }

  function closeProfile(resume = true) {
    if ($('#profile-overlay').hidden) return;
    $('#profile-overlay').hidden = true;
    $('#story-stage').inert = false;
    syncStoryMenu();
    if (resume) { state.profileReturnFocus?.focus(); scheduleAutoAdvance(); }
    state.profileReturnFocus = null;
  }

  function renderCommunication(line) {
    const panel = $('#communication-panel');
    panel.dataset.kind = line.tone;
    const signal=$('#channel-signal');
    signal.className='channel-signal';
    if (line.tone==='radio' && !motionReduced()) { void signal.offsetWidth; signal.classList.add('is-receiving'); }
    $('#communication-kind').textContent = line.tone === 'radio' ? '무전 / 음성 수신' : line.channel === 'direct' ? '개인 메시지' : '공용 채널 / 5명';
    $('#communication-title').textContent = line.channelTitle;
    const members = $('#chat-members');
    members.hidden = line.tone !== 'chat';
    const participants = line.channel === 'direct' ? ['유라','연화'] : ['연화','유라','세린','가은','초희'];
    members.innerHTML = line.tone === 'chat' ? participants.map(speaker => profileButton(speaker,true)).join('') : '';
    const messages = currentStory().slice(0,state.lineIndex+1).filter(item => item.tone === line.tone && item.channel === line.channel && item.session === line.session);
    const compactRadio=currentRecord().id==='C-05' && line.tone==='radio';
    panel.dataset.compact=String(compactRadio);
    panel.dataset.bubble=String(currentRecord().id==='C-02');
    const visible = line.tone === 'radio' ? messages.slice(compactRadio || currentRecord().id==='C-02' ? -1 : -3) : messages;
    $('#communication-feed').innerHTML = visible.map((item,index) => {
      const event = !item.speaker || item.speaker === '시스템';
      const receiving = line.tone==='radio' && index===visible.length-1 && !motionReduced();
      return `<div class="message ${event ? 'channel-event' : item.side || 'incoming'} ${index===visible.length-1 ? 'message-new' : ''}" data-speaker-theme="${getSpeakerTheme(item)}">${!event ? line.tone === 'chat' ? profileButton(item.speaker) : `<strong>${escapeHtml(item.speaker)}</strong>` : ''}<p${receiving ? ' class="radio-text-receiving" data-received-text="'+escapeHtml(item.text)+'"' : ''}>${escapeHtml(item.text)}</p></div>`;
    }).join('');
    const feed = $('#communication-feed');
    $('#communication-status').textContent = line.tone === 'radio' ? /응답 없음|손상/.test(line.text) ? '응답 신호 없음 · 수신 대기' : '수신 중  ━╱╲━╲╱━' : '이름·사진으로 프로필 보기 · 빈 곳을 눌러 다음 메시지';
    feed.scrollTop = feed.scrollHeight;
    revealPage(line.text);
  }

  let dissolveLayer=null;
  let bFlashTimer=null;
  function clearDissolve() {dissolveLayer?.remove();dissolveLayer=null;}
  function radioCutsceneNoise(shot) {
    const art=$('#scene-art'),image=$('#stage-camera');
    if(shot.transition!=='radio-noise' || !image || motionReduced() || state.effectsReduced)return;
    const noise=document.createElement('div');
    noise.className='cutscene-radio-noise';noise.setAttribute('aria-hidden','true');
    noise.style.animationPlayState='paused';
    art.appendChild(noise);
    // Start interference with the decoded picture, even on a cold image load.
    (image.decode ? image.decode() : Promise.resolve()).then(()=>{
      if(!noise.isConnected || state.screen!=='story-screen' || activeCutsceneShot!==shot) {noise.remove();return;}
      noise.style.animationPlayState='running';
      noise.addEventListener('animationend',()=>noise.remove(),{once:true});
    }).catch(()=>noise.remove());
  }
  function dissolveCutscene(shot) {
    const art=$('#scene-art'),previous=$('#stage-camera');
    clearDissolve();
    if(shot.transition==='black-dissolve' && activeCutsceneShot?.treatment==='held-black' && !motionReduced() && !state.effectsReduced) {
      const layer=document.createElement('div');
      layer.className='cutscene-dissolve cutscene-black-dissolve';
      layer.setAttribute('aria-hidden','true');
      return layer;
    }
    if(!['dissolve','dissolve-noise'].includes(shot.transition) || motionReduced() || state.effectsReduced || art.hidden
      || !previous?.naturalWidth || !previous.cloneNode || activeCutsceneShot?.src===shot.src)return null;
    // Fade the outgoing artwork only; the stage's side vignette stays above both images.
    const layer=art.firstElementChild.cloneNode(true);
    layer.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
    layer.classList.add('cutscene-dissolve');return layer;
  }
  function dustCutscene(shot) {
    const art=$('#scene-art');
    if(shot.transition!=='dust-wipe' || motionReduced() || state.effectsReduced || art.hidden)return null;
    const previous=art.firstElementChild;
    if(!previous?.cloneNode || activeCutsceneShot?.src===shot.src)return null;
    const layer=previous.cloneNode(true);
    layer.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
    layer.classList.add('dust-outgoing');
    return layer;
  }
  const dustMarkup='<div class="cutscene-dust" aria-hidden="true"><span class="dust-plume"></span><span class="dust-haze"></span>'+
    Array.from({length:9},(_,index)=>`<i style="--chip:${index};--dx:${18+index*7}vw;--dy:${-12-index*5}vh;--spin:${index*47}deg"></i>`).join('')+'</div>';
  function renderLine() {
    clearTimeout(bFlashTimer);bFlashTimer=null;
    state.beatPresses = 0;
    clearPlaybackTimers();
    const record = currentRecord();
    const story = currentStory();
    const line = story[state.lineIndex];
    if (!record || !line) return;
    window.RustedPrayerBgm?.sync(record,state.lineIndex,state.screen);
    $('#story-screen').dataset.disk=record.diskId;
    syncStoryMenu();
    $('#acknowledge-insert').textContent='확인 · 계속';
    state.attachmentPending = Boolean(line.requiresAcknowledgement);
    const hold = Math.max(line.requiresAcknowledgement ? 900 : 0, motionReduced() || line.tone==='radio' ? 0 : line.effectHold || 0);
    state.advanceLocked = hold > 0;
    $('#acknowledge-insert').hidden = !state.attachmentPending;
    $('#acknowledge-insert').disabled = state.advanceLocked;
    if (hold) state.gateTimer=setTimeout(()=>{
      state.advanceLocked=false;
      $('#acknowledge-insert').disabled=false;
      scheduleAutoAdvance();
    },hold);

    const stage = $("#story-stage");
    const dialogue = $("#dialogue-box");
    const caption = $("#story-caption");
    const memory = $("#memory-card");
    const systemPanel = $("#system-panel");
    const assetStage = $("#asset-stage");
    const visual = getActiveVisual(state.lineIndex);
    const captionMode = ["thought", "resolve", "resolve-final"].includes(line.tone);
    const analysisMode = window.RustedPrayerMediaManifest?.scenes?.[record.id]?.[state.lineIndex]?.presentation === 'analysis';
    const panelOnly = ["system", "objective"].includes(line.tone) || analysisMode;
    const cutsceneMode = ["memory", "cutscene"].includes(line.tone);
    const insertMode = ['memo','document','report','comparison','time','slate','status'].includes(line.tone);
    const communicationMode = ['chat','radio'].includes(line.tone);
    const telemetryMode = line.tone === 'telemetry' || line.instrument === 'drone';
    const instrumentMode = telemetryMode || line.instrument === 'scan';
    const pagedTelemetry = telemetryMode && line.instrument !== 'scan';
    const telemetryPageList = pagedTelemetry ? (line.telemetryPages || telemetryPages(line.text)) : [line.text];
    if (state.telemetryLineIndex !== state.lineIndex) {
      state.telemetryLineIndex=state.lineIndex;
      state.telemetryPage=0;
    }
    state.telemetryPage=Math.min(state.telemetryPage,telemetryPageList.length-1);
    const restoring=resumePresentation?.recordId===record.id && resumePresentation.index===state.lineIndex && resumePresentation.page===state.telemetryPage;
    if(!restoring)resumePresentation=null;

    stage.className = "story-stage";
    if (state.uiHidden) stage.classList.add("ui-hidden");
    const fx = $('#screen-fx');
    fx.className = 'screen-fx';
    fx.classList.toggle('is-reduced',state.effectsReduced);
    const sustainedRun=['B-06','B-06-01'].includes(record.id) && (line.motion==='run' || line.effect==='running-strong');
    const effect=(restoring && !sustainedRun) || line.tone==='radio' || line.signalActivity ? '' : line.effect;
    fx.hidden = !effect || motionReduced();
    // The overlay is outside all transformed scene containers, so interference covers the viewport.
    if (effect && !motionReduced()) { void fx.offsetWidth; fx.classList.add(`fx-${effect}`); }
    stage.dataset.instrument = line.instrument || '';
    stage.dataset.tone = line.tone;
    stage.dataset.camera = line.camera || '';
    stage.dataset.motion = restoring && !sustainedRun ? '' : line.motion || '';
    stage.dataset.novel = String(Boolean(line.novel));
    stage.dataset.effect = motionReduced() ? '' : effect || '';
    stage.dataset.telemetrySide = line.telemetrySide || 'right';
    stage.dataset.corrupted = String(record.id==='C-04' && story.slice(0,state.lineIndex+1).some(item=>item.effect==='corrupt'));
    const shot=window.RustedPrayerVisuals.resolve(record,state.lineIndex,visual,state.telemetryPage);
    $('#scene-art').querySelector('.cutscene-radio-noise')?.remove();
    if(restoring) {
      shot.resumeCamera=resumeCameraAt(record,state.lineIndex,state.telemetryPage);
      shot.cameraEffect='';shot.transition='';shot.particleGather=false;
      if(shot.flashReturn) {shot.src=shot.flashReturn;shot.flashReturn=null;}
    }
    if(shot.flashReturn && (motionReduced() || state.effectsReduced))shot.src=shot.flashReturn;
    stage.dataset.bTreatment=shot.treatment;
    if(shot.treatment==='signal-noise' && !motionReduced()) {fx.hidden=false;fx.classList.add('fx-signal-noise');}
    if(shot.treatment==='weak-noise' && !motionReduced()) {fx.hidden=false;fx.classList.add('fx-weak-noise');}
    stage.dataset.sceneMode=shot.mode;
    stage.dataset.hudOnly=String(shot.hideArt && line.instrument==='drone');
    stage.dataset.record=record.id;
    stage.dataset.dialogueLines=String(line.preserveDialogueLines===true);
    stage.dataset.stageLayout=shot.layout;
    $('#lab-monitor-area').hidden = !shot.monitor;
    $('#lab-monitor-record').textContent = recordNumber(record);
    $('#scene-art').hidden = shot.hideArt || (shot.layout==='confrontation' && !shot.src) || Boolean(shot.scanPreview) || (!line.sceneArt && !shot.src) || Boolean(line.attachmentImage) || cutsceneMode || insertMode;
    const sceneKey=JSON.stringify([record.id,shot.mode,shot.src,shot.alt,shot.overlaySrc]);
    if ($('#scene-art').dataset.media!==sceneKey) {
      const dissolve=dissolveCutscene(shot);
      const dust=dustCutscene(shot);
      const dusty=shot.transition==='dust-wipe' && !motionReduced() && !state.effectsReduced;
      const blackout=shot.transition==='black-cut' && !motionReduced() && !state.effectsReduced;
      delete stage.dataset.aCameraPhase;
      delete $('#scene-art').dataset.gatherKey;
      $('#scene-art').dataset.media=sceneKey;
      const retained=shot.cameraContinuity && aCameraVisit?.key.startsWith(record.id+'|') ? $('#stage-camera') : null;
      if (retained) {
        retained.src=media.url(shot.src);retained.alt=shot.alt;
        retained.parentElement.setAttribute('aria-label',shot.alt);
      } else $('#scene-art').innerHTML = artMarkup('cutscene',line,false,state.lineIndex,shot);
      // The black mask belongs to the picture; the HUD and side vignette stay outside it.
      if(blackout)$('#scene-art').innerHTML += '<div class="cutscene-blackout" aria-hidden="true"></div>';
      if(dust)$('#scene-art').appendChild(dust);
      if(dusty)$('#scene-art').innerHTML += dustMarkup;
      if(shot.transition==='drone-noise' && !motionReduced() && !state.effectsReduced)
        $('#scene-art').innerHTML += '<div class="cutscene-drone-noise" aria-hidden="true"></div>';
      if(shot.transition==='dissolve-noise' && !motionReduced() && !state.effectsReduced)
        $('#scene-art').innerHTML += '<div class="cutscene-transition-noise" aria-hidden="true"></div>';
      radioCutsceneNoise(shot);
      if(dissolve) {
        dissolveLayer=dissolve;$('#scene-art').appendChild(dissolve);
        const image=$('#stage-camera');
        (image.decode ? image.decode() : Promise.resolve()).then(()=>{
          if(dissolveLayer!==dissolve)return;
          const animation=dissolve.animate([{opacity:1},{opacity:0}],{duration:600,fill:'forwards'});
          animation.finished.then(()=>{if(dissolveLayer===dissolve)clearDissolve();}).catch(()=>{});
        }).catch(()=>{if(dissolveLayer===dissolve)clearDissolve();});
      }
    }
    activeCutsceneShot=shot;
    if (!renderCutsceneComposition(shot) && $('#stage-camera') && !(shot.cameraContinuity && $('#stage-camera').dataset.geometry)) {
      const waitingForEntrance=shot.mode==='cutscene' && (shot.resumeCamera ? shot.resumeCamera.phase==='focus' : shot.authoredCamera?.snapEntrance || shot.faceCamera?.snapEntrance || shot.cameraPath?.snapEntrance) && !$('#stage-camera').naturalWidth;
      $('#stage-camera').setAttribute('style',(waitingForEntrance ? 'visibility:hidden;' : '')+cameraStyle(shot));
      delete $('#stage-camera').dataset.geometry;
    }
    if ($('#stage-camera')) $('#stage-camera').dataset.entry= !motionReduced() && !state.effectsReduced ? shot.cameraEffect : '';
    renderAIdentities(shot);
    const drone=$('#a-drone-hud');
    drone.hidden=!shot.dronePanel;
    if(shot.dronePanel)$('#a-drone-panel').src=media.url(shot.dronePanel);
    renderStandingCast(shot);
    $('#telemetry-context').hidden = !instrumentMode || pagedTelemetry || Boolean(shot.scanPreview);
    const prior = story.slice(0,state.lineIndex).filter(item=>item.instrument===line.instrument && item.tone==='telemetry').at(-1);
    $('#telemetry-context').innerHTML = `<span class="eyebrow">${line.instrument==='scan' ? '인지 스캔' : '현장 기록'}</span><p>${escapeHtml(prior?.text || '관측 신호 동기화 완료')}</p><small>${escapeHtml(recordNumber(record))} / ${String(state.lineIndex+1).padStart(3,'0')}</small>`;
    stage.dataset.speakerTheme = getSpeakerTheme(line);
    stage.dataset.atmosphere = visual.atmosphere || record.defaultVisual.atmosphere || 'field';
    if (line.visualTreatment) stage.dataset.visualTreatment = line.visualTreatment;
    else delete stage.dataset.visualTreatment;

    $("#story-counter").textContent = `${String(state.lineIndex + 1).padStart(3, "0")} / ${String(story.length).padStart(3, "0")}`;
    $("#background-asset-label").textContent = visual.background;
    $("#character-asset-label").textContent = visual.character;
    $("#framing-label").textContent = visual.framing;
    assetStage.hidden = insertMode || cutsceneMode || communicationMode || instrumentMode || ["resolve", "resolve-final"].includes(line.tone);
    $('#scene-image').hidden = !visual.backgroundSrc;
    if (visual.backgroundSrc) $('#scene-image').src = media.url(visual.backgroundSrc);
    memory.hidden = !cutsceneMode;
    caption.hidden = !captionMode;
    dialogue.hidden = insertMode || cutsceneMode || captionMode || panelOnly || communicationMode || instrumentMode;
    systemPanel.hidden = insertMode || communicationMode || instrumentMode || (!line.systemPanel && !analysisMode);
    $('#insert-card').hidden = !insertMode;
    $('#communication-panel').hidden = !communicationMode;
    $('#telemetry-panel').hidden = !instrumentMode;

    if (line.systemPanel || analysisMode) {
      systemPanel.dataset.level = line.systemPanel?.level || "info";
      $("#system-panel-kicker").textContent = line.systemPanel?.kicker || (analysisMode ? "기억 분석" : "시스템");
      $("#system-panel-title").textContent = line.systemPanel?.title || (analysisMode ? "UNIT-01 / 인지 데이터" : "");
      $("#system-panel-text").textContent = panelOnly ? "" : systemText(line.systemPanel?.text);
    }

    if (communicationMode) {
      renderCommunication(line);
    } else if (instrumentMode) {
      $('#telemetry-panel').dataset.compact=String(pagedTelemetry);
      $('#telemetry-panel').dataset.kind = line.instrument;
      $('#telemetry-panel').dataset.level = line.alert || line.systemPanel?.level === 'warning' || /심각|손상 개체 포기|오류/.test(line.text) ? 'warning' : 'info';
      $('#telemetry-kind').textContent = line.instrument === 'scan' ? '인지 스캔 / 데이터 분석' : 'DRONE-02 / 광학·음성 기록';
      $('#telemetry-title').textContent = line.systemPanel?.title && line.systemPanel.title !== record.id ? line.systemPanel.title : line.instrument === 'scan' ? 'UNIT-01 · 우선순위 검색' : 'DRONE-02 · 현장 기록';
      $('#telemetry-speaker').textContent = line.speaker && line.speaker !== '시스템' ? line.speaker + ' / 음성 감지' : '관측 데이터';
      $('#telemetry-speaker').hidden=pagedTelemetry && (!line.speaker || line.speaker==='시스템');
      $('#telemetry-status').textContent = recordNumber(record) + ' / 무결성 ' + record.integrity + (telemetryPageList.length>1 ? ` · ${state.telemetryPage+1}/${telemetryPageList.length}` : '');
      startTypewriter($('#telemetry-text'),line.preserveSystemPunctuation ? telemetryPageList[state.telemetryPage] : systemText(telemetryPageList[state.telemetryPage]));
    } else if (insertMode) {
      $('#insert-card').dataset.kind = line.tone;
      $('#insert-card').dataset.request = String(record.id==='A-06' && Boolean(line.request));
      $('#insert-kicker').textContent = ['memo','document','report','comparison'].includes(line.tone) ? recordNumber(record) : line.tone === 'time' ? '시간 경과' : line.tone === 'status' ? '통신 상태' : line.tone === 'slate' ? '신호 전환' : recordNumber(record);
      $('#insert-title').textContent = line.cardTitle || '기록 자료';
      $('#insert-speaker').hidden = Boolean(line.rows) || !line.speaker;
      $('#insert-speaker').textContent = line.speaker || '';
      const rich = Boolean(line.rows || line.columns);
      $('#insert-text').hidden = rich;
      $('#insert-body').hidden = !rich;
      $('#insert-card').scrollTop = 0;
      $('#insert-hint').textContent = state.attachmentPending ? '' : '클릭하여 계속';
      if (rich) {
        $('#insert-body').innerHTML = renderSheet(line);
        if (line.typeRequest) startTypewriter($('#request-typewriter'),line.text.match(/요청 품목\s*:\s*([\s\S]*?)(?=\s*수량\s*:)/)?.[1]?.trim() || line.rows[0].text);
        else revealPage(line.text);
      } else if (line.tone === 'status') {
        $('#insert-text').textContent=line.text;
        revealPage(line.text);
      } else startTypewriter($('#insert-text'), line.text);
    } else if (cutsceneMode) {
      configureCutscene(line);
      $("#memory-title").textContent = line.memoryTitle || line.cutsceneTitle || "";
      startTypewriter($("#memory-caption"), line.memoryCaption || line.cutsceneCaption || "");
    } else if (captionMode) {
      startTypewriter(caption, line.text);
    } else if (panelOnly) {
      startTypewriter($("#system-panel-text"), systemText(line.systemPanel?.text || line.text || ""));
    } else {
      const speakerName = $("#speaker-name");
      speakerName.hidden = !line.speaker;
      speakerName.textContent = line.speaker || "";
      dialogue.classList.toggle("is-narration", !line.speaker);
      dialogue.dataset.tone = line.tone;
      startTypewriter($("#dialogue-text"), line.text);
    }

    refreshCutsceneComposition();
    renderResearchMedia(shot);
    if(shot.flashReturn && !motionReduced() && !state.effectsReduced) {
      const at=state.lineIndex,image=cutsceneMode ? $('#memory-image') : $('#stage-camera');
      bFlashTimer=setTimeout(()=>{
        bFlashTimer=null;
        if(state.screen!=='story-screen' || currentRecord()?.id!==record.id || state.lineIndex!==at || !image?.isConnected)return;
        image.src=media.url(shot.flashReturn);
        const restored={...shot,src:shot.flashReturn,flashReturn:null};
        activeCutsceneShot=restored;delete image.dataset.geometry;
        (image.decode ? image.decode() : Promise.resolve()).then(()=>{
          if(activeCutsceneShot===restored)refreshCutsceneComposition();
        }).catch(()=>{});
      },shot.flashDuration || 950);
    }
    window.RustedPrayerSfx?.syncScene(record,state.lineIndex,state.telemetryPage,state.screen);
    saveProgress();
    updateBookmarkButton();
    rememberView();
  }

  function advanceLine() {
    if (syncResetFromStorage()) return;
    if (state.isTyping) {
      finishTyping();
      return;
    }
    nextLine();
  }

  function nextLine(automatic = false) {
    if (syncResetFromStorage()) return;
    if (state.screen !== 'story-screen' || state.loading) return;
    if (automatic && (state.menuOpen || $('#story-options').open)) return;
    if (state.advanceLocked || state.attachmentPending) return;
    if (!automatic && state.beatPresses++ < (currentStory()[state.lineIndex]?.readingBeat?.extraManualPresses || 0)) return;
    const story = currentStory();
    const line=story[state.lineIndex];
    const pages=line && line.instrument!=='scan' && (line.tone==='telemetry' || line.instrument==='drone') ? (line.telemetryPages || telemetryPages(line.text)) : [line?.text || ''];
    if (state.telemetryPage < pages.length-1) {
      state.telemetryPage+=1;
      renderLine();
      return;
    }
    if (state.lineIndex >= story.length - 1) {
      completeRecord();
      return;
    }
    state.lineIndex += 1;
    renderLine();
  }

  function previousLine() {
    if (syncResetFromStorage()) return;
    if (state.screen !== 'story-screen' || state.loading) return;
    if (state.telemetryPage > 0) {
      state.telemetryPage-=1;
      renderLine();
      return;
    }
    if (state.lineIndex === 0) return;
    state.lineIndex -= 1;
    const line=currentStory()[state.lineIndex];
    const pages=line && line.instrument!=='scan' && (line.tone==='telemetry' || line.instrument==='drone') ? (line.telemetryPages || telemetryPages(line.text)) : [line?.text || ''];
    state.telemetryLineIndex=state.lineIndex;
    state.telemetryPage=pages.length-1;
    renderLine();
  }

  function completeRecord() {
    const record = currentRecord();
    if (!isRecordUnlocked(record)) return;
    clearPlaybackTimers();
    state.isTyping = false;
    rememberView();
    const progress = recordProgress(record.id);
    progress.completed = true;
    progress.lineIndex = 0;
    progress.inProgress = false;
    if(record.readerMode==='report')progress.reportScroll=0;
    progress.telemetryPage = 0;
    if (state.progress.resumeRecordId===record.id) delete state.progress.resumeRecordId;
    state.lineIndex = 0;
    saveProgress();
    if(record.relatedReport) {
      state.archiveRecordKind='related';selectDisk('D');showScreen('archive-screen');return;
    }
    const next = continuousNext(record);
    if (next) { openRecordTransition(record, next); return; }
    state.auto = false;
    updateAutoButton();
    renderCompletion(record);
    showScreen("complete-screen");
    if (!record.nextId && allRecordsRead()) openEnding('replace');
  }

  function continuousNext(record) {
    const next = archive.getRecord(record?.nextId);
    return state.continuous && next && CONTINUOUS_LINKS[record?.id] === next.id &&
      next.diskId === record.diskId && next.readerMode !== 'report' && next.story.length && isRecordUnlocked(next) ? next : null;
  }

  function openRecordTransition(record, next, historyMode = 'push', paused = false) {
    state.transitionPaused=paused;
    state.transition = {fromId:record.id, toId:next.id};
    $('#transition-kicker').textContent = `${recordNumber(record)} 열람 완료 · 이어지는 기록`;
    $('#transition-completion').textContent = record.completion?.message || `${record.fileName} 열람을 완료했습니다.`;
    $('#transition-title').textContent = `${recordNumber(next)} · ${next.title}`;
    $('#transition-file').textContent = next.fileName;
    $('#transition-meta').textContent = `무결성 ${next.integrity}`;
    $('#transition-meta').hidden = next.objective.some(item => item.type !== 'separator' && item.text);
    const transitionMetadataState={skipValue:false};
    $('#transition-intro').innerHTML = next.objective.filter(item => item.type !== 'separator')
      .map(item => stripTechnicalMetadata(item.text,transitionMetadataState)).filter(Boolean)
      .map(text => `<p>${escapeHtml(text)}</p>`).join('');
    updateAutoButton();
    showScreen('transition-screen', historyMode);
    scheduleAutoAdvance();
  }

  function continueRecordTransition() {
    if (state.screen !== 'transition-screen' || state.loading || !state.transition) return;
    clearTimeout(state.autoTimer);
    const next = continuousNext(currentRecord());
    if (next?.id !== state.transition.toId) { stopRecordTransition(); return; }
    // Commit the new record only after loading succeeds; cancelling keeps this card.
    // A linked event always starts at its beginning, even if it was read before.
    startStory(true, 0, 'push', next);
  }

  function stopRecordTransition() {
    clearPlaybackTimers();
    state.transition = null;
    state.transitionPaused = false;
    state.auto = false;
    state.autoEnabled = false;
    saveProgress();
    updateAutoButton();
    renderCompletion(currentRecord());
    showScreen('complete-screen', 'replace');
  }

  function updateContinuousButtons() {
    ['#continuous-button', '#objective-continuous'].forEach(selector => {
      $(selector).setAttribute('aria-pressed', String(state.continuous));
      $(selector).classList.toggle('is-active', state.continuous);
      $(selector).textContent = `연속 재생 ${state.continuous ? '켜짐' : '꺼짐'}`;
    });
  }

  function renderCompletion(record) {
    const completion = record.completion || {};
    const stats = completion.stats?.length
      ? completion.stats
      : [
          ["원본 무결성", record.integrity],
          ["열람 상태", "완료"],
        ];
    $("#complete-kicker").textContent = record.story.length ? "장면 재구성 완료" : "기록 열람 완료";
    $("#complete-title").textContent = `${recordNumber(record)} 열람 완료`;
    $("#complete-message").textContent = completion.message || `${record.fileName} 열람을 완료했습니다.`;
    $("#complete-stats").innerHTML = stats
      .map(([term, value]) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd></div>`)
      .join("");
    const next = archive.getRecord(record.nextId);
    $("#next-record").hidden = !next;
    $("#next-record").textContent = next ? `다음 기록 · ${recordNumber(next)}` : '';
    $('#complete-next-hint').hidden = !next;
    $('#complete-ending').hidden = Boolean(next) || !allRecordsRead();
  }

  function toggleAuto() {
    state.auto = !state.auto;
    state.autoEnabled = state.auto;
    saveProgress();
    updateAutoButton();
    if (state.screen==='transition-screen') rememberView();
    if (state.auto) scheduleAutoAdvance();
    else clearTimeout(state.autoTimer);
  }

  function updateAutoButton() {
    $("#auto-button").classList.toggle("is-active", state.auto);
    $("#auto-button").setAttribute('aria-pressed', String(state.auto));
    $("#auto-button").textContent = state.auto ? "● 자동" : "○ 자동";
    $('#transition-auto').setAttribute('aria-pressed', String(state.auto));
    $('#transition-auto').textContent = state.auto ? state.transitionPaused ? '자동 읽기 끄기' : '자동 읽기 멈추기' : '자동 읽기 켜기';
    $('#transition-next').textContent = state.transitionPaused ? state.auto ? '자동으로 이어보기 ›' : '수동으로 이어보기 ›' : '다음 기록 재생 ›';
    $('#transition-hint').textContent = state.transitionPaused
      ? `불러오기를 일시 정지했습니다. 아래 버튼을 누르면 ${state.auto ? '자동' : '수동'}으로 이어집니다.`
      : state.auto ? '잠시 후 다음 기록을 자동으로 재생합니다.' : '계속하려면 아래 버튼 또는 Space · Enter를 누르세요.';
  }

  function toggleUi() {
    state.uiHidden = !state.uiHidden;
    $("#story-stage").classList.toggle("ui-hidden", state.uiHidden);
    if (state.uiHidden) clearTimeout(state.autoTimer);
    else scheduleAutoAdvance();
  }

  function setLogOpen(open) {
    $('#backlog').hidden = !open;
    $('#backlog-dismiss').hidden = !open;
    $('#log-button').setAttribute('aria-expanded',String(open));
  }

  function toggleLog() {
    const backlog = $("#backlog");
    setLogOpen(backlog.hidden);
    if (!backlog.hidden) {
      clearTimeout(state.autoTimer);
      buildBacklog();
      backlog.scrollTop = backlog.scrollHeight;
      backlog.focus({preventScroll:true});
    } else {
      scheduleAutoAdvance();
      $('#story-screen').focus({preventScroll:true});
    }
  }

  function buildBacklog() {
    const story = currentStory();
    $("#backlog-list").innerHTML = story
      .slice(0, state.lineIndex + 1)
      .map((line,index) => ({line,index}))
      .filter(({line}) => line.text || line.memoryTitle || line.cutsceneTitle || line.systemPanel)
      .map(({line,index}) => {
        const cutsceneLabel = line.cutscene?.label || (line.tone === "memory" ? "기억 파편" : "장면 재구성");
        const label = line.speaker || line.cardTitle || (["memory", "cutscene"].includes(line.tone) ? cutsceneLabel : line.systemPanel?.kicker || "");
        const panelText = line.systemPanel ? `${line.systemPanel.title} ${line.systemPanel.text}`.trim() : "";
        const cutsceneText = `${line.memoryTitle || line.cutsceneTitle || ""} ${line.memoryCaption || line.cutsceneCaption || ""}`.trim();
        const text = storyPages(line).length>1 ? readableText(currentRecord(),index)
          : line.rows ? visibleRows(line.rows).map(row=>(row.speaker ? row.speaker + ': ' : '') + row.text).join('\n') : stripTechnicalMetadata(line.text || (["memory", "cutscene"].includes(line.tone) ? cutsceneText : panelText));
        return `
          <li>
            ${label ? `<strong>${escapeHtml(label)}</strong>` : ""}
            <span>${escapeHtml(text)}</span>
            <div class="backlog-actions"><button class="text-button" data-action="jump-location" data-jump-record="${escapeHtml(currentRecord().id)}" data-jump-index="${index}" type="button">이 장면으로 이동</button>${bookmarkControl(currentRecord(),index)}</div>
          </li>
        `;
      })
      .join("");
  }

  function exitStory() {
    saveProgress();
    clearPlaybackTimers();
    state.isTyping = false;
    state.auto = false;
    updateAutoButton();
    setLogOpen(false);
    goBack();
  }

  function handleAction(action, target = null) {
    if (syncResetFromStorage()) return;
    if (state.loading) return;
    if (state.screen === 'reset-screen' && !['cancel-reset','confirm-reset','export-progress'].includes(action)) return;
    if (!$('#profile-overlay').hidden && action !== 'close-profile') return;
    if (!$("#backlog").hidden && !['toggle-log','jump-location','bookmark-location','show-library'].includes(action)) return;
    if (state.screen==='archive-screen' && target?.closest('#archive-tools')) {
      state.archiveToolsOpen=false;syncArchiveTools();
    }
    $('#story-options').open = false;
    const actions = {
      'settings-category':()=>selectSettingsCategory(target?.dataset.settingsCategory),
      'd-record-kind':()=>{rememberArchiveScroll();state.archiveRecordKind=target?.dataset.kind==='related' ? 'related' : 'main';selectDisk('D');restoreArchiveScroll();},
      'open-d-report':()=>{const record=archive.getRecord(target?.dataset.reportId);if(record?.diskId==='D'&&record.readerMode==='report'&&isRecordUnlocked(record)){const mode=currentRecord()?.relatedReport?'replace':'push';if(!currentRecord()?.relatedReport)captureReportContext();rememberView();state.selectedRecordId=record.id;state.archiveRecordKind=record.relatedReport?'related':'main';selectDisk('D',false);openObjective(mode);}},
      'show-related':()=>{captureReportContext();clearPlaybackTimers();state.auto=false;updateAutoButton();saveProgress();state.archiveRecordKind='related';selectDisk('D');showScreen('archive-screen');},
      'resume-main':resumeDMain,
      'archive-pane':()=>moveArchivePane(Number(target?.dataset.archivePane)),
      'archive-open-record':()=>{if(isRecordUnlocked(currentRecord())){state.archiveToolsOpen=false;syncArchiveTools();openObjective();}},
      'toggle-archive-tools':()=>{state.archiveToolsOpen=!state.archiveToolsOpen;syncArchiveTools();},
      'toggle-story-menu':()=>{setStoryMenu(!state.menuOpen);$('#story-screen').focus({preventScroll:true});},
      'show-gallery':()=>{clearPlaybackTimers();state.auto=false;updateAutoButton();renderGallery();showScreen('gallery-screen');},
      'filter-gallery':()=>{
        const filter=target?.dataset.galleryFilter || 'all';
        if(filter==='ending') {openEnding();return;}
        state.galleryFilter=filter;state.galleryIndex=0;renderGallery();
      },
      'open-gallery-image':()=>openGalleryImage(Number(target?.dataset.galleryIndex)),
      'close-gallery-image':closeGalleryImage,
      'gallery-prev':()=>openGalleryImage(state.galleryIndex-1),
      'gallery-next':()=>openGalleryImage(state.galleryIndex+1),
      "open-reset": openReset,
      "cancel-reset": cancelReset,
      "confirm-reset": confirmReset,
      "open-profile": () => openProfile(target?.dataset.profile,target),
      "close-profile": closeProfile,
      "back-archive": goBack,
      "show-archive": () => { rememberReportPosition();saveProgress();state.reportContext=null;state.archiveRecordKind=currentRecord()?.relatedReport ? 'related' : 'main';selectDisk(state.selectedDisk); showScreen('archive-screen'); },
      "exit-story": exitStory,
      "toggle-log": toggleLog,
      "toggle-ui": toggleUi,
      "toggle-auto": toggleAuto,
      "show-settings": openReadingSettings,
      "show-dialogue-settings": () => {
        if(state.screen!=='settings-screen')openReadingSettings();
        selectSettingsCategory('display');
        $('#setting-dialogue-position').focus();
      },
      "show-identity-settings": () => {
        if(state.screen!=='settings-screen')openReadingSettings();
        selectSettingsCategory('display');
        $('#setting-identities').focus();
      },
      'start-prepared-story':()=>{
        if(state.screen==='settings-screen' && state.settingsStartRecordId===currentRecord()?.id && currentRecord()?.readerMode!=='report') startStory(false,null,'replace');
      },
      "show-library": () => pauseForReadingScreen('library-screen'),
      "toggle-bookmark": () => toggleBookmark(),
      "bookmark-location": () => toggleBookmark(target?.dataset.jumpRecord,Number(target?.dataset.jumpIndex)),
      "jump-location": () => openReadLocation(target?.dataset.jumpRecord,Number(target?.dataset.jumpIndex)),
      "library-record-more": () => { const id=target?.dataset.libraryRecord; if (!readableLines(archive.getRecord(id)).length) return; state.libraryRecordLimits[id]=(state.libraryRecordLimits[id] || 3)+3; renderLibrary(); },
      "export-progress": exportProgress,
      "view-ending": () => openEnding(),
      "return-ending": () => state.endingFromGallery ? goBack() : handleAction('finish-record'),
      'toggle-ending-details':toggleEndingDetails,
      "toggle-continuous": () => {
        state.continuous = !state.continuous;
        updateContinuousButtons();
        saveProgress();
      },
      "continue-transition": continueRecordTransition,
      "stop-transition": stopRecordTransition,
      "previous-line": previousLine,
      "next-line": advanceLine,
      "acknowledge-insert": () => {
        if (state.advanceLocked || !state.attachmentPending) return;
        state.attachmentPending=false;
        nextLine();
      },
      "complete-report": () => {
        if(state.screen!=='objective-screen' || currentRecord()?.readerMode!=='report')return;
        if(validReportContext()) {
          if(!currentRecord().relatedReport){continueMainReport();return;}
          const progress=recordProgress(currentRecord().id);progress.completed=true;progress.inProgress=false;saveProgress();returnReportMain();return;
        }
        completeRecord();
      },
      "toggle-instant": () => {
        state.instant = !state.instant;
        updateInstantButton();
        if (state.instant && state.isTyping) finishTyping();
        saveProgress();
      },
      "next-record": () => {
        const next = archive.getRecord(currentRecord()?.nextId);
        if (!next || !recordProgress(currentRecord().id).completed || !isRecordUnlocked(next)) return;
        state.selectedRecordId = next.id;
        selectDisk(next.diskId);
        openObjective();
      },
      "finish-record": () => {
        selectDisk(currentRecord().diskId);
        showScreen("archive-screen");
        document.querySelector(`[data-record="${state.selectedRecordId}"]`)?.scrollIntoView?.({block:'nearest'});
      },
    };
    actions[action]?.();
  }

  function updateInstantButton() {
    $("#instant-button").classList.toggle('is-active', state.instant);
    $("#instant-button").setAttribute('aria-pressed', String(state.instant));
  }

  function openReadingSettings() {
    const record=currentRecord();
    state.settingsStartRecordId=state.screen==='objective-screen' && record?.readerMode!=='report' && record?.story.length ? record.id : null;
    if(state.settingsStartRecordId) {
      state.progress.readingSetupSeen=true;
      saveProgress();
      syncReadingSetupGuide();
    }
    pauseForReadingScreen('settings-screen');
  }

  function rememberSettingsPlayback() {
    state.settingsPlaybackReturn=['story-screen','transition-screen'].includes(state.screen)
      ? {screen:state.screen,recordId:state.selectedRecordId,lineIndex:state.lineIndex,
        telemetryPage:state.screen==='story-screen' ? state.telemetryPage : 0,
        auto:state.auto,resetGeneration:state.progress.resetGeneration || 0} : null;
  }

  function pauseForReadingScreen(id) {
    if(state.screen==='objective-screen'){rememberReportPosition();saveProgress();}
    if (id==='settings-screen') rememberSettingsPlayback();
    if (state.isTyping) finishTyping();
    clearPlaybackTimers();
    state.auto = false;
    state.uiHidden = false;
    setLogOpen(false);
    updateAutoButton();
    rememberView();
    if (id === 'settings-screen') renderSettings();
    else renderLibrary();
    showScreen(id);
  }

  function applyReadingSettings() {
    $('#app').dataset.textSize = state.textSize;
    $('#app').dataset.dialoguePosition = state.dialoguePosition;
    $('#app').dataset.reducedEffects = String(state.effectsReduced);
    $('#app').setAttribute('style', `--reading-scale:${{small:.9,normal:1,large:1.2}[state.textSize]}`);
    updateInstantButton();
    updateContinuousButtons();
  }

  function renderSettings() {
    $('#settings-start-story').hidden=state.settingsStartRecordId!==currentRecord()?.id || currentRecord()?.readerMode==='report';
    $('#setting-size').value = state.textSize;
    $('#setting-dialogue-position').value = state.dialoguePosition;
    $('#setting-speed').value = state.instant ? 'instant' : state.textSpeed;
    $('#setting-auto').value = state.autoSpeed;
    $('#setting-remember-auto').value = state.rememberAuto ? 'on' : 'off';
    $('#setting-effects').value = state.effectsReduced ? 'reduced' : 'normal';
    $('#setting-ending-group').hidden = !allRecordsRead();
    $('#setting-ending').value = state.endingAnimation ? 'show' : 'skip';
    $('#setting-identities').value = state.characterLabels ? 'on' : 'off';
    $('#setting-resume').value = state.autoResume ? 'on' : 'off';
    $('#setting-motion-note').textContent = reduceMotion ? '기기의 동작 줄이기가 적용 중입니다.' : '흔들림과 화면 전환 효과를 줄일 수 있습니다.';
    applyReadingSettings();
    selectSettingsCategory(state.settingsStartRecordId ? 'reading' : state.settingsCategory);
  }

  function selectSettingsCategory(category,focus=false) {
    const categories=['reading','display','audio','shortcuts','data'];
    state.settingsCategory=categories.includes(category) ? category : 'reading';
    document.querySelectorAll('[data-settings-panel]').forEach(panel=>{panel.hidden=panel.dataset.settingsPanel!==state.settingsCategory;});
    document.querySelectorAll('[data-settings-category]').forEach(button=>{
      const active=button.dataset.settingsCategory===state.settingsCategory;
      button.setAttribute('aria-selected',String(active));button.setAttribute('tabindex',active?'0':'-1');
    });
    if(focus)$('#settings-tab-'+state.settingsCategory).focus({preventScroll:true});
    startSettingsPreview();
  }

  function changeReadingSettings() {
    state.textSize = $('#setting-size').value;
    state.dialoguePosition = ['left','center','right'].includes($('#setting-dialogue-position').value) ? $('#setting-dialogue-position').value : defaultDialoguePosition();
    const speed = $('#setting-speed').value;
    state.instant = speed === 'instant';
    if (!state.instant) state.textSpeed = speed;
    state.autoSpeed = $('#setting-auto').value;
    state.rememberAuto = $('#setting-remember-auto').value === 'on';
    state.effectsReduced = $('#setting-effects').value === 'reduced';
    state.characterLabels = $('#setting-identities').value === 'on';
    state.autoResume = $('#setting-resume').value === 'on';
    if (allRecordsRead()) state.endingAnimation = $('#setting-ending').value !== 'skip';
    applyReadingSettings();
    saveProgress();
    startSettingsPreview();
  }

  function startSettingsPreview() {
    clearTimeout(state.previewTimer);
    if (state.screen !== 'settings-screen' || state.settingsCategory!=='reading' || document.hidden) return;
    const samples = [
      {kind:'짧은 대사',text:'우리가 함께한 시간은 기록 속에 남아 있다.'},
      {kind:'효과음',text:'탕-!'},
      {kind:'긴 설명',text:'다시 펼친 기록 속에서 다섯 명이 웃고 있다. 서로의 이름을 부르던 목소리와 함께 걸어온 시간은, 오래된 기록 속에도 선명하게 남아 있었다.'}
    ];
    let sample = 0;
    const showSample = () => {
      const {text,kind} = samples[sample++ % samples.length];
      const preview = $('#settings-preview');
      preview.className = 'settings-preview';
      if (!motionReduced()) { void preview.offsetWidth; preview.classList.add(state.effectsReduced ? 'preview-soft' : 'preview-full'); }
      let index = state.instant ? text.length : 0;
      let credit=0,wait=120;
      $('#preview-progress').value = 0;
      $('#reading-sample').textContent=state.instant ? text : '';
      $('#preview-status').textContent=`${kind} · 문자 출력 중`;
      const type = () => {
        if (state.screen !== 'settings-screen' || state.settingsCategory!=='reading' || document.hidden) return;
        if (index < text.length) {
          credit+=wait;index+=1;
          $('#reading-sample').textContent = text.slice(0,index);
          if(index<text.length) {
            const character = text[index-1];
            wait=Math.round((/[.!?·。]/.test(character) ? 105 : character===' ' ? 18 : 34)*speedFactor(state.textSpeed));
            state.previewTimer=setTimeout(type,wait);return;
          }
        }
        {
          const total = Math.max(250,readingDuration(text)-credit);
          let remaining = total;
          const tick = () => {
            $('#preview-status').textContent = `${kind} · 다음 문장까지 ${(remaining/1000).toFixed(1)}초`;
            $('#preview-progress').value = Math.round((total-remaining)/total*100);
            if (remaining <= 0) { showSample(); return; }
            remaining = Math.max(0,remaining-100);
            state.previewTimer = setTimeout(tick,100);
          };
          tick();
        }
      };
      if(state.instant)type();else state.previewTimer=setTimeout(type,120);
    };
    showSample();
  }

  function readableLines(record) {
    if (!record || !isRecordUnlocked(record)) return [];
    const progress = recordProgress(record.id);
    if (record.readerMode === 'report') return progress.completed ? record.reportSections : [];
    if (progress.completed) return record.story;
    const seen = Math.max(progress.lineIndex || 0, Number.isInteger(progress.seenIndex) ? progress.seenIndex : -1);
    return progress.lineIndex > 0 || Number.isInteger(progress.seenIndex) ? record.story.slice(0, seen+1) : [];
  }

  function bookmarkAt(recordId,index) {
    return (state.progress.bookmarks || []).some(mark => mark.recordId === recordId && mark.index === index);
  }

  function bookmarkControl(record,index) {
    const marked = bookmarkAt(record.id,index);
    return `<button class="text-button" data-action="bookmark-location" data-jump-record="${escapeHtml(record.id)}" data-jump-index="${index}" type="button" aria-pressed="${marked}">${marked ? '★ 북마크 해제' : '☆ 북마크'}</button>`;
  }

  function updateBookmarkButton() {
    const marked = bookmarkAt(state.selectedRecordId,state.lineIndex);
    $('#bookmark-button').textContent = marked ? '★ 북마크' : '☆ 북마크';
    $('#bookmark-button').setAttribute('aria-pressed',String(marked));
  }

  function toggleBookmark(recordId = state.selectedRecordId, index = state.lineIndex) {
    const record = archive.getRecord(recordId), line = readableLines(record)[index];
    if (!line) return;
    state.progress.bookmarks ||= [];
    if (bookmarkAt(recordId,index)) state.progress.bookmarks = state.progress.bookmarks.filter(mark => mark.recordId !== recordId || mark.index !== index);
    else state.progress.bookmarks.push({recordId,index,text:line.text});
    saveProgress();
    updateBookmarkButton();
    if (state.screen === 'library-screen') renderLibrary();
    if (!$('#backlog').hidden) buildBacklog();
  }

  function libraryMatches(query) {
    const diskQuery=/^[a-d]$/.test(query);
    const codeQuery=/^[a-d][\s-]?(?:r[\s-]?)?\d+(?:[\s-]\d+)?$/.test(query);
    const compact=value=>value.toLocaleLowerCase().replace(/[\s-]/g,'');
    return orderedRecords.flatMap(record=>{
      const lines=readableLines(record);
      if(!lines.length)return [];
      if(!query) {
        const matches=lines.map((line,index)=>({line,index})).filter(({index})=>bookmarkAt(record.id,index));
        return matches.length ? [{record,matches,recordMatch:false}] : [];
      }
      // Record names/codes match one record, never every line within that record.
      const recordMatch=diskQuery ? record.diskId.toLocaleLowerCase()===query : codeQuery ? compact(recordNumber(record))===compact(query) :
        `${record.title} ${record.fileName || ''}`.toLocaleLowerCase().includes(query);
      if(recordMatch)return [{record,matches:[],recordMatch:true}];
      if(diskQuery || codeQuery)return [];
      const matches=lines.map((line,index)=>({line,index})).filter(({line,index})=>
        `${line.speaker || ''} ${line.cardTitle || ''} ${readableText(record,index)}`.toLocaleLowerCase().includes(query));
      return matches.length ? [{record,matches,recordMatch:false}] : [];
    });
  }

  function libraryExcerpt(text,query) {
    const match=query ? text.toLocaleLowerCase().indexOf(query) : -1;
    const start=match>70 ? match-45 : 0;
    const excerpt=(start?'…':'')+text.slice(start,start+180)+(text.length>start+180?'…':'');
    const at=query ? excerpt.toLocaleLowerCase().indexOf(query) : -1;
    return at<0 ? escapeHtml(excerpt) : escapeHtml(excerpt.slice(0,at))+'<mark>'+escapeHtml(excerpt.slice(at,at+query.length))+'</mark>'+escapeHtml(excerpt.slice(at+query.length));
  }

  function librarySceneItem(record,line,index,query) {
    const marked=bookmarkAt(record.id,index);
    const location=`${record.readerMode==='report'?'항목':'본문'} ${index+1}`;
    const label=recordNumber(record)+' · '+location;
    return `<li class="library-scene"><button class="text-button library-scene-jump" data-action="jump-location" data-jump-record="${escapeHtml(record.id)}" data-jump-index="${index}" type="button"><span class="library-location">${escapeHtml(location)} ›</span><span class="library-scene-copy">${line.speaker ? `<b>${escapeHtml(line.speaker)}</b> ` : ''}${libraryExcerpt(readableText(record,index),query)}</span></button><button class="text-button" data-action="bookmark-location" data-jump-record="${escapeHtml(record.id)}" data-jump-index="${index}" type="button" aria-pressed="${marked}" aria-label="${escapeHtml(label)} 북마크 ${marked?'해제':'추가'}">${marked?'★':'☆'}<span class="bookmark-label"> 북마크</span></button></li>`;
  }

  function libraryRecordGroup({record,matches,recordMatch},query) {
    const label=recordNumber(record)+' · '+record.title;
    const limit=state.libraryRecordLimits[record.id] || 3;
    const remaining=Math.max(0,matches.length-limit);
    const kind=query?'검색 결과':'북마크';
    const status=recordMatch ? '기록 일치' : `${query?'본문 일치':'북마크'} ${matches.length}곳`;
    return `<li class="library-record"><div class="library-record-heading"><div class="library-record-title"><h3>${escapeHtml(label)}</h3><p>${status}</p></div><button class="text-button library-record-open" data-action="jump-location" data-jump-record="${escapeHtml(record.id)}" data-jump-index="0" type="button" aria-label="${escapeHtml(label)} ${record.readerMode==='report'?'열기':'처음부터 보기'}">${record.readerMode==='report'?'보고서 열기':'처음부터 보기'} ›</button></div>${matches.length ? `<ol class="library-scenes">${matches.slice(0,limit).map(({line,index})=>librarySceneItem(record,line,index,query)).join('')}</ol>`:''}${remaining ? `<button class="text-button library-record-more" type="button" data-action="library-record-more" data-library-record="${escapeHtml(record.id)}">${kind} 더 보기 · ${remaining}곳 남음</button>`:''}</li>`;
  }

  function renderLibrary() {
    const focused=document.activeElement;
    const restoreFocus=focused?.closest?.('#library-list') ? {...focused.dataset} : null;
    const query=$('#library-search').value?.trim().toLocaleLowerCase() || '';
    const groups=libraryMatches(query);
    const count=groups.reduce((sum,group)=>sum+group.matches.length,0);
    $('#library-help').textContent=query ? '기록별로 묶어 표시합니다. 본문을 누르면 그 위치로 이동합니다.' : 'D로 D편을, D01로 한 기록을 찾을 수 있습니다. 읽은 구간만 검색합니다.';
    $('#library-count').textContent=query ? (groups.length ? `${groups.length}개 기록${count ? ` · 본문 일치 ${count}곳`:''}` : '검색 결과가 없습니다.') :
      count ? `북마크 ${count}개 · ${groups.length}개 기록` : '아직 북마크가 없습니다. 재생 중 ☆ 북마크로 저장하세요.';
    $('#library-list').innerHTML=archive.getDisks().map(disk=>{
      const diskGroups=groups.filter(({record})=>record.diskId===disk.id);
      return diskGroups.length ? `<li class="library-disk"><h2>${escapeHtml(disk.id+' · '+disk.label)}</h2><ol class="library-records">${diskGroups.map(group=>libraryRecordGroup(group,query)).join('')}</ol></li>` : '';
    }).join('');
    if(restoreFocus?.action) {
      const selector=`[data-action="${restoreFocus.action}"]${restoreFocus.libraryRecord ? `[data-library-record="${restoreFocus.libraryRecord}"]` : `[data-jump-record="${restoreFocus.jumpRecord}"][data-jump-index="${restoreFocus.jumpIndex}"]`}`;
      // A removed bookmark or exhausted "more" button must not lose keyboard focus.
      const recordId=restoreFocus.libraryRecord || restoreFocus.jumpRecord;
      ($('#library-list').querySelector(selector) || $('#library-list').querySelector(`[data-action="jump-location"][data-jump-record="${recordId}"]`) || $('#library-search')).focus({preventScroll:true});
    }
  }

  async function openReadLocation(recordId,index) {
    const record = archive.getRecord(recordId);
    if (!Number.isInteger(index) || !readableLines(record)[index]) return;
    clearPlaybackTimers();
    state.auto = false;
    updateAutoButton();
    setLogOpen(false);
    rememberView();
    if (record.readerMode === 'report') {
      state.reportContext=null;
      state.selectedRecordId = record.id;
      state.archiveRecordKind=record.relatedReport ? 'related' : 'main';
      selectDisk(record.diskId,false);
      await openObjective();
      $('#report-section-'+index)?.scrollIntoView?.({block:'start'});
    } else await startStory(false,index,'push',record);
  }

  function allRecordsRead() {
    return mainRecords.every(record => recordProgress(record.id).completed);
  }

  async function openEnding(historyMode = 'push', fromGallery = state.screen==='gallery-screen') {
    if (!allRecordsRead()) return;
    clearPlaybackTimers();
    state.auto = false;
    updateAutoButton();
    const attempt = ++state.endingAttempt;
    const ending = window.RustedPrayerMediaManifest?.ending || {};
    const fromScreen = state.screen;
    await loadTransition('마지막 사진', {id:'ENDING',story:[],defaultVisual:{backgroundSrc:ending.src}}, state.endingAnimation ? 420 : 0, false, async signal => {
      const current=()=>!signal.aborted && attempt===state.endingAttempt && state.screen===fromScreen && allRecordsRead();
      const image = $('#ending-image');
      image.hidden = false;
      $('#ending-unavailable').hidden = true;
      image.alt = ending.alt || '연화, 유라, 세린, 가은, 초희가 함께 찍은 사진';
      if (ending.src) {
        image.src = media.url(ending.src);
        try { if (image.decode) await image.decode(); }
        catch {
          if(!current())return false;
          image.hidden = true; $('#ending-unavailable').hidden = false;
        }
      } else {
        image.hidden = true; $('#ending-unavailable').hidden = false;
      }
      if(!current())return false;
      return ()=>{
        if(!current())return false;
        if(fromGallery)closeGalleryImage(false);
        const parent=validReportContext();
        if(parent && archive.getRecord(parent.recordId)?.epilogue){state.selectedRecordId=parent.recordId;state.archiveRecordKind='main';selectDisk('D',false);}
        state.endingFromGallery=fromGallery;
        setEndingDetails(false);
        $('#ending-board-image').src=media.url(ending.board?.src || './assets/cutscenes/ending-board-writing.png');
        $('.ending-return').textContent=fromGallery ? '갤러리로 돌아가기' : '보관소로 돌아가기';
        $('#ending-screen').dataset.entrance = !image.hidden && state.endingAnimation && !motionReduced() ? 'first' : '';
        showScreen('ending-screen',historyMode);
        scheduleEndingShutter();
        return true;
      };
    },historyMode!=='none' && !fromGallery);
  }

  function setEndingDetails(open) {
    state.endingDetailsOpen=Boolean(open && !$('#ending-image').hidden);
    const expanded=state.endingDetailsOpen;
    $('#ending-screen').dataset.details=expanded ? 'open' : 'closed';
    $('#ending-people').hidden=!expanded;
    $('#ending-details').hidden=!expanded;
    $('.ending-frame').setAttribute('aria-expanded',String(expanded));
    $('.ending-frame').setAttribute('aria-label',expanded ? '사진 정보 닫기' : '사진 정보 보기');
    $('#ending-details-toggle').setAttribute('aria-expanded',String(expanded));
    $('#ending-details-toggle').textContent=expanded ? '사진 정보 닫기' : '사진 정보 보기';
    $('#ending-details-toggle').hidden=$('#ending-image').hidden;
  }

  function toggleEndingDetails() {
    if(state.screen!=='ending-screen' || $('#ending-image').hidden)return;
    finishEndingEntrance();
    setEndingDetails(!state.endingDetailsOpen);
    window.RustedPrayerSfx?.play(state.endingDetailsOpen ? 'select' : 'cancel');
  }

  function clearEndingShutter() {
    clearTimeout(state.endingShutterTimer);state.endingShutterTimer=null;
  }

  function scheduleEndingShutter() {
    clearEndingShutter();
    const visible=()=>state.screen==='ending-screen' && $('#ending-screen').dataset.entrance==='first' &&
      !$('#ending-image').hidden && !motionReduced() && !state.effectsReduced && !document.hidden;
    if(!visible())return;
    const attempt=state.endingAttempt;
    // camera-shutter begins closing at 60% of its 2.6-second CSS animation.
    state.endingShutterTimer=setTimeout(()=>{
      state.endingShutterTimer=null;
      if(attempt===state.endingAttempt && visible())window.RustedPrayerSfx?.play('shutter');
    },1560);
  }

  function finishEndingEntrance() {
    clearEndingShutter();
    if (state.screen === 'ending-screen') $('#ending-screen').dataset.entrance = '';
  }

  function openReset() {
    if (state.screen !== 'settings-screen' || state.loading) return;
    clearPlaybackTimers(); clearTimeout(state.previewTimer);
    state.auto = false; updateAutoButton();
    $('#reset-keep-bookmarks').checked = false;
    $('#reset-status').textContent = '';
    const completed = orderedRecords.filter(record => recordProgress(record.id).completed).length;
    $('#reset-summary').textContent = `현재 ${completed} / ${orderedRecords.length}개 기록을 완료했습니다.`;
    showScreen('reset-screen','replace');
    $('#reset-cancel').focus();
  }

  function cancelReset() {
    if (state.screen !== 'reset-screen') return;
    renderSettings(); showScreen('settings-screen','replace');
    $('#reset-open').focus();
  }

  function adoptReset(saved, message) {
    state.settingsPlaybackReturn=null;
    state.transitionPaused=false;
    cancelLoading(); clearPlaybackTimers(); clearTimeout(state.previewTimer);
    closeProfile(false);
    state.auto = false; state.isTyping = false; state.uiHidden = false;
    state.transition = null; state.attachmentPending = false; state.beatPresses = 0;
    state.lineIndex = 0; state.selectedRecordId = null;
    state.endingAttempt += 1;
    $('#ending-screen').dataset.entrance = '';
    loadProgress(saved);
    setLogOpen(false); $('#story-options').open = false;
    $('#backlog-list').innerHTML = ''; $('#library-list').innerHTML = '';
    $('#library-search').value = ''; state.libraryRecordLimits = {};
    $('#ending-image').hidden = true; $('#ending-image').removeAttribute('src');
    selectReadingPosition();
    updateAutoButton(); updateInstantButton(); updateContinuousButtons(); applyReadingSettings();
    showScreen('archive-screen','replace');
    history.replaceState({...viewState(),depth:0},'');
    $('#archive-notice').textContent = message; $('#archive-notice').hidden = false;
  }

  function syncResetFromStorage() {
    if (!storageAvailable) return false;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const generation = Number.isSafeInteger(saved?.resetGeneration) ? saved.resetGeneration : 0;
      if (generation <= (state.progress.resetGeneration || 0)) return false;
      adoptReset(saved,'다른 창에서 읽기 진행이 초기화되어 새 진행을 불러왔습니다.');
      return true;
    } catch { return false; }
  }

  function confirmReset() {
    if (state.screen !== 'reset-screen' || state.loading) return;
    const next = {...state.progress, version:24, records:{},
      instant:state.instant, continuous:state.continuous, textSize:state.textSize, dialoguePosition:state.dialoguePosition,
      textSpeed:state.textSpeed, autoSpeed:state.autoSpeed, rememberAuto:state.rememberAuto, autoEnabled:state.autoEnabled, effectsReduced:state.effectsReduced, endingAnimation:state.endingAnimation,
      characterLabels:state.characterLabels, autoResume:state.autoResume, aIdentificationIntroSeen:false,
      bookmarks:$('#reset-keep-bookmarks').checked ? [...(state.progress.bookmarks || [])] : [],
      resetGeneration:(state.progress.resetGeneration || 0) + 1};
    try {
      if (!storageAvailable) throw Error('Storage unavailable');
      // Commit first: failed writes leave both the saved and visible progress intact.
      localStorage.setItem(STORAGE_KEY,JSON.stringify(next));
    } catch {
      $('#reset-status').textContent = '저장할 수 없어 초기화하지 않았습니다. 기존 진행은 유지됩니다. 백업을 내보낸 뒤 다시 시도해 주세요.';
      return;
    }
    adoptReset(next,'읽기 진행을 초기화했습니다. 읽기 설정은 유지했습니다.');
  }

  function exportProgress() {
    saveProgress();
    const link = $('#save-download');
    const url = URL.createObjectURL(new Blob([JSON.stringify(state.progress,null,2)],{type:'application/json'}));
    link.href = url;
    link.download = '녹슨기도-진행도.json';
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    const status = state.screen === 'reset-screen' ? '#reset-status' : '#save-status';
    $(status).textContent = '백업 다운로드를 요청했습니다. 파일이 저장되었는지 확인해 주세요.';
  }

  async function importProgress(file) {
    if (!file) return;
    try {
      if (file.size > 2000000) throw Error('진행도 파일이 너무 큽니다.');
      const imported = JSON.parse(await file.text());
      if (!imported || typeof imported !== 'object' || Array.isArray(imported) || !imported.records || typeof imported.records !== 'object' || Array.isArray(imported.records) || (imported.version && (!Number.isInteger(imported.version) || imported.version > 24 || imported.version < 1))) throw Error('지원하는 진행도 파일이 아닙니다.');
      // Import into a temporary progress object, using the same old-save migrations.
      const previous = state.progress;
      loadProgress(imported);
      state.progress.resetGeneration = previous.resetGeneration || 0;
      state.progress.aIdentificationIntroSeen ||= previous.aIdentificationIntroSeen === true;
      state.progress.readingSetupSeen ||= previous.readingSetupSeen === true;
      for (const record of orderedRecords) {
        const before = previous.records[record.id], incoming = recordProgress(record.id);
        if (!before) continue;
        const seenPages={};
        record.story.forEach((line,index)=>{
          if (storyPages(line).length<2) return;
          const page=Math.max(seenPage(record,index,before),seenPage(record,index,incoming));
          if (page>=0) seenPages[index]=page;
        });
        incoming.seenPages=seenPages;
        incoming.profileViews = [...new Set([...(Array.isArray(before.profileViews) ? before.profileViews : []), ...(Array.isArray(incoming.profileViews) ? incoming.profileViews : [])])].filter(value => typeof value === 'string');
        incoming.completed ||= before.completed === true;
        incoming.lineIndex = Math.min(record.story.length ? record.story.length-1 : 0,Math.max(incoming.lineIndex,before.lineIndex || 0));
        if (Number.isInteger(incoming.seenIndex) || Number.isInteger(before.seenIndex) || incoming.lineIndex > 0) {
          incoming.seenIndex = Math.min(Math.max(0,record.story.length-1),Math.max(incoming.seenIndex || 0,before.seenIndex || 0,incoming.lineIndex));
        }
      }
      for (const mark of previous.bookmarks || []) if (!bookmarkAt(mark.recordId,mark.index)) state.progress.bookmarks.push(mark);
      state.settingsPlaybackReturn=null;
      const selected = currentRecord();
      state.lineIndex = selected ? recordProgress(selected.id).lineIndex : 0;
      saveProgress();
      renderSettings();
      selectDisk(state.selectedDisk,false);
      $('#save-status').textContent = '진행도를 합쳤습니다. 기존 완료 기록과 북마크는 유지했습니다.';
    } catch (error) {
      $('#save-status').textContent = error instanceof SyntaxError ? '진행도 파일을 읽을 수 없습니다.' : error.message || '가져오지 못했습니다.';
    }
    $('#save-import').value = '';
  }

  function bindEvents() {
    $('#settings-categories').addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.code))return;
      const categories=['reading','display','audio','shortcuts','data'],index=categories.indexOf(event.target.dataset.settingsCategory);
      if(index<0)return;
      event.preventDefault();
      const next=event.code==='Home'?0:event.code==='End'?categories.length-1:(index+(event.code==='ArrowRight'?1:-1)+categories.length)%categories.length;
      selectSettingsCategory(categories[next],true);
    });
    let archiveScrollFrame=null;
    $('#archive-layout').addEventListener('scroll',()=>{
      if (!archiveMobileQuery.matches || state.screen!=='archive-screen' || archiveScrollFrame!==null) return;
      archiveScrollFrame=requestAnimationFrame(()=>{
        archiveScrollFrame=null;
        const layout=$('#archive-layout');
        if (!layout.clientWidth) return;
        const index=Math.max(0,Math.min(2,Math.round(layout.scrollLeft/layout.clientWidth)));
        if (index!==state.archivePane) {state.archivePane=index;updateArchiveTabs();}
      });
    },{passive:true});
    $('#archive-tabs').addEventListener('keydown',event=>{
      const tab=event.target.closest('[data-archive-pane]');
      if (!tab || !['ArrowLeft','ArrowRight','Home','End'].includes(event.code)) return;
      event.preventDefault();
      const index=Number(tab.dataset.archivePane);
      moveArchivePane(event.code==='Home' ? 0 : event.code==='End' ? 2 : index+(event.code==='ArrowRight' ? 1 : -1),true);
    });
    archiveMobileQuery.addEventListener?.('change',syncArchiveLayout);
    if (typeof ResizeObserver==='function') new ResizeObserver(syncArchiveLayout).observe($('#archive-layout'));
    $('#scene-art').addEventListener('load', event => {
      if (event.target?.id === 'stage-camera') refreshCutsceneComposition();
    },true);
    $('#memory-image').addEventListener('load',()=>refreshCutsceneComposition());
    $('#standing-art').addEventListener('load',event=>{
      if(event.target?.classList.contains('standing-image'))refreshCutsceneComposition();
    },true);
    if (typeof ResizeObserver === 'function') {
      let aFrame=null;
      const aLayout=new ResizeObserver(()=>{
        if (aFrame!==null) return;
        aFrame=requestAnimationFrame(()=>{aFrame=null;if(state.screen==='story-screen')syncStoryMenu();refreshCutsceneComposition(true);});
      });
      aLayout.observe($('#story-stage'));
      aLayout.observe($('#dialogue-box'));
      aLayout.observe($('.cutscene-copy'));
      aLayout.observe($('#story-caption'));
      aLayout.observe($('#telemetry-panel'));
      aLayout.observe($('#communication-panel'));
      aLayout.observe($('#a-identity-hud'));
      aLayout.observe($('.story-hud'));
      const labLayout = new ResizeObserver(() => {
        if (state.screen !== 'story-screen' || $('#lab-monitor-area').hidden) return;
        const height = Math.ceil($('#dialogue-box').getBoundingClientRect().height);
        $('#story-stage').style.setProperty('--lab-dialogue-height', height+'px');
      });
      labLayout.observe($('#dialogue-box'));
      labLayout.observe($('#story-stage'));
    }
    $('#profile-image').addEventListener('error', () => { $('#profile-image').hidden = true; });
    $('#profile-overlay').addEventListener('click', event => {
      if (event.target === $('#profile-overlay')) closeProfile();
    });
    ['#setting-size','#setting-dialogue-position','#setting-speed','#setting-auto','#setting-remember-auto','#setting-effects','#setting-ending','#setting-identities','#setting-resume'].forEach(selector => $(selector).addEventListener('change',changeReadingSettings));
    $('#library-search').addEventListener('input',() => { state.libraryRecordLimits={}; renderLibrary(); });
    $('#save-import').addEventListener('change',event => importProgress(event.target.files?.[0]));
    $('#ending-image').addEventListener('error',() => {
      $('#ending-image').hidden = true;
      $('#ending-unavailable').hidden = false;
      finishEndingEntrance();
      setEndingDetails(false);
    });
    $('#ending-screen').addEventListener('click', event => {
      if (event.target.closest('button')) return;
      if (event.target.closest('.ending-frame')) toggleEndingDetails();
      else if(event.target.closest('#ending-details'))return;
      else handleAction('return-ending');
    });
    ['selectstart','dragstart'].forEach(event => document.addEventListener(event, e => { if (!e.target?.closest('input, select, textarea')) e.preventDefault(); }));
    document.addEventListener('error', event => {
      if (event.target?.className === 'real-art') event.target.hidden = true;
      if (event.target?.className === 'standing-image') event.target.hidden = true;
      if (event.target?.className === 'research-image') event.target.hidden = true;
      if (event.target?.className === 'profile-avatar-image') event.target.hidden = true;
    }, true);
    ['selectstart','dragstart'].forEach(event => $('#story-screen').addEventListener(event, e => e.preventDefault()));
    $("#enter-archive").addEventListener("click", async () => {
      if (state.loading) return;
      if (await loadTransition('기록 보관소에 접속 중', null, 650, false, null, true, 'in-02')) {
        showScreen('archive-screen');
        const resume=archive.getRecord(state.progress.resumeRecordId);
        if (state.autoResume && !resume?.relatedReport && (resume?.story.length || resume?.readerMode==='report') && recordProgress(resume.id).inProgress && isRecordUnlocked(resume)) {
          state.selectedRecordId=resume.id;selectDisk(resume.diskId,false);
          if(resume.readerMode==='report') {
            const hasSavedScroll=Number.isFinite(recordProgress(resume.id).reportScroll);
            const restored=await openObjective('push');
            if(restored && !hasSavedScroll)$('#report-section-'+state.lineIndex)?.scrollIntoView?.({block:'start'});
          } else await startStory(false,null,'push');
        }
      }
    });
    $('#loading-cancel').addEventListener('click', cancelLoading);
    $('#loading-retry').addEventListener('click', () => state.loading?.decide?.('retry'));
    $('#loading-continue').addEventListener('click', () => state.loading?.decide?.('continue'));
    $("#start-story").addEventListener("click", handleObjectiveAction);
    $("#restart-story").addEventListener('click', () => startStory(true));
    $("#memory-image").addEventListener("error", () => {
      $("#memory-image").hidden = true;
      $("#memory-placeholder").hidden = false;
    });
    $('#scene-image').addEventListener('error', () => { $('#scene-image').hidden = true; });
    $("#story-stage").addEventListener("click", (event) => {
      if (state.loading) return;
      if (!$('#profile-overlay').hidden) return;
      if ($('#story-options').open) { $('#story-options').open = false; return; }
      if (event.target.closest("button") || !$("#backlog").hidden) return;
      if (state.uiHidden) {
        toggleUi();
        return;
      }
      advanceLine();
    });
    document.addEventListener("click", (event) => {
      if (state.screen==='archive-screen' && state.archiveToolsOpen && !event.target.closest('#archive-tools') && !event.target.closest('#archive-tools-toggle')) {
        state.archiveToolsOpen=false;syncArchiveTools();
      }
      if (!event.target.closest('details')) $('#story-options').open = false;
      const target = event.target.closest("[data-action]");
      if (target) handleAction(target.dataset.action,target);
      // Pointer users return to story shortcuts; Tab/Space activation keeps native button focus.
      if (event.detail>0 && state.screen==='story-screen' && !state.loading) {
        if (!$('#profile-overlay').hidden) $('#profile-dialog').focus({preventScroll:true});
        else if (!$('#backlog').hidden) $('#backlog').focus({preventScroll:true});
        else if (event.target.closest('button, summary, #backlog, #backlog-dismiss, #profile-overlay')) $('#story-screen').focus({preventScroll:true});
      }
    });
    $('#story-options').addEventListener('toggle', () => {
      if ($('#story-options').open) clearTimeout(state.autoTimer);
      else scheduleAutoAdvance();
    });
    $('#backlog-dismiss').addEventListener('click', toggleLog);
    $('#gallery-viewer').addEventListener('click',event=>{if(!event.target.closest('button, #gallery-image, figcaption'))closeGalleryImage();});
    $('#backlog').addEventListener('click', event => {
      if (event.target === $('#backlog') || event.target === $('#backlog-list')) toggleLog();
    });
    document.addEventListener("keydown", (event) => {
      if (state.screen==='archive-screen' && event.code==='Escape' && state.archiveToolsOpen) {
        event.preventDefault();state.archiveToolsOpen=false;syncArchiveTools();$('#archive-tools-toggle').focus();return;
      }
      if(event.code==='Escape' && event.repeat) {event.preventDefault();return;}
      if (state.loading) {
        if (event.code === 'Escape' && !$('#loading-cancel').hidden) { event.preventDefault(); cancelLoading(); }
        return;
      }
      if(state.screen==='gallery-screen' && !$('#gallery-viewer').hidden) {
        if(event.code==='Escape') {event.preventDefault();closeGalleryImage();}
        if(['ArrowLeft','ArrowRight'].includes(event.code)) {event.preventDefault();window.RustedPrayerSfx?.play('select');openGalleryImage(state.galleryIndex+(event.code==='ArrowLeft' ? -1 : 1));}
        if(event.code==='Tab') {
          const buttons=[$('#gallery-close'),$('#gallery-prev'),$('#gallery-next')].filter(button=>!button.disabled);
          event.preventDefault();const index=buttons.indexOf(event.target);buttons[(index+(event.shiftKey ? -1 : 1)+buttons.length)%buttons.length].focus();
        }
        return;
      }
      if (state.screen === 'reset-screen') {
        if (event.code === 'Escape') { event.preventDefault(); cancelReset(); }
        if (event.repeat && ['Space','Enter'].includes(event.code)) event.preventDefault();
        return;
      }
      if (!$('#profile-overlay').hidden) {
        if (event.code === 'Escape') { event.preventDefault(); closeProfile(); }
        if (event.code === 'Space' && event.target===$('#profile-dialog')) {
          event.preventDefault();if(!event.repeat) {closeProfile();$('#story-screen').focus({preventScroll:true});}
        }
        if (event.code === 'Tab') { event.preventDefault(); $('#profile-close').focus(); }
        return;
      }
      if ($("#story-screen").hidden) {
        if(state.screen==='ending-screen' && event.code==='Escape' && state.endingDetailsOpen) {
          event.preventDefault();toggleEndingDetails();$('.ending-frame').focus();return;
        }
        if (state.screen === 'complete-screen' && event.code === 'Space' && !event.target.closest('button, input, select, textarea, summary, a')) {
          event.preventDefault();
          if (!event.repeat) handleAction('next-record');
          return;
        }
        if (state.screen === 'ending-screen' && ['Space','Enter','ArrowRight'].includes(event.code) && !event.target.closest('button')) {
          event.preventDefault();
          if(event.target.closest('.ending-frame')) {if(!event.repeat)toggleEndingDetails();}
          else finishEndingEntrance();
          return;
        }
        if (state.screen === 'transition-screen' && ['Space', 'Enter', 'ArrowRight'].includes(event.code) && !event.target.closest('button')) {
          event.preventDefault();
          if (!event.repeat) continueRecordTransition();
          return;
        }
        if (event.code === 'Escape') { event.preventDefault(); goBack(); }
        return;
      }
      if(event.code==='KeyL' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && !event.target.closest('input, select, textarea, [contenteditable]')) {
        event.preventDefault();
        if(!event.repeat) {
          $('#story-options').open=false;
          window.RustedPrayerSfx?.play($('#backlog').hidden ? 'select' : 'cancel');
          toggleLog();
          if ($('#backlog').hidden) $('#story-screen').focus({preventScroll:true});
        }
        return;
      }
      if (!$("#backlog").hidden) {
        if (event.code === 'Escape') { event.preventDefault(); toggleLog(); $('#story-screen').focus({preventScroll:true}); }
        if (event.code === 'Space' && event.target===$('#backlog')) {
          event.preventDefault();if(!event.repeat)toggleLog();
        }
        if (event.code === 'Tab') {
          const buttons = [...$('#backlog').querySelectorAll('button')];
          const first = buttons[0], last = buttons.at(-1);
          if (event.shiftKey && (event.target === first || event.target===$('#backlog'))) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && (event.target === last || event.target===$('#backlog'))) { event.preventDefault(); first.focus(); }
        }
        return;
      }
      if(event.code==='Escape' && state.menuOpen) {
        event.preventDefault();$('#story-options').open=false;setStoryMenu(false);
        $('#story-screen').focus({preventScroll:true});return;
      }
      if (state.uiHidden && ['Space', 'Enter', 'ArrowRight', 'Escape'].includes(event.code)) { event.preventDefault(); toggleUi(); return; }
      if ($('#story-options').open && event.code === 'Escape') {
        event.preventDefault(); $('#story-options').open = false;
        $('#story-options').querySelector('summary').focus(); return;
      }
      if ($('#story-options').open && event.code==='Space' && !event.target.closest('button, summary, input, select, textarea')) {
        event.preventDefault();if(!event.repeat) {$('#story-options').open=false;$('#story-screen').focus({preventScroll:true});}return;
      }
      if (event.target.closest('summary')) return;
      if ($('#story-options').open && ['Space','Enter','ArrowLeft','ArrowRight','KeyH'].includes(event.code)) return;
      if (event.target.closest('input, select, textarea')) return;
      // A profile button keeps its accessible return focus. Space resumes the
      // chat instead of activating that focused button a second time.
      if(event.code==='Space' && event.target.closest('[data-profile]')) {
        event.preventDefault();if(!event.repeat)advanceLine();return;
      }
      if (event.target.closest('button') && (event.code === 'Enter' || (event.code === 'Space' && !['previous-line','next-line'].includes(event.target.closest('button').dataset.action)))) return;
      if (["Space", "Enter", "ArrowRight"].includes(event.code)) {
        event.preventDefault();
        if (event.repeat) return;
        advanceLine();
      }
      if (event.code === "ArrowLeft") { event.preventDefault(); previousLine(); }
      if (event.code === "Escape") {event.preventDefault();exitStory();}
      if (event.code === "KeyH") toggleUi();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { clearTimeout(state.autoTimer); clearTimeout(state.previewTimer); settleACamera(); clearEndingShutter(); }
      else { if (syncResetFromStorage()) return; refreshCutsceneComposition(true); scheduleAutoAdvance(); if (state.screen === 'settings-screen') startSettingsPreview(); }
    });
    window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) syncResetFromStorage(); });
    window.addEventListener('focus', syncResetFromStorage);
    window.matchMedia('(max-width:760px)').addEventListener?.('change', () => {
      if (state.screen === 'story-screen') renderResearchMedia(window.RustedPrayerVisuals.resolve(currentRecord(),state.lineIndex,getActiveVisual(state.lineIndex),state.telemetryPage));
    });
    // Screen changes restore their own scroll; native history restoration would
    // overwrite the archive position after the popstate handler returns.
    if('scrollRestoration' in history)history.scrollRestoration='manual';
    window.addEventListener('popstate', event => { restoreView(event.state); });
    window.addEventListener('scroll',()=>{if(state.screen!=='objective-screen' || currentRecord()?.relatedReport || currentRecord()?.readerMode!=='report')return;rememberReportPosition();clearTimeout(state.reportScrollTimer);state.reportScrollTimer=setTimeout(()=>{saveProgress();rememberView();},150);},{passive:true});
    window.addEventListener('pagehide', () => { if(['story-screen','objective-screen'].includes(state.screen))saveProgress();cancelLoading(); clearPlaybackTimers(); settleACamera(); clearTimeout(state.previewTimer);clearTimeout(state.reportScrollTimer); clearEndingShutter(); });
  }

  loadProgress();
  selectReadingPosition();
  updateInstantButton();
  updateContinuousButtons();
  applyReadingSettings();
  bindEvents();
  history.replaceState({...viewState(), depth:0}, '');
  loadTransition('복구 단말기 전원 인가', null, 850, true, null, true, 'in-02').then(ready => {
    if (ready) { $('#boot-screen').classList.add('power-on'); showScreen('boot-screen', 'none'); }
  });
})();
