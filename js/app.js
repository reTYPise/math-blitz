'use strict';

const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const WEEK_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const OP_LABELS = { '×': 'умножение', '÷': 'деление', '+': 'сложение', '−': 'вычитание', '%': 'проценты' };
const GAME_MODE_LABELS = { classic: 'классика', timed: 'на время', survival: 'выживание' };
const ALL_OPS = ['×', '÷', '+', '−', '%'];
const PERCENTS_FULL = [1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100];

// ── SETTINGS ──
let selectedOps       = ['×'];
let selectedRange     = 10;
let selectedFocus     = 'any';
let showAnswerGuide   = true;
let guideExpanded     = true;
let sequenceMode      = 'random';
let selectedInputMode = 'choices';
let selectedGameMode  = 'classic';
let classicCount      = 20;
let timedSeconds      = 60;
let survivalSeconds   = 120;

// ── GAME STATE ──
let typedValue     = '';
let currentAnswer  = 0;
let currentGuideKey = '';
let currentQuestion = null;
let currentChoices = [];
let lastQuestion = null;
let orderedQueue = [];
let orderedQueueActive = false;
let orderedFirstDone = false;
let correctCount   = 0;
let wrongCount     = 0;
let streak         = 0;
let bestStreak     = 0;
let totalQuestions = 20;
let questionNum    = 0;
let locked         = false;
let lastSettings   = {};
let gameStartTime  = 0;
let sessionDateKey = '';

let timerInterval   = null;
let timerRemaining  = 0;
let timerTotal      = 0;
let warnedHalf      = false;
let warnedCritical  = false;
let gameOver        = false;

// ── AUDIO ──
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let actx = null;
function getAC() { if (!actx) actx = new AudioCtx(); return actx; }

function playCorrect() {
  try {
    const ctx = getAC(), t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.setValueAtTime(660, t);
    o.frequency.setValueAtTime(880, t + 0.08);
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    o.start(t); o.stop(t + 0.24);
  } catch (e) {}
}

function playWrong() {
  try {
    const ctx = getAC(), t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.setValueAtTime(160, t + 0.12);
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    o.start(t); o.stop(t + 0.34);
  } catch (e) {}
}

function playWarn() {
  try {
    const ctx = getAC(), t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.setValueAtTime(750, t);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.start(t); o.stop(t + 0.45);
  } catch (e) {}
}

function playCritical() {
  try {
    const ctx = getAC();
    [0, 0.17, 0.34].forEach(delay => {
      const t = ctx.currentTime + delay;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'square';
      o.frequency.setValueAtTime(900, t);
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      o.start(t); o.stop(t + 0.13);
    });
  } catch (e) {}
}

function playTimeUp() {
  try {
    const ctx = getAC();
    [440, 349, 261].forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.22;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'triangle';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.28, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.start(t); o.stop(t + 0.5);
    });
  } catch (e) {}
}

// ── DASHBOARD HELPERS ──
function formatDateKey(date) {
  return AppDB.formatDateKey(date);
}

function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatFullDate(date) {
  return `${date.getDate()} ${MONTHS_GEN[date.getMonth()]} ${date.getFullYear()}`;
}

function pluralDays(n) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня';
  return 'дней';
}

function pluralSessions(n) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'сессия';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'сессии';
  return 'сессий';
}

function trainerKey() {
  return selectedOps.join('+');
}

function formatTrainerLabel(trainer) {
  if (!trainer) return '—';
  const ops = trainer.match(/[×÷+−%]/g) || [];
  if (ops.length === 0) return trainer;
  return ops.map(op => OP_LABELS[op] || op).join(' · ');
}

function getPercentsForRange(range) {
  let pool;
  if (range <= 10) pool = [5, 10, 20, 25, 50, 100];
  else if (range <= 20) pool = [1, 2, 5, 10, 15, 20, 25, 50, 100];
  else pool = PERCENTS_FULL;
  return pool.filter(pct => {
    for (let b = 1; b <= range; b++) {
      if (isCleanPercent(pct, b)) return true;
    }
    return false;
  });
}

function percentAnswer(pct, base) {
  return (pct * base) / 100;
}

function isCleanPercent(pct, base) {
  return (pct * base) % 100 === 0;
}

function formatPercentQuestion(pct, base) {
  return `${pct}% от ${base}`;
}

function makePercentQuestion(pct, base) {
  const answer = percentAnswer(pct, base);
  return { text: formatPercentQuestion(pct, base), op: '%', a: pct, b: base, answer };
}

function pickBaseForPercent(pct, maxBase, fixed) {
  if (fixed) return fixed;
  const valid = [];
  for (let b = 1; b <= maxBase; b++) {
    if (isCleanPercent(pct, b)) valid.push(b);
  }
  return valid.length ? pickRandom(valid) : null;
}

function generatePercentQuestion() {
  const percents = getPercentsForRange(selectedRange);
  const fixed = selectedFocus === 'any' ? null : parseInt(selectedFocus);
  if (percents.length === 0) return makePercentQuestion(100, Math.max(1, selectedRange));

  for (let attempt = 0; attempt < 60; attempt++) {
    const pct = pickRandom(percents);
    if (fixed) {
      if (isCleanPercent(pct, fixed)) return makePercentQuestion(pct, fixed);
      continue;
    }
    const base = pickBaseForPercent(pct, selectedRange, null);
    if (base !== null) return makePercentQuestion(pct, base);
  }

  const pct = percents[0];
  const base = fixed || pickBaseForPercent(pct, selectedRange, null) || 1;
  return makePercentQuestion(pct, base);
}

