#!/usr/bin/env node
// data/sets/*.json 을 검사하고 data/bundle.js 로 묶습니다.
//   node scripts/build.js            검사 + bundle.js 생성
//   node scripts/build.js --check    검사만 (파일을 쓰지 않음)
//   node scripts/build.js --coverage 문장 속 단어 중 words 에 없는 것도 보고
// 오류가 하나라도 있으면 exit 1 — 이 경우 bundle.js 는 갱신되지 않습니다.
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const SETS_DIR = path.join(ROOT, 'data', 'sets');
const OUT = path.join(ROOT, 'data', 'bundle.js');
const args = new Set(process.argv.slice(2));

const COLORS = ['green', 'blue', 'purple', 'orange', 'red', 'teal', 'pink', 'gold'];
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const ITEM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const errors = [], warnings = [], infos = [];
const err = (f, m) => errors.push(`${f}: ${m}`);
const warn = (f, m) => warnings.push(`${f}: ${m}`);

// app.js 의 tokenize 와 같은 규칙
const tokenize = es => es.trim().split(/\s+/).map(raw => {
  const m = raw.match(/^([¿¡"«(]*)(.*?)([.,;:!?"»)]*)$/u) || ['', '', raw, ''];
  return m[2];
}).filter(Boolean);
const variants = es => es.split('/').map(v => v.trim()).filter(Boolean);
const isStr = v => typeof v === 'string' && v.trim() !== '';

