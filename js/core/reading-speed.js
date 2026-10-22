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
  // The former fastest pace is now normal. A new ID distinguishes the new
  // faster option from saved choices that should keep their 51 ms interval.
  const textLevels = Object.freeze({'text-quick':2/3,'text-normal':1,'text-slow':1.8,'text-slowest':2.3});
  const textLegacy = [...legacy,'text-fast'];
  const defaultTextSpeed = 'text-normal';
  function normalizeText(value) {
    if (Object.hasOwn(textLevels,value)) return value;
    return defaultTextSpeed;
  }
  function characterDelay(character, speed = defaultTextSpeed) {
    const base=/[.!?·。]/.test(character) ? 105 : character===' ' ? 18 : 34;
    return Math.round(base*1.5*textLevels[normalizeText(speed)]);
  }
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
    const textSpeed=normalizeText(saved.textSpeed);
    return saved.autoSpeed===autoSpeed && saved.textSpeed===textSpeed ? saved : {...saved,autoSpeed,textSpeed};
  }
  function upgradeChange(change) {
    if (change.reset) return {...change,reset:upgradeSnapshot(change.reset)};
    let fields=change.fields;
    for (const [name,normalizeValue] of [['autoSpeed',normalize],['textSpeed',normalizeText]]) {
      const key=JSON.stringify([name]);
      if (Object.hasOwn(fields || {},key)) fields={...fields,[key]:normalizeValue(fields[key])};
    }
    return fields===change.fields ? change : {...change,fields};
  }
  window.RustedPrayerReadingSpeed={defaultSpeed,values:Object.keys(levels),legacy,normalize,duration,wait,transition,
    defaultTextSpeed,textValues:Object.keys(textLevels),textLegacy,normalizeText,characterDelay,upgradeSnapshot,upgradeChange};
})();