function getSettingsPreviewHtml() {
  const ops = selectedOps.map(op => `<strong>${op}</strong> ${OP_LABELS[op]}`).join(' · ');
  const focus = selectedFocus === 'any' ? 'любые числа' : `только на ${selectedFocus}`;
  const mode = GAME_MODE_LABELS[selectedGameMode] || selectedGameMode;
  return `${ops}<br><span>диапазон 1–${selectedRange}</span> · <span>${focus}</span> · <span>${mode}</span>`;
}

function recordSession(summary) {
  AppDB.recordSession({
    date: sessionDateKey || formatDateKey(new Date()),
    timestamp: Date.now(),
    trainer: summary.trainer,
    gameMode: summary.gameMode,
    correct: summary.correct,
    wrong: summary.wrong,
    answered: summary.answered,
    bestStreak: summary.bestStreak,
    elapsedSec: summary.elapsedSec,
    rangeMax: summary.rangeMax,
    inputMode: summary.inputMode
  });
}

function renderDashboard(date = new Date()) {
  document.getElementById('today-weekday').textContent = WEEKDAYS[date.getDay()];
  document.getElementById('today-full-date').textContent = formatFullDate(date);
  document.getElementById('settings-preview').innerHTML = getSettingsPreviewHtml();

  const stats = AppDB.getOverallStats(date);
  document.getElementById('daily-streak-badge').innerHTML =
    `🔥 <span>${stats.dailyStreak}</span> ${pluralDays(stats.dailyStreak)}`;
  document.getElementById('kpi-streak').textContent = stats.dailyStreak;
  document.getElementById('kpi-sessions').textContent = stats.totalSessions;
  document.getElementById('kpi-accuracy').textContent = `${stats.accuracy}%`;
  document.getElementById('kpi-today').textContent = stats.todayCount;

  const quickBtn = document.getElementById('quick-start-btn');
  const doneToday = AppDB.hasSessionToday(date);
  quickBtn.textContent = doneToday ? 'Продолжить тренировку' : 'Быстрый старт';
  quickBtn.classList.toggle('done-today', doneToday);

  renderWeeklyActivity(date);
  renderOpsBreakdown();
  renderRecentSessions();
}

function renderWeeklyActivity(date = new Date()) {
  const container = document.getElementById('weekly-activity');
  const days = AppDB.getWeeklyActivity(date);
  const max = Math.max(1, ...days.map(d => d.count));
  const todayKey = formatDateKey(date);
  container.innerHTML = days.map(d => {
    const h = Math.max(8, Math.round((d.count / max) * 48));
    const cls = [
      'week-bar',
      d.count > 0 ? 'has-data' : '',
      d.date === todayKey ? 'is-today' : ''
    ].filter(Boolean).join(' ');
    return `<div class="week-bar-wrap">
      <div class="week-bar-count">${d.count || ''}</div>
      <div class="${cls}" style="height:${h}px"></div>
      <div class="week-bar-label">${WEEK_SHORT[d.weekday]}</div>
    </div>`;
  }).join('');
}

function renderOpsBreakdown() {
  const container = document.getElementById('ops-breakdown');
  const rows = AppDB.getTrainerBreakdown();
  if (rows.length === 0) {
    container.innerHTML = '<div class="recent-empty">Пока нет данных — начни первую сессию.</div>';
    return;
  }
  container.innerHTML = rows.map(r => {
    const name = formatTrainerLabel(r.trainer);
    return `<div class="breakdown-row">
      <div>
        <div class="breakdown-name">${name}</div>
        <div class="breakdown-meta">${r.sessions} ${pluralSessions(r.sessions)} · ${r.accuracy}%</div>
      </div>
      <div class="breakdown-bar-wrap"><div class="breakdown-bar-fill" style="width:${r.accuracy}%"></div></div>
    </div>`;
  }).join('');
}

function renderRecentSessions() {
  const container = document.getElementById('recent-sessions');
  const sessions = AppDB.getRecentSessions(6);
  if (sessions.length === 0) {
    container.innerHTML = '<div class="recent-empty">Сессии появятся здесь после тренировки.</div>';
    return;
  }
  container.innerHTML = sessions.map(s => {
    const name = formatTrainerLabel(s.trainer);
    const pct = s.answered > 0 ? Math.round((s.correct / s.answered) * 100) : 0;
    const mode = GAME_MODE_LABELS[s.game_mode] || s.game_mode;
    return `<div class="recent-row">
      <span class="recent-date">${s.date}</span>
      <span class="recent-trainer">${name} · ${mode}</span>
      <span class="recent-score">${s.correct}/${s.answered} · ${pct}%</span>
    </div>`;
  }).join('');
}

// ── MENU ──
function toggleOp(btn) {
  const op = btn.dataset.op;
  if (selectedOps.includes(op)) {
    if (selectedOps.length === 1) return;
    selectedOps = selectedOps.filter(o => o !== op);
    btn.classList.remove('selected');
  } else {
    selectedOps.push(op);
    btn.classList.add('selected');
  }
  resetQuestionSequence();
  renderPracticeGuide();
  updateSettingsPreview();
}

function selectRange(control) {
  selectedRange = parseInt(control.value || control.dataset.range);
  updateFocusOptions();
  resetQuestionSequence();
  renderPracticeGuide();
  updateSettingsPreview();
}