function validate(file, d){
  const f = path.basename(file);
  const id = path.basename(file, '.json');
  if (!ID_RE.test(id)) err(f, `파일 이름(세트 id)은 소문자·숫자·하이픈만: "${id}"`);
  if (!d || typeof d !== 'object' || Array.isArray(d)) { err(f, '최상위는 객체여야 해요'); return null; }

  const known = ['title', 'description', 'level', 'icon', 'color', 'order', 'confusables', 'rules', 'sentences', 'words'];
  for (const k of Object.keys(d)) if (!known.includes(k)) warn(f, `알 수 없는 필드 "${k}" (무시됨)`);

  if (!isStr(d.title)) err(f, 'title(문자열)이 필요해요');
  if (d.description != null && typeof d.description !== 'string') err(f, 'description 은 문자열');
  if (d.color != null && !COLORS.includes(d.color)) err(f, `color 는 ${COLORS.join('|')} 중 하나`);
  if (d.order != null && typeof d.order !== 'number') err(f, 'order 는 숫자');

  const rules = d.rules || [], sentences = d.sentences || [], words = d.words || [];
  for (const [k, v] of [['rules', d.rules], ['sentences', d.sentences], ['words', d.words], ['confusables', d.confusables]])
    if (v != null && !Array.isArray(v)) err(f, `${k} 는 배열이어야 해요`);
  if (!sentences.length && !words.length) err(f, 'sentences 나 words 중 하나는 있어야 해요');

  const ids = new Map();
  const claim = (iid, where) => {
    if (!isStr(iid) || !ITEM_ID_RE.test(iid)) { err(f, `${where}: id 가 없거나 형식이 잘못됐어요 ("${iid}")`); return; }
    if (ids.has(iid)) err(f, `${where}: id "${iid}" 가 ${ids.get(iid)} 와 겹쳐요`);
    else ids.set(iid, where);
  };

  const ruleIds = new Set();
  rules.forEach((r, i) => {
    const w = `rules[${i}]`;
    if (!isStr(r.id) || !ID_RE.test(r.id)) err(f, `${w}: id 는 소문자·숫자·하이픈`);
    else if (ruleIds.has(r.id)) err(f, `${w}: rule id "${r.id}" 중복`);
    else ruleIds.add(r.id);
    if (!isStr(r.name)) err(f, `${w}: name 이 필요해요`);
    if (!isStr(r.tip)) warn(f, `${w}: tip(해설)이 없어요 — 오답 화면에 보여줄 설명을 넣어 주세요`);
  });

  const seenEs = new Map();
  sentences.forEach((s, i) => {
    const w = `sentences[${i}]`;
    claim(s.id, w);
    if (!isStr(s.es)) err(f, `${w}: es 가 필요해요`);
    if (!isStr(s.ko)) err(f, `${w}: ko 가 필요해요`);
    if (s.rule != null && !ruleIds.has(s.rule)) err(f, `${w}: rule "${s.rule}" 이 rules 에 없어요`);
    if (rules.length && s.rule == null) warn(f, `${w}: rule 이 없어요 ("기타 문장" 레슨으로 들어가요)`);
    if (s.alt != null && (!Array.isArray(s.alt) || !s.alt.every(isStr))) err(f, `${w}: alt 는 문자열 배열`);
    if (isStr(s.es)) {
      if (s.es.includes('/')) err(f, `${w}: 문장에 "/" 를 쓰지 마세요 — 다른 정답은 alt 배열로`);
      if (/\s{2,}/.test(s.es) || s.es !== s.es.trim()) warn(f, `${w}: 공백이 이상해요 "${s.es}"`);
      const key = s.es.toLowerCase();
      if (seenEs.has(key)) warn(f, `${w}: ${seenEs.get(key)} 와 같은 문장`);
      else seenEs.set(key, w);
      if (tokenize(s.es).length < 2) warn(f, `${w}: 단어가 1개뿐이라 문장 조립 문제가 쉬워요`);
    }
  });
  for (const r of ruleIds) if (!sentences.some(s => s.rule === r)) warn(f, `rule "${r}" 에 문장이 하나도 없어요`);

  const seenW = new Map();
  words.forEach((wd, i) => {
    const w = `words[${i}]`;
    claim(wd.id, w);
    if (!isStr(wd.es)) err(f, `${w}: es 가 필요해요`);
    if (!isStr(wd.ko)) err(f, `${w}: ko 가 필요해요`);
    if (isStr(wd.es)) {
      const key = wd.es.toLowerCase();
      if (seenW.has(key)) warn(f, `${w}: ${seenW.get(key)} 와 같은 단어`);
      else seenW.set(key, w);
    }
  });

  const conf = d.confusables || [];
  const confSeen = new Set();
  conf.forEach((g, i) => {
    if (!Array.isArray(g) || g.length < 2 || !g.every(isStr)) { err(f, `confusables[${i}]: 2개 이상 문자열 배열`); return; }
    g.forEach(x => {
      const k = x.toLowerCase();
      if (k.includes(' ')) err(f, `confusables[${i}]: "${x}" — 한 단어만 가능해요`);
      if (confSeen.has(k)) warn(f, `confusables: "${x}" 가 여러 그룹에 있어요 (첫 그룹만 쓰여요)`);
      confSeen.add(k);
    });
  });
  if (sentences.length && conf.length) {
    const hit = sentences.filter(s => isStr(s.es) && tokenize(s.es).some(t => confSeen.has(t.toLowerCase()))).length;
    if (hit < sentences.length / 2) warn(f, `confusables 가 들어간 문장이 ${hit}/${sentences.length}개뿐이에요`);
  }

  if (args.has('--coverage') && sentences.length) {
    const vocab = new Set(words.flatMap(w => isStr(w.es) ? variants(w.es).map(v => v.toLowerCase()) : []));
    const miss = new Set();
    sentences.forEach(s => isStr(s.es) && tokenize(s.es).forEach((t, i) => {
      if (i > 0 && t[0] !== t[0].toLowerCase()) return; // 문장 중간의 고유명사
      if (!vocab.has(t.toLowerCase())) miss.add(t.toLowerCase());
    }));
    if (miss.size) infos.push(`${f}: words 에 없는 문장 속 단어 ${miss.size}개 — ${[...miss].join(', ')}`);
  }

  return {
    id, title: d.title, description: d.description || '', level: d.level || '', icon: d.icon || '',
    color: d.color || 'green', order: d.order ?? 100,
    confusables: conf, rules, sentences, words,
  };
}

if (!fs.existsSync(SETS_DIR)) { console.error('data/sets 폴더가 없어요'); process.exit(1); }
const files = fs.readdirSync(SETS_DIR).filter(n => n.endsWith('.json') && !n.startsWith('_')).sort();
const sets = [];
for (const n of files) {
  const file = path.join(SETS_DIR, n);
  let d;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { err(n, 'JSON 파싱 실패 — ' + e.message); continue; }
  const s = validate(file, d);
  if (s) sets.push(s);
}
sets.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

for (const m of infos) console.log('ℹ︎ ' + m);
for (const m of warnings) console.log('⚠︎ ' + m);
for (const m of errors) console.log('✖ ' + m);
if (errors.length) { console.log(`\n오류 ${errors.length}개 — bundle.js 를 만들지 않았어요.`); process.exit(1); }

const summary = sets.map(s => `${s.id}(문장 ${s.sentences.length}, 단어 ${s.words.length})`).join(', ');
if (args.has('--check')) { console.log(`✓ 검사 통과: ${summary}`); process.exit(0); }
fs.writeFileSync(OUT,
  '// 자동 생성 파일 — 직접 고치지 마세요. data/sets/*.json 수정 후 `node scripts/build.js`\n' +
  'window.REPASO_DATA = ' + JSON.stringify({ sets }) + ';\n');
console.log(`✓ data/bundle.js 생성: ${summary}`);
