(function () {
  'use strict';
  // Distinct IDs keep old three-level saves from being mistaken for new choices.
  const levels = Object.freeze({
    'auto-fast': {scale:1, minimum:250},
    'auto-normal': {scale:1.4, minimum:1500},
    'auto-slow': {scale:1.8, minimum:2500},
    'auto-slowest': {scale:2.3, minimum:3500},
  });
  const legacy = ['fast','normal','slow'];
  const defaultSpeed = 'auto-normal';
  function normalize(value) {
    if (Object.hasOwn(levels,value)) return value;
    // Old normal/fast are below the new minimum; clamp them to the fastest level.
    return legacy.includes(value) ? 'auto-fast' : defaultSpeed;
  }
  const level = speed => levels[normalize(speed)];
  function duration(text, line = null, speed = defaultSpeed) {
    const value=String(text || '').trim();
    const sound=/^(?:탕|타앙|쾅|콰앙|철컥|찰칵|딸깍|탁|쿵|퍽|툭|짤랑|끼익|총성|폭발음)[\s\-—–.!！·…]*$/u.test(value);
    let time=sound ? 600 : /^[.·…\s]+$/u.test(value) ? 1200 : Math.max(800,350+value.length*40);
    if (['memo','document','report','comparison','objective'].includes(line?.tone)) time=Math.max(1200,time*1.2);
    return Math.round(Math.min(18000,time)*1.9*level(speed).scale);
  }
  function wait(text, line = null, speed = defaultSpeed, typingCredit = 0, chatEnd = false) {
    return Math.max(level(speed).minimum,duration(text,line,speed)-typingCredit,line?.autoPause || 0)
      + (line?.readingBeat?.extraAutoDelay || 0) + (chatEnd ? 1000 : 0);
  }
  function transition(length, speed = defaultSpeed) {
    return Math.round(Math.max(4000,Math.min(24000,length*85*1.5))*level(speed).scale);
  }
  function upgradeSnapshot(saved) {
    const autoSpeed=normalize(saved.autoSpeed);
    return saved.autoSpeed===autoSpeed ? saved : {...saved,autoSpeed};
  }
  function upgradeChange(change) {
    if (change.reset) return {...change,reset:upgradeSnapshot(change.reset)};
    const key=JSON.stringify(['autoSpeed']);
    if (!Object.hasOwn(change.fields || {},key)) return change;
    return {...change,fields:{...change.fields,[key]:normalize(change.fields[key])}};
  }
  window.RustedPrayerReadingSpeed={defaultSpeed,values:Object.keys(levels),legacy,normalize,duration,wait,transition,upgradeSnapshot,upgradeChange};
})();