function selectFocus(control) {
  selectedFocus = control.value;
  resetQuestionSequence();
  renderPracticeGuide();
  updateSettingsPreview();
}

function toggleGuide(control) {
  showAnswerGuide = control.checked;
  guideExpanded = showAnswerGuide;
  renderPracticeGuide();
}

function setGuideExpanded(expanded) {
  guideExpanded = expanded;
  renderPracticeGuide();
  highlightGuideAnswer();
}

function selectSequenceMode(control) {
  sequenceMode = control.value;
  resetQuestionSequence();
}

function resetQuestionSequence() {
  orderedQueue = [];
  orderedQueueActive = false;
  orderedFirstDone = false;
  lastQuestion = null;
}

function updateSettingsPreview() {
  const el = document.getElementById('settings-preview');
  if (el) el.innerHTML = getSettingsPreviewHtml();
}

function updateFocusOptions() {
  const select = document.getElementById('focus-select');
  if (!select) return;

  const previous = selectedFocus;
  select.innerHTML = '<option value="any">любые числа</option>';
  for (let i = 1; i <= selectedRange; i++) {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = `только на ${i}`;
    select.appendChild(option);
  }

  selectedFocus = previous !== 'any' && Number(previous) <= selectedRange ? previous : 'any';
  select.value = selectedFocus;
}

function syncSettingsFromControls() {
  const rangeSelect = document.getElementById('range-select');
  const focusSelect = document.getElementById('focus-select');
  const guideToggle = document.getElementById('guide-toggle');
  const sequenceSelect = document.getElementById('sequence-mode-select');
  const selectedGameButton = document.querySelector('.gm-btn.selected');
  const selectedInputButton = document.querySelector('.mode-btn.selected');
  const visibleFocus = focusSelect?.value;

  selectedOps = [...document.querySelectorAll('.op-btn.selected')].map(b => b.dataset.op);
  if (selectedOps.length === 0) selectedOps = ['×'];

  selectedRange = parseInt(rangeSelect?.value || selectedRange);
  updateFocusOptions();
  if (visibleFocus && (visibleFocus === 'any' || Number(visibleFocus) <= selectedRange)) {
    selectedFocus = visibleFocus;
    const updatedFocusSelect = document.getElementById('focus-select');
    if (updatedFocusSelect) updatedFocusSelect.value = selectedFocus;
  }
  showAnswerGuide = guideToggle ? guideToggle.checked : showAnswerGuide;
  sequenceMode = sequenceSelect?.value || sequenceMode;
  selectedGameMode = selectedGameButton?.dataset.gm || selectedGameMode;
  selectedInputMode = selectedInputButton?.dataset.mode || selectedInputMode;

  const activeOptions = document.getElementById('opts-' + selectedGameMode);
  const selectedSub = activeOptions?.querySelector('.sub-btn.selected');
  if (selectedSub) selectSubValue(selectedGameMode, parseInt(selectedSub.dataset.val));
}

function syncControlsFromState() {
  const rangeSelect = document.getElementById('range-select');
  const guideToggle = document.getElementById('guide-toggle');
  const sequenceSelect = document.getElementById('sequence-mode-select');

  document.querySelectorAll('.op-btn').forEach(btn => {
    btn.classList.toggle('selected', selectedOps.includes(btn.dataset.op));
  });
  if (rangeSelect) rangeSelect.value = String(selectedRange);
  updateFocusOptions();
  const focusSelect = document.getElementById('focus-select');
  if (focusSelect) focusSelect.value = selectedFocus;
  if (guideToggle) guideToggle.checked = showAnswerGuide;
  if (sequenceSelect) sequenceSelect.value = sequenceMode;

  document.querySelectorAll('.gm-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.gm === selectedGameMode);
  });
  document.getElementById('opts-classic').style.display  = selectedGameMode === 'classic'  ? 'block' : 'none';
  document.getElementById('opts-timed').style.display    = selectedGameMode === 'timed'    ? 'block' : 'none';
  document.getElementById('opts-survival').style.display = selectedGameMode === 'survival' ? 'block' : 'none';

  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.mode === selectedInputMode);
  });

  ['classic', 'timed', 'survival'].forEach(mode => {
    const count = mode === 'classic' ? classicCount : mode === 'timed' ? timedSeconds : survivalSeconds;
    document.querySelectorAll(`.sub-grid[data-sub-mode="${mode}"] .sub-btn`).forEach(btn => {
      btn.classList.toggle('selected', parseInt(btn.dataset.val) === count);
    });
  });
}

