/* Repaso — 스페인어 레슨 앱. 콘텐츠는 data/bundle.js (window.REPASO_DATA) 에서 읽기만 한다.
   학습 기록·설정은 localStorage 에만 저장. 화면: #/ (코스) → #/s/<set> (경로) → #/s/<set>/<node> (레슨) */
'use strict';
(() => {
const SETS = (window.REPASO_DATA && window.REPASO_DATA.sets) || [];
const SET = Object.fromEntries(SETS.map(s => [s.id, s]));

/* ---------- utils ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pickOne = a => a[Math.floor(Math.random() * a.length)];
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let toastT;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }

/* ---------- text ---------- */
const stripAcc = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
function norm(s, strict = O.strict){
  const x = String(s).toLowerCase().normalize('NFC').replace(/[¿¡?!.,;:"«»()]/g, '').replace(/\s+/g, ' ').trim();
  return strict ? x : stripAcc(x).replace(/ñ/g, 'n');
}
const variants = es => es.split('/').map(v => v.trim()).filter(Boolean);
const speakable = es => variants(es).join(', ');
function tokenize(es){
  return es.trim().split(/\s+/).map(raw => {
    const m = raw.match(/^([¿¡"«(]*)(.*?)([.,;:!?"»)]*)$/u) || ['', '', raw, ''];
    return { raw, pre: m[1], core: m[2], post: m[3] };
  }).filter(t => t.core);
}
const capFirst = s => s.charAt(0).toUpperCase() + s.slice(1);
const matchCase = (src, w) => src.charAt(0) !== src.charAt(0).toLowerCase() ? capFirst(w) : w.toLowerCase();

/* ---------- options & progress ---------- */
const K = { opts: 'repaso.v2.opts', prog: 'repaso.v2.progress' };
const TYPES = [
  ['wordChoice', '단어 고르기'], ['wordType', '단어 쓰기'],
  ['choose', '알맞은 말 고르기'], ['build', '문장 조립'], ['blank', '빈칸 쓰기'],
];
const DEF = { len: 10, strict: true, sound: true, speak: true, theme: 'auto', goal: 20, types: Object.fromEntries(TYPES.map(([k]) => [k, true])) };
const O = Object.assign({}, DEF, lsGet(K.opts, {}));
O.types = Object.assign({}, DEF.types, O.types || {});
const saveOpts = () => lsSet(K.opts, O);
const P = Object.assign({ items: {}, days: {}, xp: 0 }, lsGet(K.prog, {}));
const saveProg = () => lsSet(K.prog, P);
const setStats = id => (P.items[id] = P.items[id] || {});

function applyTheme(){ if (O.theme === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = O.theme; }
applyTheme();

function streak(){
  let n = 0; const d = new Date();
  if (!P.days[dayKey(d)]) d.setDate(d.getDate() - 1);
  while (P.days[dayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
const todayXp = () => P.days[dayKey()] || 0;

/* ---------- per-set derived data ---------- */
const WORD_CHUNK = 15;
function prep(set){
  if (set._p) return set._p;
  const confOf = new Map();
  (set.confusables || []).forEach(g => g.forEach(x => { const k = x.toLowerCase(); if (!confOf.has(k)) confOf.set(k, g.map(y => y.toLowerCase())); }));
  const sent = new Map(set.sentences.map(s => [s.id, s]));
  const word = new Map(set.words.map(w => [w.id, w]));
  const rule = new Map(set.rules.map(r => [r.id, r]));
  const wordByForm = new Map();
  set.words.forEach(w => variants(w.es).forEach(v => { const k = v.toLowerCase(); if (!wordByForm.has(k)) wordByForm.set(k, w.id); }));
  const lowerKnown = new Set(wordByForm.keys());
  set.sentences.forEach(s => tokenize(s.es).forEach((t, i) => { if (i > 0 && t.core === t.core.toLowerCase()) lowerKnown.add(t.core); }));
  const wordsIn = ss => [...new Set(ss.flatMap(s => tokenize(s.es).map(t => wordByForm.get(t.core.toLowerCase())).filter(Boolean)))].map(id => 'w:' + id);

  const sections = [];
  if (set.sentences.length) {
    const nodes = [];
    set.rules.forEach(r => {
      const ss = set.sentences.filter(s => s.rule === r.id);
      if (ss.length) nodes.push({ id: 'r-' + r.id, title: r.name, sub: `문장 ${ss.length}개`, icon: 'chat', rule: r, items: [...ss.map(s => 's:' + s.id), ...wordsIn(ss)] });
    });
    const loose = set.sentences.filter(s => !s.rule || !rule.has(s.rule));
    if (loose.length) nodes.push({ id: 'r-etc', title: '기타 문장', sub: `문장 ${loose.length}개`, icon: 'chat', items: [...loose.map(s => 's:' + s.id), ...wordsIn(loose)] });
    sections.push({ title: '문장 연습', nodes });
  }
  if (set.words.length) {
    const n = Math.ceil(set.words.length / WORD_CHUNK), size = Math.ceil(set.words.length / n), nodes = [];
    for (let i = 0; i < n; i++) {
      const ws = set.words.slice(i * size, (i + 1) * size);
      nodes.push({ id: 'w' + (i + 1), title: n > 1 ? `단어 ${i + 1}` : '단어', sub: ws.slice(0, 3).map(w => variants(w.es)[0]).join(', ') + ' …', icon: 'book', items: ws.map(w => 'w:' + w.id) });
    }
    sections.push({ title: '단어 익히기', nodes });
  }
  const all = [...set.sentences.map(s => 's:' + s.id), ...set.words.map(w => 'w:' + w.id)];
  sections.push({ title: '복습', nodes: [
    { id: 'all', title: '전체 복습', sub: '약한 문제 위주로', icon: 'star', items: all },
    { id: 'miss', title: '틀린 문제', sub: '아직 못 외운 것만', icon: 'target', items: null },
  ] });
  const nodeById = new Map(sections.flatMap(s => s.nodes).map(n => [n.id, n]));
  return set._p = { confOf, sent, word, rule, lowerKnown, sections, nodeById, all };
}
const itemOf = (set, key) => key[0] === 's' ? prep(set).sent.get(key.slice(2)) : prep(set).word.get(key.slice(2));
const mastered = r => r && r.s >= 2;
function missedKeys(set){ const st = setStats(set.id); return prep(set).all.filter(k => st[k] && st[k].w > 0 && !mastered(st[k])); }
function nodeKeys(set, node){ return node.id === 'miss' ? missedKeys(set) : node.items; }
function nodeProgress(set, node){
  const st = setStats(set.id); const keys = node.id === 'miss' ? missedKeys(set) : node.items;
  if (!keys.length) return { pct: node.id === 'miss' ? 100 : 0, seen: false, n: 0 };
  const m = keys.filter(k => mastered(st[k])).length;
  return { pct: Math.round(m / keys.length * 100), seen: keys.some(k => st[k]), n: keys.length };
}
function setProgress(set){ const st = setStats(set.id); const all = prep(set).all; return { m: all.filter(k => mastered(st[k])).length, n: all.length }; }

/* ---------- lesson generation ---------- */
function weight(r){
  if (!r) return 2;
  let x = 1 + r.w * 1.2 - r.r * 0.25;
  if (r.s === 0 && r.w > 0) x += 1;
  if (mastered(r)) x *= 0.4;
  return Math.max(0.2, x);
}
function sample(keys, n, wf){
  const out = []; let pool = [];
  while (out.length < n) {
    if (!pool.length) pool = keys.slice();
    const w = pool.map(wf); let x = Math.random() * w.reduce((a, b) => a + b, 0), i = 0;
    for (; i < pool.length - 1; i++) { x -= w[i]; if (x <= 0) break; }
    if (pool.length > 1 && pool[i] === out[out.length - 1]) i = (i + 1) % pool.length;
    out.push(pool[i]); pool.splice(i, 1);
  }
  return out;
}
function chooseType(set, key){
  const T = O.types; const opts = [];
  if (key[0] === 'w') {
    if (T.wordChoice && set.words.length >= 2) opts.push('wordChoice', 'wordChoice');
    if (T.wordType) opts.push('wordType');
    return pickOne(opts.length ? opts : [set.words.length >= 2 ? 'wordChoice' : 'wordType']);
  }
  if (T.choose) opts.push('choose');
  if (T.build) opts.push('build', 'build');
  if (T.blank) opts.push('blank');
  return pickOne(opts.length ? opts : ['build']);
}
function makeLesson(set, node){
  const keys = nodeKeys(set, node);
  if (!keys.length) return null;
  const st = setStats(set.id);
  const wf = k => weight(st[k]);
  const sk = keys.filter(k => k[0] === 's'), wk = keys.filter(k => k[0] === 'w');
  let picks;
  if (sk.length && wk.length && node.id !== 'miss') { // 문장 위주(약 70%)로 섞음
    const nS = Math.round(O.len * 0.7);
    picks = shuffle([...sample(sk, nS, wf), ...sample(wk, O.len - nS, wf)]);
  } else picks = sample(keys, O.len, wf);
  return {
    setId: set.id, nodeId: node.id, queue: picks.map(key => ({ key, type: chooseType(set, key) })),
    i: 0, ok: 0, bad: 0, combo: 0, best: 0, retried: new Set(), missed: [], start: Date.now(), q: null, done: false,
  };
}

/* ---------- question builders ---------- */
function confTokenIdx(set, tokens){ const c = prep(set).confOf; return tokens.map((t, i) => c.has(t.core.toLowerCase()) ? i : -1).filter(i => i >= 0); }

function buildQ(set, spec){
  const it = itemOf(set, spec.key); const p = prep(set);
  const q = { ...spec, item: it, answered: false };
  if (spec.type === 'wordChoice') {
    q.dir = Math.random() < 0.5 ? 'ko2es' : 'es2ko';
    const field = q.dir === 'ko2es' ? 'es' : 'ko';
    q.prompt = q.dir === 'ko2es' ? it.ko : it.es; q.ans = it[field];
    const others = shuffle(set.words.filter(w => w.id !== it.id).map(w => w[field])).filter(t => t !== q.ans);
    q.choices = shuffle([q.ans, ...[...new Set(others)].slice(0, 3)]); q.sel = null;
  } else if (spec.type === 'wordType') {
    q.prompt = it.ko; q.ans = it.es; q.typed = '';
  } else {
    q.tokens = tokenize(it.es);
    const conf = confTokenIdx(set, q.tokens);
    if (spec.type === 'choose') {
      const cand = conf.length ? conf : q.tokens.map((t, i) => i).filter(i => q.tokens[i].core.length > 2);
      q.idx = pickOne(cand.length ? cand : q.tokens.map((_, i) => i));
      const tok = q.tokens[q.idx].core, low = tok.toLowerCase();
      let pool = p.confOf.get(low) ? p.confOf.get(low).filter(x => x !== low) : [];
      const fillers = p.confOf.size
        ? shuffle([...new Set([...p.confOf.keys()])].filter(x => x !== low && !pool.includes(x)))
        : shuffle([...new Set(set.sentences.flatMap(s => tokenize(s.es).slice(1).map(t => t.core.toLowerCase())))].filter(x => x !== low));
      pool = [...pool, ...fillers].slice(0, 3);
      q.ans = tok; q.choices = shuffle([tok, ...pool.map(x => matchCase(tok, x))]); q.sel = null;
    } else if (spec.type === 'build') {
      const shown = q.tokens.map((t, i) => (i === 0 && p.lowerKnown.has(t.core.toLowerCase())) ? t.core.toLowerCase() : t.core);
      const extra = [];
      conf.slice(0, 1).forEach(i => { const g = p.confOf.get(q.tokens[i].core.toLowerCase()).filter(x => x !== q.tokens[i].core.toLowerCase()); if (g.length) extra.push(pickOne(g)); });
      const inSent = new Set(q.tokens.map(t => t.core.toLowerCase()));
      const other = shuffle(set.sentences.filter(s => s.id !== it.id).flatMap(s => tokenize(s.es).slice(1).map(t => t.core)).filter(c => !inSent.has(c.toLowerCase()) && !extra.includes(c)));
      if (other.length) extra.push(other[0]);
      if (q.tokens.length > 5 && other.length > 1) extra.push(other[1]);
      q.tiles = shuffle([...shown, ...extra].map((t, k) => ({ t, k }))); q.placed = [];
    } else { // blank
      const n = q.tokens.length, rest = shuffle(q.tokens.map((_, i) => i).filter(i => !conf.includes(i)));
      const target = Math.max(1, Math.round(n * 0.35));
      q.blanks = [...conf, ...rest].slice(0, Math.max(target, conf.length)).sort((a, b) => a - b);
      q.values = {}; q.results = {};
    }
  }
  return q;
}

function canCheck(q){
  if (!q || q.answered) return false;
  switch (q.type) {
    case 'wordChoice': case 'choose': return q.sel != null;
    case 'wordType': return !!q.typed.trim();
    case 'build': return q.placed.length > 0;
    case 'blank': return q.blanks.some(i => (q.values[i] || '').trim());
  }
}
function grade(q){
  switch (q.type) {
    case 'wordChoice': case 'choose': return norm(q.choices[q.sel], true) === norm(q.ans, true);
    case 'wordType': { const v = norm(q.typed); return variants(q.ans).some(a => norm(a) === v) || norm(q.ans) === v; }
    case 'build': {
      q.built = q.placed.map(k => q.tiles.find(t => t.k === k).t).join(' ');
      return [q.item.es, ...(q.item.alt || [])].some(a => norm(a, true) === norm(q.built, true));
    }
    case 'blank': {
      let ok = true;
      q.blanks.forEach(i => { const r = norm(q.values[i] || '') === norm(q.tokens[i].core); q.results[i] = r; if (!r) ok = false; });
      return ok;
    }
  }
}

/* ---------- sound & speech ---------- */
let actx;
function beep(ok){
  if (!O.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = ok ? [[660, 0], [880, 0.09]] : [[220, 0], [180, 0.12]];
    notes.forEach(([f, t]) => {
      const o = actx.createOscillator(), g = actx.createGain(), s = actx.currentTime + t;
      o.type = ok ? 'sine' : 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.18, s + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.18);
      o.connect(g).connect(actx.destination); o.start(s); o.stop(s + 0.2);
    });
  } catch {}
}
let esVoice = null;
function loadVoice(){
  if (!('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices();
  esVoice = vs.find(v => /^es[-_]ES/i.test(v.lang)) || vs.find(v => /^es/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) { loadVoice(); speechSynthesis.addEventListener?.('voiceschanged', loadVoice); }
function speak(text){
  if (!('speechSynthesis' in window) || !text) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = esVoice ? esVoice.lang : 'es-ES'; if (esVoice) u.voice = esVoice; u.rate = 0.9;
    speechSynthesis.speak(u);
  } catch {}
}
const canSpeak = 'speechSynthesis' in window;

/* ---------- icons & mascot ---------- */
const ICONS = {
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 18 9 12l6-6"/>',
  fire: '<path fill="currentColor" stroke="none" d="M12 2c1.2 3.6 5.5 5.6 5.5 11a5.5 5.5 0 0 1-11 0c0-2.4 1.1-4.1 2.3-5.2.3 1.8 1 2.9 2.2 3.4C10.6 8 11 5 12 2z"/>',
  bolt: '<path fill="currentColor" stroke="none" d="M13.5 2 4 14h7l-1.5 8L19 10h-7z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  speaker: '<path fill="currentColor" stroke="none" d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.3A8.4 8.4 0 1 1 21 11.5z"/>',
  star: '<path fill="currentColor" stroke="none" d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  check: '<path d="M5 12.5 10 17.5 19 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const ic = (n, s = 24, sw = 2.6) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
function mascot(mood = 'happy', cls = 'mascot'){
  const rays = Array.from({ length: 8 }, (_, i) => `<rect x="46" y="4" width="8" height="16" rx="4" fill="#FF9600" transform="rotate(${i * 45} 50 50)"/>`).join('');
  const mouth = mood === 'sad' ? '<path d="M40 66q10-7 20 0" stroke="#7A4A00" stroke-width="4" fill="none" stroke-linecap="round"/>'
    : '<path d="M38 60q12 12 24 0" stroke="#7A4A00" stroke-width="4" fill="#fff" stroke-linecap="round" stroke-linejoin="round"/>';
  return `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><g class="bob">${rays}
    <circle cx="50" cy="52" r="31" fill="#FFC800"/><path d="M19 52a31 31 0 0 0 62 0 31 26 0 0 1-62 0z" fill="#E5A400" opacity=".55"/>
    <ellipse cx="39" cy="46" rx="6" ry="7.5" fill="#fff"/><ellipse cx="61" cy="46" rx="6" ry="7.5" fill="#fff"/>
    <circle cx="40" cy="47.5" r="3.6" fill="#3C3C3C"/><circle cx="62" cy="47.5" r="3.6" fill="#3C3C3C"/>
    <circle cx="31" cy="58" r="4" fill="#FF86D0" opacity=".6"/><circle cx="69" cy="58" r="4" fill="#FF86D0" opacity=".6"/>${mouth}</g></svg>`;
}

/* ---------- routing ---------- */
let L = null;      // 진행 중인 레슨
let sheet = null;  // 열린 시트: {kind, ...}
function parse(){
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent).filter(Boolean);
  if (parts[0] === 's' && SET[parts[1]]) return { view: parts[2] ? 'lesson' : 'path', set: SET[parts[1]], nodeId: parts[2] };
  return { view: 'home' };
}
const go = h => { if (location.hash !== h) location.hash = h; else render(); };
window.addEventListener('hashchange', () => { sheet = null; render(); window.scrollTo(0, 0); });

/* ---------- render ---------- */
function render(){
  const r = parse();
  if (r.view === 'lesson') {
    const node = prep(r.set).nodeById.get(r.nodeId);
    if (!node) return go('#/s/' + r.set.id);
    if (!L || L.setId !== r.set.id || L.nodeId !== node.id) {
      L = makeLesson(r.set, node);
      if (!L) { toast('지금은 풀 문제가 없어요'); return go('#/s/' + r.set.id); }
    }
    renderLesson(r.set);
  } else {
    L = null;
    if (r.view === 'path') renderPath(r.set); else renderHome();
  }
  renderSheet();
}

function topStats(){
  const s = streak();
  return `<span class="stat fire ${s ? '' : 'off'}" title="연속 학습일">${ic('fire', 22)}${s}</span>
    <span class="stat xp" title="총 XP">${ic('bolt', 22)}${P.xp}</span>
    <button class="icon-btn" data-act="settings" aria-label="설정">${ic('gear', 22, 2.2)}</button>`;
}

function renderHome(){
  const tx = todayXp(), goalPct = Math.min(100, Math.round(tx / O.goal * 100));
  const greet = tx >= O.goal ? '오늘 목표 달성! ¡Muy bien!' : tx ? '좋아요, 조금만 더 해볼까요?' : '오늘도 가볍게 한 레슨!';
  $('#app').innerHTML = `
  <header class="top"><div class="top-in">
    <a class="brand" href="#/"><span class="logo">¡R</span>Repaso</a><span class="spacer"></span>${topStats()}
  </div></header>
  <main class="wrap">
    <section class="hello">${mascot()}<div style="flex:1;min-width:0">
      <h1>¡Hola!</h1><p>${greet}</p>
      <div class="goal" role="progressbar" aria-valuenow="${tx}" aria-valuemax="${O.goal}" aria-label="오늘 목표"><i style="width:${goalPct}%"></i></div>
      <p style="margin-top:4px;font-size:.8rem;font-weight:700">오늘 ${tx} / ${O.goal} XP</p>
    </div></section>
    <h2 class="h2">코스</h2>
    ${SETS.length ? `<div class="courses">${SETS.map(courseCard).join('')}</div>`
      : `<div class="empty">아직 문제 세트가 없어요.<br><small>data/sets 에 JSON 을 추가하고 <code>node scripts/build.js</code> 를 실행하세요.</small></div>`}
  </main>`;
}
function courseCard(set){
  const { m, n } = setProgress(set);
  return `<a class="course" href="#/s/${encodeURIComponent(set.id)}" data-color="${esc(set.color)}">
    <span class="ic" aria-hidden="true">${esc(set.icon || '📘')}</span>
    <span class="meta"><h3>${esc(set.title)}${set.level ? `<span class="tag">${esc(set.level)}</span>` : ''}</h3>
      <p>${esc(set.description)}</p>
      <span class="bar"><i style="width:${n ? m / n * 100 : 0}%"></i></span>
      <span class="nums">${m} / ${n} 익힘 · 문장 ${set.sentences.length} · 단어 ${set.words.length}</span></span>
  </a>`;
}

function renderPath(set){
  const p = prep(set); let k = 0;
  const xs = [0, 44, 66, 44, 0, -44, -66, -44];
  const rec = p.sections.flatMap(s => s.nodes).find(n => n.id !== 'miss' && nodeProgress(set, n).pct < 100);
  $('#app').innerHTML = `
  <header class="top"><div class="top-in">
    <a class="back" href="#/" aria-label="코스 목록">${ic('back', 24, 3)}</a>
    <span class="top-title">${esc(set.icon)} ${esc(set.title)}</span><span class="spacer"></span>${topStats()}
  </div></header>
  <main class="wrap" data-color="${esc(set.color)}">
    ${p.sections.map((sec, si) => `
      <div class="unit"><small>유닛 ${si + 1}</small><b>${esc(sec.title)}</b></div>
      <div class="path">${sec.nodes.map(node => {
        const pr = nodeProgress(set, node); const x = xs[k++ % xs.length];
        const done = pr.pct >= 100 && pr.n > 0;
        const cur = rec && rec.id === node.id;
        const cls = done ? 'done' : pr.seen || cur ? '' : 'fresh';
        const icon = done ? 'check' : node.icon;
        const sub = node.id === 'miss' ? (pr.n ? `${pr.n}개 남음` : '없음') : node.sub;
        return `<div class="node-wrap ${done ? 'done' : ''}" style="--x:${x}px">
          <div style="position:relative">${cur ? '<span class="start-tip">시작</span>' : ''}<button class="node ${cls}" data-act="node" data-id="${esc(node.id)}" aria-label="${esc(node.title)} — ${pr.pct}% 익힘">${ic(icon, 32, 3)}</button>
          ${pr.seen && !done ? `<span class="ring" style="--p:${pr.pct}"></span>` : ''}</div>
          <div class="node-label">${esc(node.title)}<small>${esc(sub)}${pr.seen && node.id !== 'miss' ? ` · ${pr.pct}%` : ''}</small></div>
        </div>`;
      }).join('')}</div>`).join('')}
  </main>`;
}

/* ---------- sheets ---------- */
function renderSheet(){
  const old = $('.scrim'); if (old) old.remove();
  if (!sheet) return;
  let h = '';
  if (sheet.kind === 'node') {
    const set = SET[sheet.setId], node = prep(set).nodeById.get(sheet.nodeId), pr = nodeProgress(set, node);
    const keys = nodeKeys(set, node);
    h = `<div class="sheet" data-color="${esc(set.color)}" role="dialog" aria-modal="true" aria-labelledby="shT">
      <h2 id="shT">${esc(node.title)}</h2>
      <p>${keys.length ? `${pr.n}개 중 ${pr.pct}% 익힘 · 문제 ${O.len}개` : '지금은 복습할 문제가 없어요. 잘하고 있어요!'}</p>
      ${node.rule && node.rule.tip ? `<div class="tipbox"><b>핵심 정리</b>${esc(node.rule.tip)}</div>` : ''}
      <div class="actions">
        ${keys.length ? `<button class="btn set wide" data-act="start">레슨 시작</button>` : ''}
        <button class="btn plain wide" data-act="close-sheet">닫기</button>
      </div></div>`;
  } else if (sheet.kind === 'quit') {
    h = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="shT" style="text-align:center">
      ${mascot('sad')}<h2 id="shT">벌써 그만두나요?</h2><p>지금 그만두면 이번 레슨의 XP를 받지 못해요.</p>
      <div class="actions"><button class="btn blue wide" data-act="close-sheet">계속 공부하기</button><button class="btn plain danger wide" data-act="quit">그만두기</button></div></div>`;
  } else if (sheet.kind === 'settings') {
    const seg = (key, vals) => `<div class="segs">${vals.map(([v, l]) => `<button class="seg" data-act="opt" data-k="${key}" data-v="${v}" aria-pressed="${O[key] === v}">${l}</button>`).join('')}</div>`;
    const sw = (key, label, sub) => `<label class="switch"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><input type="checkbox" data-opt="${key}" ${O[key] ? 'checked' : ''}></label>`;
    h = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="shT">
      <h2 id="shT">설정</h2>
      <div class="opt-group"><h3>레슨 길이</h3>${seg('len', [[5, '5문제'], [10, '10문제'], [15, '15문제'], [20, '20문제']])}</div>
      <div class="opt-group"><h3>하루 목표</h3>${seg('goal', [[10, '10 XP'], [20, '20 XP'], [30, '30 XP'], [50, '50 XP']])}</div>
      <div class="opt-group"><h3>문제 유형</h3><div class="segs">${TYPES.map(([k, l]) => `<button class="seg" data-act="type" data-k="${k}" aria-pressed="${!!O.types[k]}">${l}</button>`).join('')}</div></div>
      <div class="opt-group">
        ${sw('strict', '악센트까지 정확히 채점', 'esta 와 está 를 다르게 봐요')}
        ${sw('sound', '효과음')}
        ${canSpeak ? sw('speak', '정답 발음 자동 재생', '기기에 스페인어 음성이 있어야 해요') : ''}
      </div>
      <div class="opt-group"><h3>화면</h3>${seg('theme', [['auto', '시스템'], ['light', '라이트'], ['dark', '다크']])}</div>
      <div class="actions"><button class="btn blue wide" data-act="close-sheet">완료</button>
        <button class="btn plain danger wide" data-act="reset">학습 기록 모두 지우기</button></div>
    </div>`;
  }
  const el = document.createElement('div');
  el.className = 'scrim'; el.innerHTML = h;
  document.body.appendChild(el);
  const f = el.querySelector('.btn'); if (f) f.focus({ preventScroll: true });
}

/* ---------- lesson view ---------- */
const PRAISE = ['훌륭해요!', '정확해요!', '좋아요!', '완벽해요!', '¡Muy bien!', '¡Perfecto!'];
const TITLE = {
  wordChoice: q => q.dir === 'ko2es' ? '알맞은 스페인어를 고르세요' : '알맞은 뜻을 고르세요',
  wordType: () => '스페인어로 쓰세요',
  choose: () => '빈칸에 알맞은 말을 고르세요',
  build: () => '이 문장을 스페인어로 만드세요',
  blank: () => '빈칸을 채워 문장을 완성하세요',
};
function renderLesson(set){
  if (L.done) return renderResult(set);
  if (!L.q) L.q = buildQ(set, L.queue[L.i]);
  const q = L.q;
  const pct = Math.round(L.i / L.queue.length * 100);
  let body = '';
  const sayBtn = (t, sm) => canSpeak ? `<button class="say ${sm ? 'sm' : ''}" data-act="say" data-t="${esc(t)}" aria-label="발음 듣기">${ic('speaker', sm ? 16 : 20, 2.4)}</button>` : '';

  if (q.type === 'wordChoice') {
    const isEs = q.dir === 'es2ko';
    body = `<div class="bubble-row">${mascot()}<div class="bubble ${isEs ? 'es' : ''}">${isEs ? sayBtn(speakable(q.prompt)) : ''}${esc(q.prompt)}</div></div>
      <div class="choices ${q.choices.every(c => c.length < 18) ? 'two' : ''}" role="radiogroup">${q.choices.map((c, i) => choiceBtn(q, c, i)).join('')}</div>`;
  } else if (q.type === 'wordType') {
    body = `<div class="bubble-row">${mascot()}<div class="bubble">${esc(q.prompt)}</div></div>
      <input class="typed" id="tIn" value="${esc(q.typed)}" ${q.answered ? 'disabled' : ''} placeholder="스페인어로 입력" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" lang="es" aria-label="답 입력">
      ${q.answered ? '' : accentBar()}`;
  } else if (q.type === 'choose') {
    const parts = q.tokens.map((t, i) => i !== q.idx ? esc(t.raw)
      : esc(t.pre) + `<span class="gap ${q.answered ? (q.ok ? 'ok' : 'bad') : q.sel != null ? 'on' : ''}">${q.sel != null ? esc(q.choices[q.sel]) : '&nbsp;'}</span>` + esc(t.post));
    body = `<p style="margin:0 0 6px;color:var(--muted);font-weight:700">${esc(q.item.ko)}</p>
      <p class="sent es" lang="es">${parts.join(' ')}</p>
      <div class="choices two" role="radiogroup">${q.choices.map((c, i) => choiceBtn(q, c, i)).join('')}</div>`;
  } else if (q.type === 'build') {
    const placed = new Set(q.placed);
    body = `<div class="bubble-row">${mascot()}<div class="bubble">${esc(q.item.ko)}</div></div>
      <div class="zone" aria-label="만든 문장">${q.placed.map((k, pos) => `<button class="tile es" data-act="unplace" data-pos="${pos}" ${q.answered ? 'disabled' : ''}>${esc(q.tiles.find(t => t.k === k).t)}</button>`).join('')}</div>
      <div class="pool" aria-label="단어 타일">${q.tiles.map(t => `<button class="tile es ${placed.has(t.k) ? 'used' : ''}" data-act="place" data-k="${t.k}" ${placed.has(t.k) || q.answered ? 'tabindex="-1" disabled' : ''}>${esc(t.t)}</button>`).join('')}</div>`;
  } else {
    const bset = new Set(q.blanks);
    const parts = q.tokens.map((t, i) => {
      if (!bset.has(i)) return esc(t.raw);
      if (q.answered) {
        const v = (q.values[i] || '').trim();
        return esc(t.pre) + (q.results[i] ? `<span class="r-ok">${esc(v)}</span>` : `<span class="r-bad">${v ? `<s>${esc(v)}</s>` : ''}${esc(t.core)}</span>`) + esc(t.post);
      }
      return esc(t.pre) + `<input data-bi="${i}" value="${esc(q.values[i] || '')}" style="width:${Math.max(3, t.core.length + 1.5)}ch" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" lang="es" aria-label="빈칸">` + esc(t.post);
    });
    body = `<div class="bubble-row">${mascot()}<div class="bubble">${esc(q.item.ko)}</div></div>
      <p class="sent es" lang="es">${parts.join(' ')}</p>${q.answered ? '' : accentBar()}`;
  }

  const showCombo = L.combo >= 3 && !q.answered;
  $('#app').innerHTML = `<div class="lesson" data-color="${esc(set.color)}">
    <div class="l-top">
      <button class="icon-btn" data-act="ask-quit" aria-label="레슨 그만두기">${ic('close', 26, 3)}</button>
      <div class="prog" role="progressbar" aria-valuenow="${pct}" aria-valuemax="100" aria-label="진행률"><i style="width:${pct}%"></i></div>
      <span class="combo">${L.combo >= 2 ? `${ic('fire', 18)} ${L.combo}` : ''}</span>
    </div>
    <main class="l-body" id="lbody">
      ${showCombo ? `<p class="combo-pop">${L.combo}연속 정답!</p>` : ''}
      ${L.queue[L.i].retry ? `<p class="q-kind">${ic('target', 16)} 다시 도전</p>` : ''}
      <h1 class="q-title">${TITLE[q.type](q)}</h1>
      ${body}
    </main>
    ${footer(set, q)}
  </div>`;
  if (!q.answered) {
    const first = document.querySelector('.sent input, .typed');
    if (first && window.matchMedia('(hover:hover)').matches) first.focus({ preventScroll: true });
  } else {
    const nb = $('#nextBtn'); if (nb) nb.focus({ preventScroll: true });
  }
}
function choiceBtn(q, c, i){
  let cls = '';
  if (q.answered) { if (norm(c, true) === norm(q.ans, true)) cls = 'ok'; else if (i === q.sel) cls = 'bad'; }
  const isEs = (q.type === 'choose') || (q.type === 'wordChoice' && q.dir === 'ko2es');
  return `<button class="choice ${cls} ${isEs ? 'es' : ''}" role="radio" data-act="pick" data-i="${i}" aria-pressed="${q.sel === i}" aria-checked="${q.sel === i}" ${q.answered ? 'disabled' : ''}><span class="k">${i + 1}</span>${esc(c)}</button>`;
}
function accentBar(){
  return `<div class="accents" aria-label="특수 문자">${['á', 'é', 'í', 'ó', 'ú', 'ñ', 'ü', '¿', '¡'].map(c => `<button type="button" data-act="acc" data-c="${c}" tabindex="-1">${c}</button>`).join('')}</div>`;
}
function footer(set, q){
  if (!q.answered) {
    return `<footer class="l-foot"><div class="foot-in">
      <button class="btn ghost foot-skip" data-act="skip">건너뛰기</button>
      <button class="btn" id="checkBtn" data-act="check" ${canCheck(q) ? '' : 'disabled'}>확인</button>
    </div></footer>`;
  }
  const it = q.item, isS = q.key[0] === 's';
  const rule = isS && it.rule ? prep(set).rule.get(it.rule) : null;
  const answerText = isS ? it.es : (q.type === 'wordChoice' && q.dir === 'es2ko' ? it.ko : it.es);
  const sub = isS ? it.ko : (q.type === 'wordChoice' && q.dir === 'es2ko' ? it.es : it.ko);
  return `<footer class="l-foot ${q.ok ? 'ok' : 'bad'}" role="alert"><div class="foot-in">
    <div class="fb"><span class="badge">${ic(q.ok ? 'check' : 'close', 34, 3.4)}</span><div style="min-width:0">
      <h3>${q.ok ? esc(q.praise) : '정답:'}</h3>
      <p class="ans es">${sayBtn2(isS ? it.es : speakable(it.es))}${esc(answerText)}</p>
      <p class="ko">${esc(sub)}</p>
      ${!q.ok && rule ? `<p class="tip"><b>${esc(rule.name)}</b>${esc(rule.tip || '')}</p>` : ''}
    </div></div>
    <button class="btn ${q.ok ? '' : 'red'}" id="nextBtn" data-act="next">계속</button>
  </div></footer>`;
}
const sayBtn2 = t => canSpeak ? `<button class="say sm" data-act="say" data-t="${esc(t)}" aria-label="발음 듣기">${ic('speaker', 16, 2.4)}</button>` : '';

function submit(set, skipped){
  const q = L.q; if (!q || q.answered) return;
  if (!skipped && !canCheck(q)) return;
  q.ok = skipped ? false : grade(q);
  if (skipped && q.type === 'blank') q.blanks.forEach(i => { q.results[i] = false; });
  if (skipped && q.type === 'build') q.built = '';
  q.answered = true; q.praise = pickOne(PRAISE);
  const st = setStats(set.id), r = st[q.key] || { r: 0, w: 0, s: 0 };
  if (q.ok) { r.r++; r.s = (r.s || 0) + 1; L.ok++; L.combo++; L.best = Math.max(L.best, L.combo); }
  else {
    r.w++; r.s = 0; L.bad++; L.combo = 0;
    if (!L.missed.includes(q.key)) L.missed.push(q.key);
    if (!L.retried.has(q.key)) { L.retried.add(q.key); L.queue.push({ key: q.key, type: q.type, retry: true }); }
  }
  r.t = Date.now(); st[q.key] = r; saveProg();
  beep(q.ok);
  if (O.speak && (q.key[0] === 's' || q.type !== 'wordChoice' || q.dir === 'ko2es')) speak(q.key[0] === 's' ? q.item.es : speakable(q.item.es));
  renderLesson(set);
  if (!q.ok) { const b = $('#lbody'); b && b.classList.add('shake'); }
}
function next(set){
  L.i++; L.q = null;
  if (L.i >= L.queue.length) finish(set);
  renderLesson(set); window.scrollTo(0, 0);
}
function finish(set){
  L.done = true; L.time = Math.round((Date.now() - L.start) / 1000);
  const perfect = L.bad === 0;
  L.xp = L.ok + 5 + (perfect ? 5 : 0);
  P.xp += L.xp; const d = dayKey(); P.days[d] = (P.days[d] || 0) + L.xp; saveProg();
}
function renderResult(set){
  const acc = Math.round(L.ok / Math.max(1, L.ok + L.bad) * 100);
  const mm = Math.floor(L.time / 60), ss = String(L.time % 60).padStart(2, '0');
  const perfect = L.bad === 0;
  const missed = L.missed.map(k => itemOf(set, k)).filter(Boolean);
  $('#app').innerHTML = `<div class="result" data-color="${esc(set.color)}">
    ${mascot()}
    <h1>${perfect ? '완벽해요!' : '레슨 완료!'}</h1>
    <p>${perfect ? '하나도 틀리지 않았어요. ¡Increíble!' : `최고 ${L.best}연속 정답 · 틀린 ${missed.length}개는 다시 나올 거예요`}</p>
    <div class="cards">
      <div class="sc xp"><small>총 XP</small><b>${ic('bolt', 20)}${L.xp}</b></div>
      <div class="sc acc"><small>정확도</small><b>${ic('target', 20)}${acc}%</b></div>
      <div class="sc time"><small>시간</small><b>${ic('clock', 20)}${mm}:${ss}</b></div>
    </div>
    ${missed.length ? `<div class="review"><h3>다시 볼 것</h3><ul>${missed.map(it => `<li><span class="es">${esc(it.es)}</span><span class="ko">${esc(it.ko)}</span></li>`).join('')}</ul></div>` : ''}
  </div>
  <footer class="l-foot"><div class="foot-in" style="justify-content:flex-end">
    <button class="btn ghost foot-skip" data-act="again">한 번 더</button>
    <button class="btn" id="nextBtn" data-act="leave">계속</button>
  </div></footer>`;
  const nb = $('#nextBtn'); if (nb) nb.focus({ preventScroll: true });
  confetti();
}
function confetti(){
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div'); box.className = 'confetti';
  const cols = ['#58CC02', '#1CB0F6', '#FFC800', '#FF4B4B', '#CE82FF', '#FF9600'];
  box.innerHTML = Array.from({ length: 70 }, () => `<i style="left:${Math.random() * 100}%;background:${pickOne(cols)};animation-duration:${1.8 + Math.random() * 1.6}s;animation-delay:${Math.random() * 0.5}s;transform:rotate(${Math.random() * 360}deg)"></i>`).join('');
  document.body.appendChild(box); setTimeout(() => box.remove(), 4200);
}

/* ---------- events ---------- */
let lastInput = null;
document.addEventListener('focusin', e => { if (e.target.matches('.sent input, .typed')) lastInput = e.target; });
document.addEventListener('pointerdown', e => { if (e.target.closest('[data-act="acc"]')) e.preventDefault(); });
const curSet = () => parse().set;
const refreshCheck = () => { const b = $('#checkBtn'); if (b && L && L.q) b.disabled = !canCheck(L.q); };

document.addEventListener('input', e => {
  const t = e.target; if (!L || !L.q) return;
  if (t.dataset.bi != null) L.q.values[t.dataset.bi] = t.value;
  if (t.id === 'tIn') L.q.typed = t.value;
  refreshCheck();
});
document.addEventListener('change', e => {
  const k = e.target.dataset.opt; if (!k) return;
  O[k] = e.target.checked; saveOpts();
});

document.addEventListener('keydown', e => {
  if (e.isComposing) return;
  if (e.key === 'Escape' && sheet) { sheet = null; renderSheet(); return; }
  if (sheet || !L) return;
  const set = curSet(); if (!set) return;
  const q = L.q, inField = e.target.tagName === 'INPUT';
  if (e.key === 'Enter') {
    if (L.done) { e.preventDefault(); go('#/s/' + set.id); return; }
    if (!q) return;
    if (e.target.tagName === 'BUTTON' && !q.answered && e.target.id !== 'checkBtn') return; // 버튼 자체 클릭에 맡김
    e.preventDefault();
    if (q.answered) next(set); else submit(set);
    return;
  }
  if (!q || q.answered || inField || e.metaKey || e.ctrlKey || e.altKey) return;
  const n = parseInt(e.key, 10);
  if ((q.type === 'wordChoice' || q.type === 'choose') && n >= 1 && n <= q.choices.length) { q.sel = n - 1; renderLesson(set); }
  else if (q.type === 'build') {
    if (n >= 1 && n <= q.tiles.length) { const t = q.tiles[n - 1]; if (!q.placed.includes(t.k)) { q.placed.push(t.k); renderLesson(set); } }
    else if (e.key === 'Backspace' && q.placed.length) { q.placed.pop(); renderLesson(set); }
  }
});

document.addEventListener('click', e => {
  if (e.target.classList.contains('scrim')) { sheet = null; renderSheet(); return; }
  const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT') return;
  const act = b.dataset.act, set = curSet(), q = L && L.q;
  switch (act) {
    case 'settings': sheet = { kind: 'settings' }; renderSheet(); break;
    case 'close-sheet': sheet = null; renderSheet(); break;
    case 'opt': {
      const v = b.dataset.v; O[b.dataset.k] = isNaN(+v) ? v : +v; saveOpts();
      if (b.dataset.k === 'theme') applyTheme();
      render(); break;
    }
    case 'type': {
      const k = b.dataset.k; O.types[k] = !O.types[k];
      if (!TYPES.some(([t]) => O.types[t])) { O.types[k] = true; toast('최소 한 가지 유형은 켜 두어야 해요'); }
      saveOpts(); renderSheet(); break;
    }
    case 'reset':
      if (b.dataset.armed) { P.items = {}; P.days = {}; P.xp = 0; saveProg(); sheet = null; render(); toast('학습 기록을 지웠어요'); }
      else { b.dataset.armed = '1'; b.textContent = '한 번 더 누르면 모두 지워져요'; }
      break;
    case 'node': sheet = { kind: 'node', setId: set.id, nodeId: b.dataset.id }; renderSheet(); break;
    case 'start': { const s = sheet; sheet = null; L = null; go(`#/s/${encodeURIComponent(s.setId)}/${encodeURIComponent(s.nodeId)}`); break; }
    case 'ask-quit': if (L && (L.i > 0 || (q && q.answered))) { sheet = { kind: 'quit' }; renderSheet(); } else go('#/s/' + set.id); break;
    case 'quit': sheet = null; go('#/s/' + set.id); break;
    case 'say': speak(b.dataset.t); break;
    case 'pick': if (q && !q.answered) { q.sel = +b.dataset.i; if (q.type === 'wordChoice' && q.dir === 'ko2es' && O.speak) speak(speakable(q.choices[q.sel])); renderLesson(set); } break;
    case 'place': if (q && !q.answered) { q.placed.push(+b.dataset.k); if (O.speak) speak(q.tiles.find(t => t.k === +b.dataset.k).t); renderLesson(set); } break;
    case 'unplace': if (q && !q.answered) { q.placed.splice(+b.dataset.pos, 1); renderLesson(set); } break;
    case 'check': submit(set); break;
    case 'skip': submit(set, true); break;
    case 'next': next(set); break;
    case 'leave': go('#/s/' + set.id); break;
    case 'again': { const nid = L.nodeId; L = null; const node = prep(set).nodeById.get(nid); L = makeLesson(set, node); if (!L) go('#/s/' + set.id); else render(); window.scrollTo(0, 0); break; }
    case 'acc': {
      const inp = lastInput && document.body.contains(lastInput) ? lastInput : document.querySelector('.sent input, .typed');
      if (!inp || inp.disabled) break;
      const s = inp.selectionStart ?? inp.value.length, en = inp.selectionEnd ?? s;
      inp.value = inp.value.slice(0, s) + b.dataset.c + inp.value.slice(en);
      inp.setSelectionRange(s + 1, s + 1); inp.focus();
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      break;
    }
  }
});

render();
})();