function selectGameMode(btn) {
  document.querySelectorAll('.gm-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedGameMode = btn.dataset.gm;
  resetQuestionSequence();
  document.getElementById('opts-classic').style.display  = selectedGameMode === 'classic'  ? 'block' : 'none';
  document.getElementById('opts-timed').style.display    = selectedGameMode === 'timed'    ? 'block' : 'none';
  document.getElementById('opts-survival').style.display = selectedGameMode === 'survival' ? 'block' : 'none';
  updateSettingsPreview();
}

function selectSub(mode, btn) {
  btn.closest('.sub-grid').querySelectorAll('.sub-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  const v = parseInt(btn.dataset.val);
  selectSubValue(mode, v);
  resetQuestionSequence();
}

function selectSubValue(mode, value) {
  if (mode === 'classic')  classicCount = value;
  if (mode === 'timed')    timedSeconds = value;
  if (mode === 'survival') survivalSeconds = value;
}

function selectInputMode(btn) {
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedInputMode = btn.dataset.mode;
}

function quickStart() {
  const ranges = [10, 12, 20];
  const counts = [10, 20, 30];
  const numOps = randInt(1, 3);
  selectedOps = shuffle([...ALL_OPS]).slice(0, numOps);
  selectedRange = pickRandom(ranges);
  selectedFocus = 'any';
  showAnswerGuide = true;
  sequenceMode = 'random';
  selectedInputMode = 'choices';
  selectedGameMode = 'classic';
  classicCount = pickRandom(counts);
  timedSeconds = 60;
  survivalSeconds = 120;
  syncControlsFromState();
  startGame();
}

// ── QUESTION GEN ──
function generateQuestion() {
  const op = selectedOps[Math.floor(Math.random() * selectedOps.length)];
  if (op === '%') return generatePercentQuestion();
  const { a, b, answer } = getOperandPair(op);
  return { text: `${a} ${op} ${b}`, op, a, b, answer };
}

function getNextQuestion() {
  if (sequenceMode === 'ordered') {
    if (orderedQueue.length === 0) orderedQueue = buildOrderedQueue();
    const q = orderedQueue.shift();
    lastQuestion = q;
    return q;
  }

  if (sequenceMode === 'ordered-first' && !orderedFirstDone) {
    if (!orderedQueueActive) {
      orderedQueue = buildOrderedQueue();
      orderedQueueActive = orderedQueue.length > 0;
    }
    const q = orderedQueue.shift();
    if (orderedQueue.length === 0) {
      orderedQueueActive = false;
      orderedFirstDone = true;
    }
    lastQuestion = q;
    return q;
  }

  let q = generateQuestion();
  let attempts = 0;
  while (lastQuestion && isSameQuestion(q, lastQuestion) && attempts < 30) {
    q = generateQuestion();
    attempts++;
  }
  lastQuestion = q;
  return q;
}

function buildOrderedQueue() {
  const queue = [];
  selectedOps.forEach(op => {
    if (op === '%') {
      const percents = getPercentsForRange(selectedRange);
      if (selectedFocus === 'any') {
        for (let base = 1; base <= selectedRange; base++) {
          for (const pct of percents) {
            if (isCleanPercent(pct, base)) queue.push(makePercentQuestion(pct, base));
          }
        }
      } else {
        const base = parseInt(selectedFocus);
        for (const pct of percents) {
          if (isCleanPercent(pct, base)) queue.push(makePercentQuestion(pct, base));
        }
      }
      return;
    }
    const fixed = selectedFocus === 'any' ? 1 : parseInt(selectedFocus);
    for (let n = 1; n <= selectedRange; n++) {
      const pair = getOrderedOperandPair(op, fixed, n);
      queue.push({ text: `${pair.a} ${op} ${pair.b}`, op, a: pair.a, b: pair.b, answer: pair.answer });
    }
  });
  return queue;
}

function getOrderedOperandPair(op, fixed, n) {
  if (op === '×') return { a: fixed, b: n, answer: fixed * n };
  if (op === '÷') return { a: fixed * n, b: fixed, answer: n };
  if (op === '+') return { a: n, b: fixed, answer: n + fixed };
  return { a: n + fixed, b: fixed, answer: n };
}

function isSameQuestion(a, b) {
  return !!a && !!b && a.op === b.op && a.a === b.a && a.b === b.b;
}

function getOperandPair(op) {
  const fixed = selectedFocus === 'any' ? null : parseInt(selectedFocus);
  let a, b, answer;

  if (op === '×') {
    a = fixed || randInt(1, selectedRange);
    b = randInt(1, selectedRange);
    answer = a * b;
  } else if (op === '÷') {
    b = fixed || randInt(1, selectedRange);
    answer = randInt(1, selectedRange);
    a = b * answer;
  } else if (op === '+') {
    a = randInt(1, selectedRange);
    b = fixed || randInt(1, selectedRange);
    answer = a + b;
  } else {
    b = fixed || randInt(1, selectedRange);
    answer = randInt(0, selectedRange);
    a = answer + b;
  }

  return { a, b, answer };
}

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateChoices(correct) {
  const choices = new Set([correct]);
  let attempts = 0;
  while (choices.size < 4 && attempts < 120) {
    attempts++;
    const spread = Math.max(3, Math.floor(correct * 0.28));
    const delta = randInt(-spread, spread);
    const c = correct + delta;
    if (c > 0 && c !== correct) choices.add(c);
  }
  let fb = 1;
  while (choices.size < 4) { if (!choices.has(fb)) choices.add(fb); fb++; }
  return shuffle([...choices]);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function renderPracticeGuide() {
  const guide = document.getElementById('practice-guide');
  if (!guide) return;

  if (!showAnswerGuide) {
    guide.className = 'practice-guide';
    guide.innerHTML = '';
    return;
  }

  const rows = buildGuideRows();
  const title = rows.title;
  const meta = rows.limited ? `первые ${rows.items.length}` : `${rows.items.length} ответов`;
  const buttonLabel = guideExpanded ? 'скрыть' : 'раскрыть';
  const buttonTitle = guideExpanded ? 'Скрыть готовые ответы' : 'Показать готовые ответы';

  guide.innerHTML = `
    <div class="guide-head">
      <div class="guide-copy">
        <div class="guide-title">${title}</div>
        <div class="guide-meta">${meta}</div>
      </div>
      <button class="guide-reveal-btn" id="guide-reveal-btn" type="button" title="${buttonTitle}">${buttonLabel}</button>
    </div>
    <div class="guide-list">
      ${rows.items.map(row => {
        const key = getGuideKey(row.left, row.answer);
        const current = key === currentGuideKey ? ' current' : '';
        return `<div class="guide-row${current}" data-guide-key="${key}">${row.left} = <span>${row.answer}</span></div>`;
      }).join('')}
    </div>
  `;
  guide.className = 'practice-guide show' + (guideExpanded ? '' : ' collapsed');
}

function highlightGuideAnswer() {
  const guide = document.getElementById('practice-guide');
  if (!guide || !currentGuideKey) return;

  guide.querySelectorAll('.guide-row.current').forEach(row => row.classList.remove('current'));
  const current = guide.querySelector(`[data-guide-key="${currentGuideKey}"]`);
  if (current) current.classList.add('current');
}

function getGuideKey(left, answer) {
  return `${left}|${answer}`;
}

function buildGuideRows() {
  if (selectedFocus === 'any') return buildContextGuideRows();

  const items = [];
  const limit = 420;

  for (const op of selectedOps) {
    if (op === '%') {
      const base = parseInt(selectedFocus);
      const percents = getPercentsForRange(selectedRange);
      for (const pct of percents) {
        if (!isCleanPercent(pct, base)) continue;
        items.push(formatPercentGuideRow(pct, base));
        if (items.length >= limit) return { title: `проценты от ${selectedFocus}`, items, limited: true };
      }
      continue;
    }
    const fixed = parseInt(selectedFocus);
    for (let n = 1; n <= selectedRange; n++) {
      items.push(formatFixedGuideRow(op, fixed, n));
      if (items.length >= limit) return { title: `только на ${selectedFocus}`, items, limited: true };
    }
  }

  const hasPercent = selectedOps.includes('%');
  const title = hasPercent && selectedOps.length === 1
    ? `проценты от ${selectedFocus}`
    : `только на ${selectedFocus}`;
  return { title, items, limited: false };
}

function buildContextGuideRows() {
  if (!currentQuestion) return { title: `таблица 1–${selectedRange}`, items: [], limited: false };

  if (currentQuestion.op === '%') {
    const base = currentQuestion.b;
    const percents = getPercentsForRange(selectedRange);
    const items = percents
      .filter(pct => isCleanPercent(pct, base))
      .map(pct => formatPercentGuideRow(pct, base));
    return { title: `проценты от ${base}`, items, limited: false };
  }

  const anchor = getGuideAnchor(currentQuestion);
  const items = [];
  for (let n = 1; n <= selectedRange; n++) {
    items.push(formatFixedGuideRow(currentQuestion.op, anchor, n));
  }

  return { title: `таблица на ${anchor}`, items, limited: false };
}

function getGuideAnchor(question) {
  if (question.op === '×') return question.a;
  if (question.op === '%') return question.b;
  return question.b;
}

function formatPercentGuideRow(pct, base) {
  return { left: formatPercentQuestion(pct, base), answer: percentAnswer(pct, base) };
}

function formatFixedGuideRow(op, fixed, n) {
  if (op === '×') return { left: `${fixed} × ${n}`, answer: fixed * n };
  if (op === '÷') return { left: `${fixed * n} ÷ ${fixed}`, answer: n };
  if (op === '+') return { left: `${n} + ${fixed}`, answer: n + fixed };
  return { left: `${n + fixed} − ${fixed}`, answer: n };
}

// ── START ──
function startGame() {
  syncSettingsFromControls();
  lastSettings = {
    ops: [...selectedOps], range: selectedRange, focus: selectedFocus, showGuide: showAnswerGuide,
    sequenceMode,
    inputMode: selectedInputMode, gameMode: selectedGameMode,
    classicCount, timedSeconds, survivalSeconds
  };
  correctCount = 0; wrongCount = 0; streak = 0; bestStreak = 0;
  questionNum = 0; locked = false; gameOver = false;
  currentGuideKey = '';
  currentQuestion = null;
  resetQuestionSequence();
  guideExpanded = showAnswerGuide;
  warnedHalf = false; warnedCritical = false;
  gameStartTime = Date.now();
  sessionDateKey = formatDateKey(new Date());
  totalQuestions = selectedGameMode === 'classic' ? classicCount : Infinity;

  window.scrollTo(0, 0);
  showScreen('game');

  const label = document.getElementById('trainer-label');
  if (label) label.textContent = trainerKey();

  setupInputMode();
  renderPracticeGuide();
  setupTimer();
  nextQuestion();
}

function restartGame() {
  selectedOps       = lastSettings.ops;
  selectedRange     = lastSettings.range;
  selectedFocus     = lastSettings.focus || 'any';
  showAnswerGuide   = lastSettings.showGuide !== false;
  sequenceMode      = lastSettings.sequenceMode || 'random';
  selectedInputMode = lastSettings.inputMode;
  selectedGameMode  = lastSettings.gameMode;
  classicCount      = lastSettings.classicCount  || classicCount;
  timedSeconds      = lastSettings.timedSeconds   || timedSeconds;
  survivalSeconds   = lastSettings.survivalSeconds || survivalSeconds;
  startGame();
}

// ── TIMER ──
function setupTimer() {
  clearInterval(timerInterval);
  const hasClock = selectedGameMode === 'timed' || selectedGameMode === 'survival';
  document.getElementById('timer-row').style.display    = hasClock ? 'flex' : 'none';
  document.getElementById('progress-bar').style.display = hasClock ? 'none' : 'block';

  if (!hasClock) return;

  timerTotal = selectedGameMode === 'timed' ? timedSeconds : survivalSeconds;
  timerRemaining = timerTotal;
  renderTimer();
  timerInterval = setInterval(tickTimer, 250);
}

function tickTimer() {
  if (gameOver) { clearInterval(timerInterval); return; }
  timerRemaining = Math.max(0, timerRemaining - 0.25);

  const pct = timerRemaining / timerTotal;
  if (!warnedHalf && pct <= 0.5) { warnedHalf = true; playWarn(); }
  if (!warnedCritical && pct <= 0.2) { warnedCritical = true; playCritical(); }

  renderTimer();

  if (timerRemaining <= 0) {
    clearInterval(timerInterval);
    triggerTimeUp();
  }
}

function renderTimer() {
  const secs = Math.ceil(timerRemaining);
  const pct  = timerTotal > 0 ? timerRemaining / timerTotal : 0;
  const mins = Math.floor(secs / 60);
  const s    = secs % 60;

  const disp = document.getElementById('timer-display');
  const bar  = document.getElementById('timer-bar-fill');
  const qc   = document.getElementById('qcount-display');

  disp.textContent = timerTotal >= 60 ? `${mins}:${String(s).padStart(2,'0')}` : `${secs}`;
  bar.style.width  = (pct * 100) + '%';

  const cls = pct <= 0.2 ? 'critical' : pct <= 0.5 ? 'warn' : '';
  disp.className = 'timer-display' + (cls ? ' ' + cls : '');
  bar.className  = 'timer-bar-fill' + (cls ? ' ' + cls : '');

  qc.textContent = selectedGameMode === 'survival'
    ? correctCount + ' ✓'
    : `${correctCount} ✓`;
}

function triggerTimeUp() {
  if (gameOver) return;
  gameOver = true;
  locked = true;
  playTimeUp();

  const overlay = document.getElementById('timesup-overlay');
  document.getElementById('timesup-stats').textContent =
    `✓ ${correctCount}  ✗ ${wrongCount}  серия: ${bestStreak}`;
  overlay.classList.add('show');

  setTimeout(() => {
    overlay.classList.remove('show');
    showScore();
  }, 1900);
}

// ── INPUT MODE ──
function setupInputMode() {
  document.getElementById('choices-grid').style.display    = 'none';
  document.getElementById('screen-keyboard').style.display = 'none';
  document.getElementById('typed-display').style.display   = 'none';
  document.getElementById('keyboard-hint').style.display   = 'none';

  if (selectedInputMode === 'choices') {
    document.getElementById('choices-grid').style.display = 'grid';
  } else if (selectedInputMode === 'screen') {
    document.getElementById('screen-keyboard').style.display = 'flex';
    document.getElementById('typed-display').style.display   = 'block';
  } else {
    document.getElementById('typed-display').style.display = 'block';
    document.getElementById('keyboard-hint').style.display  = 'block';
  }
}

// ── NEXT QUESTION ──
function nextQuestion() {
  if (gameOver) return;
  if (selectedGameMode === 'classic' && questionNum >= totalQuestions) {
    clearInterval(timerInterval);
    showScore();
    return;
  }

  const q = getNextQuestion();
  currentQuestion = q;
  currentAnswer = q.answer;
  currentGuideKey = getGuideKey(q.text, q.answer);
  typedValue = '';
  locked = false;

  document.getElementById('question-text').textContent = q.text;
  document.getElementById('question-answer').textContent = '';
  document.getElementById('question-answer').className = 'question-answer';
  document.getElementById('typed-value').textContent = '';
  document.getElementById('typed-value').style.color = '';

  const qBox = document.getElementById('question-box');
  qBox.className = 'question-box';
  void qBox.offsetWidth;
  qBox.classList.add('anim-pop');

  if (selectedGameMode === 'classic') {
    document.getElementById('progress-fill').style.width = (questionNum / totalQuestions * 100) + '%';
  }

  if (selectedInputMode === 'choices') {
    currentChoices = generateChoices(currentAnswer);
    for (let i = 0; i < 4; i++) {
      const btn = document.getElementById('c' + i);
      btn.textContent = currentChoices[i];
      btn.className = 'choice-btn';
      btn.disabled = false;
    }
  }

  questionNum++;
  renderPracticeGuide();
  highlightGuideAnswer();
  updateHUD();
}

function updateHUD() {
  document.getElementById('streak-count').textContent  = streak;
  document.getElementById('score-correct').textContent = correctCount;
  document.getElementById('score-wrong').textContent   = wrongCount;
}

// ── ANSWERS ──
function submitAnswer(userAnswer) {
  if (locked || gameOver) return;
  parseInt(userAnswer) === currentAnswer ? handleCorrect() : handleWrong(userAnswer);
}

function handleCorrect() {
  locked = true;
  correctCount++; streak++;
  if (streak > bestStreak) bestStreak = streak;
  updateHUD();
  playCorrect();
  showFlash('correct-flash');

  document.getElementById('question-box').classList.add('correct');
  if (selectedInputMode !== 'choices') document.getElementById('typed-value').textContent = currentAnswer;
  const ans = document.getElementById('question-answer');
  ans.textContent = '✓'; ans.className = 'question-answer show-correct';

  setTimeout(() => nextQuestion(), 180);
}

function handleWrong(userAnswer) {
  locked = true;
  wrongCount++; streak = 0;
  updateHUD();
  playWrong();
  showFlash('wrong-flash');

  const qBox = document.getElementById('question-box');
  qBox.classList.add('wrong'); void qBox.offsetWidth; qBox.classList.add('anim-shake');

  if (selectedInputMode !== 'choices') {
    const tv = document.getElementById('typed-value');
    tv.textContent = userAnswer;
    tv.style.color = 'var(--accent2)';
  }
  const ans = document.getElementById('question-answer');
  ans.textContent = `→ ${currentAnswer}`; ans.className = 'question-answer show-wrong';

  setTimeout(() => {
    typedValue = '';
    document.getElementById('typed-value').textContent = '';
    document.getElementById('typed-value').style.color = '';
    nextQuestion();
  }, 1200);
}

function selectChoice(idx) {
  if (locked || gameOver) return;
  const chosen = currentChoices[idx];
  for (let i = 0; i < 4; i++) document.getElementById('c' + i).disabled = true;
  const btn = document.getElementById('c' + idx);
  if (chosen === currentAnswer) {
    btn.classList.add('correct-choice');
    handleCorrect();
  } else {
    btn.classList.add('wrong-choice');
    const ci = currentChoices.indexOf(currentAnswer);
    if (ci !== -1) document.getElementById('c' + ci).classList.add('correct-choice');
    handleWrong(chosen);
  }
}

// ── TYPED INPUT ──
function appendDigit(d) {
  if (locked || gameOver) return;
  if (typedValue.length >= 5) return;
  typedValue += d;
  document.getElementById('typed-value').textContent = typedValue;
}
function backspace() {
  if (locked || gameOver) return;
  typedValue = typedValue.slice(0, -1);
  document.getElementById('typed-value').textContent = typedValue;
}
function confirmInput() {
  if (locked || gameOver || typedValue === '') return;
  submitAnswer(typedValue);
}
function skPress(key) {
  if (key === 'back') backspace();
  else if (key === 'enter') confirmInput();
  else appendDigit(key);
}

function handleFastGameButtonPress(event) {
  if (event.type === 'mousedown' && window.PointerEvent) return;
  if (event.button !== 0) return;

  const choiceButton = event.target.closest('.choice-btn');
  if (choiceButton) {
    event.preventDefault();
    selectChoice(parseInt(choiceButton.dataset.choiceIdx));
    return;
  }

  const screenKey = event.target.closest('.sk-btn');
  if (screenKey) {
    event.preventDefault();
    skPress(screenKey.dataset.skKey);
  }
}

function handleQuitPress(event) {
  if (event.type === 'mousedown' && window.PointerEvent) return;
  if (event.button !== 0) return;
  event.preventDefault();
  quitGame();
}

// ── FLASH ──
function showFlash(cls) {
  const f = document.getElementById('flash');
  f.className = 'flash ' + cls + ' visible';
  setTimeout(() => f.classList.remove('visible'), 140);
}

// ── QUIT / SCORE ──
function quitGame() {
  clearInterval(timerInterval);
  gameOver = true;
  if (correctCount + wrongCount > 0) showScore();
  else goMenu();
}

function showScore() {
  clearInterval(timerInterval);
  const elapsed = ((Date.now() - gameStartTime) / 1000).toFixed(1);
  const answeredQ = correctCount + wrongCount;

  let modeLabel, subLine, timeLine = null;

  if (selectedGameMode === 'classic') {
    const pct = answeredQ > 0 ? Math.round((correctCount / answeredQ) * 100) : 0;
    modeLabel = 'классика';
    subLine   = `правильно: ${correctCount} из ${answeredQ} · ${pct}%`;
    timeLine  = `время: ${elapsed} сек`;
  } else if (selectedGameMode === 'timed') {
    modeLabel = 'на время';
    subLine   = `вопросов: ${answeredQ} · правильно: ${correctCount} · ошибок: ${wrongCount}`;
  } else {
    modeLabel = 'выживание';
    subLine   = `правильно: ${correctCount} · ошибок: ${wrongCount} · вопросов: ${answeredQ}`;
  }

  if (answeredQ > 0) {
    recordSession({
      trainer: trainerKey(),
      gameMode: selectedGameMode,
      correct: correctCount,
      wrong: wrongCount,
      answered: answeredQ,
      bestStreak,
      elapsedSec: parseFloat(elapsed),
      rangeMax: selectedRange,
      inputMode: selectedInputMode
    });
  }

  const sessionDate = parseDateKey(sessionDateKey || formatDateKey(new Date()));
  const dailyStreak = AppDB.calculateDailyStreak(sessionDate);

  document.getElementById('score-mode-label').textContent = modeLabel;
  document.getElementById('final-score').textContent      = correctCount;
  document.getElementById('final-sub').textContent        = subLine;
  document.getElementById('final-streak').textContent     = `лучшая серия: ${bestStreak}`;
  document.getElementById('final-daily-streak').textContent =
    `серия дней: ${dailyStreak} ${pluralDays(dailyStreak)}`;
  document.getElementById('final-date').textContent =
    `${WEEKDAYS[sessionDate.getDay()]}, ${formatFullDate(sessionDate)}`;

  const timeEl = document.getElementById('final-time');
  if (timeLine) { timeEl.textContent = timeLine; timeEl.style.display = 'block'; }
  else timeEl.style.display = 'none';

  showScreen('score');
}

function goMenu() {
  syncControlsFromState();
  renderDashboard();
  showScreen('menu');
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
}

// ── EVENTS ──
function bindEvents() {
  document.querySelectorAll('.op-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleOp(btn));
  });

  document.getElementById('range-select').addEventListener('change', e => selectRange(e.target));
  document.getElementById('focus-select').addEventListener('change', e => selectFocus(e.target));
  document.getElementById('guide-toggle').addEventListener('change', e => toggleGuide(e.target));
  document.getElementById('sequence-mode-select').addEventListener('change', e => selectSequenceMode(e.target));

  document.querySelectorAll('.gm-btn').forEach(btn => {
    btn.addEventListener('click', () => selectGameMode(btn));
  });

  document.querySelectorAll('.sub-grid').forEach(grid => {
    const mode = grid.dataset.subMode;
    grid.querySelectorAll('.sub-btn').forEach(btn => {
      btn.addEventListener('click', () => selectSub(mode, btn));
    });
  });

  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => selectInputMode(btn));
  });

  document.getElementById('start-btn').addEventListener('click', startGame);
  document.getElementById('quick-start-btn').addEventListener('click', quickStart);

  const quitBtn = document.getElementById('quit-btn');
  quitBtn.addEventListener('pointerdown', handleQuitPress);
  quitBtn.addEventListener('mousedown', handleQuitPress);

  document.getElementById('menu-btn').addEventListener('click', goMenu);
  document.getElementById('restart-btn').addEventListener('click', restartGame);

  const choicesGrid = document.getElementById('choices-grid');
  choicesGrid.addEventListener('pointerdown', handleFastGameButtonPress);
  choicesGrid.addEventListener('mousedown', handleFastGameButtonPress);

  const screenKb = document.getElementById('screen-keyboard');
  screenKb.addEventListener('pointerdown', handleFastGameButtonPress);
  screenKb.addEventListener('mousedown', handleFastGameButtonPress);

  document.getElementById('practice-guide').addEventListener('click', e => {
    if (e.target.closest('#guide-reveal-btn')) {
      setGuideExpanded(!guideExpanded);
    }
  });

  document.addEventListener('keydown', e => {
    if (!document.getElementById('screen-game').classList.contains('active')) return;
    if (selectedInputMode === 'keyboard' || selectedInputMode === 'screen') {
      if (e.key >= '0' && e.key <= '9') { e.preventDefault(); appendDigit(e.key); }
      else if (e.key === 'Backspace') backspace();
      else if (e.key === 'Enter') confirmInput();
    }
  });
}

// ── AUTH ──
function updateUserHeader(login) {
  document.getElementById('user-name').textContent = login;
  document.getElementById('header-user').classList.remove('hidden');
}

function hideUserHeader() {
  document.getElementById('header-user').classList.add('hidden');
}

async function loginUser(rawLogin, rawPassword, writeCookie = true) {
  const login = Auth.normalizeLogin(rawLogin);
  const password = rawPassword || '';
  if (!Auth.isValidLogin(login)) {
    Auth.showError('Логин: 2–24 символа — буквы, цифры, _ или -');
    return false;
  }
  if (!Auth.isValidPassword(password)) {
    Auth.showError('Пароль: от 4 до 64 символов');
    return false;
  }
  Auth.setSubmitEnabled(false);
  try {
    const result = await AppDB.loginWithPassword(login, password);
    if (!result.ok) {
      Auth.showError(result.error || 'Не удалось войти');
      return false;
    }
    if (writeCookie) {
      Auth.setLoginCookie(login);
      Auth.setSessionCookie(result.token);
    }
    Auth.hideLogin();
    updateUserHeader(login);
    updateFocusOptions();
    renderDashboard();
    return true;
  } finally {
    Auth.setSubmitEnabled(true);
  }
}

function logoutUser() {
  AppDB.logout();
  Auth.clearAllCookies();
  hideUserHeader();
  Auth.clearAuthForm();
  Auth.showLogin();
}

function bindAuthEvents() {
  document.getElementById('auth-form').addEventListener('submit', async e => {
    e.preventDefault();
    await loginUser(
      document.getElementById('auth-login').value,
      document.getElementById('auth-password').value,
      true
    );
  });
  document.getElementById('user-logout-btn').addEventListener('click', logoutUser);
}

bindEvents();

async function initApp() {
  try {
    await AppDB.init();
  } catch (e) {
    console.error('SQLite init failed', e);
    Auth.showError('Не удалось загрузить базу данных');
    Auth.showLogin();
    return;
  }
  bindAuthEvents();
  const savedLogin = Auth.getLoginFromCookie();
  const savedToken = Auth.getSessionFromCookie();
  const normalizedLogin = Auth.normalizeLogin(savedLogin || '');
  if (
    savedLogin &&
    savedToken &&
    Auth.canRestoreSession(normalizedLogin, savedToken) &&
    AppDB.restoreSession(normalizedLogin, savedToken)
  ) {
    Auth.hideLogin();
    updateUserHeader(AppDB.getCurrentUser());
    updateFocusOptions();
    renderDashboard();
    return;
  }
  Auth.clearAllCookies();
  Auth.showLogin();
}

initApp();