// タスクの読み書きと購読。画面側はこのファイルの関数だけを使う（Firestore を直接触らない）。
//
// タスクの形（設計書 5章）：
// { id, title, status: 'todo'|'doing'|'waiting'|'done', doDate, dueDate, area, project,
//   phase, priority, memo, order, createdAt, updatedAt, completedAt }
// 日付は 'YYYY-MM-DD' か null。createdAt などは ミリ秒の数値（端末の時計）。
// phase：プロジェクトの中のフェーズ（1以上の整数）か null。プロジェクトが無いタスクは null。
// order：同じ日・区分の中の手動の順番（数。小さいほど上）。無い古いタスクは createdAt を使って並べる（views/sort.js）。
//   引きずって並べ替えた時は、前後の order の中間を1件だけ書く。
// （古いタスクに size が残っていることがあるが、画面には出さない。書き換えもしない）
// deletedAt：ゴミ箱に入れた時刻（ミリ秒）。あるタスクは getTasks／subscribe に出さない（getTrash だけに出す）。
//   起動時に、30日より前に消したものを完全に消す（1回の起動で PURGE_MAX 件まで）。
// repeat：繰り返し（js/repeat.js）。完了にした時、次の回のタスクを新しく作り、その id を completedNextId に覚える。
//   次の回は必ず今日以降。文書の番号は「根＋'_'＋次のやる日」に決めるので、同じ回は二重にできない
//   （根＝id の末尾の '_YYYY-MM-DD' を外したもの。回を重ねても番号が伸びない。Firestore の番号は1500バイトまで）
//   （完了→戻す→完了を繰り返しても、2台から同時に完了しても1件。あれば作らず、ゴミ箱にあれば戻す）。
//   完了を戻した時、次の回が一度も触られていなければ（createdAt＝updatedAt）完全に消し、未着手で触られていればゴミ箱へ。
//
// プロジェクトの一覧（決定/0007）：users/{uid}/projects/{文書の番号} に { name, phases, updatedAt }。
// 文書の番号は encodeURIComponent(名前)（「大学/ゼミ」の / がパスの区切りにならないように。「.」も %2E に）。
// 文書が無いプロジェクトはフェーズ5つとして扱う。「＋ プロジェクトを追加」でタスクが0件でも文書を作る（その名前も一覧に出す）。
//
// 用途の一覧：users/{uid}/meta/areas に { list: [{ name, color }], projectOrder: [名前], updatedAt }。文書が無ければ constants.AREAS の6つ。
//   list の並び＝用途の並び。projectOrder＝左の一覧で引きずって決めたプロジェクトの順（別の文書にせず、読み込みを1つ増やさない）。
//
// リンク集：users/{uid}/links/{自動の番号} に { area（null＝用途なし）, name, url, createdAt, updatedAt }。
// 1件1文書にしている（一覧を1つの文書にまとめると、2台で同時に足した・消した時に片方が消えるため）。
//
// ?demo=1 で開くと、ログインせずにメモリ上の見本データで動く（画面の確認用）。
import { todayKey, addDays, weekStart } from './dates.js';
import { normRepeat, nextDate, daysBetween } from './repeat.js';
import { AREAS, AREA_KEYS, AREA_HEX, SPARE_COLORS } from './constants.js';

const isDemo = new URLSearchParams(location.search).has('demo');

let backend = null;
let listeners = [];
let allTasks = []; // ゴミ箱の中も含む全部
let tasks = []; // ゴミ箱の中を除いたもの（画面に渡す）
let projects = new Map(); // プロジェクト名 → { phases, updatedAt }
let areaList = null; // 用途の一覧（null＝文書なし。決まった6つとして扱う）
let links = []; // リンク集（足した順）
let projectOrder = []; // 左の一覧で引きずって決めたプロジェクトの順（meta/areas の projectOrder）
let linkAreaOrder = []; // リンク集の用途の塊の順（meta/areas の linkAreaOrder。'' は用途なし）。左の一覧の用途の順とは別

export const DEFAULT_PHASES = 5;
const TRASH_DAYS = 30;
const PURGE_MAX = 200; // 起動時に完全に消す最大数（書き込みが一度に多くならないように）
const BATCH_MAX = 500; // Firestore の writeBatch 1回の上限

function setAll(list) {
  allTasks = list;
  tasks = list.filter((x) => !x.deletedAt);
}

// ---- 元に戻す・やり直す（履歴） ----
// 変えるたびに「戻し方」を積み、undo() で新しいものから1つずつ戻す（右上のボタン・Ctrl+Z・お知らせの「元に戻す」）。
// 戻した操作は redo() でやり直せる（右上のボタン・Ctrl+Shift+Z・Ctrl+Y）。新しく何か変えたら、やり直しの分は消える。
// 保存ボタンは作らない（変えた瞬間に保存する作りのまま。押し忘れで消えるのを防ぐため）。
// 戻し方は待たずに呼ぶ（Firestore はオフラインだと Promise が終わらないが、端末内にはすぐ入る）。
// 1つの操作で何件も書く時（引きずって並べ替える等）は group() でまとめて1回分にする。
// 戻す・やり直す最中の書き込みは collect に集め、それが反対向きの1回分になる
const HISTORY_MAX = 30;
let history = [];
let redoStack = [];
let txn = null; // group() の中で集めている戻し方
let collect = null; // 戻す・やり直すの最中に集めている反対向きの戻し方
let muted = 0; // quiet() の中（積まない・集めない）
let historyListeners = [];
const notifyHistory = () => { for (const cb of historyListeners) cb(); };
function record(fn) {
  if (muted) return null;
  if (collect) { collect.push(fn); return null; }
  if (txn) { txn.push(fn); return null; }
  redoStack = [];
  return pushEntry({ fns: [fn] });
}
function pushEntry(e) {
  history = [...history, e].slice(-HISTORY_MAX);
  notifyHistory();
  return e;
}
export function group(label, fn) {
  if (collect || muted) return fn();
  const outer = txn;
  if (!outer) txn = [];
  try { return fn(); } finally {
    if (!outer) {
      const fns = txn;
      txn = null;
      if (fns.length) { redoStack = []; pushEntry({ fns }); }
    }
  }
}
// 今いちばん新しい履歴（お知らせの「元に戻す」が、その操作の分だけを戻すために持つ）
export function lastHistory() { return history[history.length - 1] || null; }
export function canUndo() { return history.length > 0; }
export function canRedo() { return redoStack.length > 0; }
export function onHistory(cb) { historyListeners.push(cb); }
function run(fns) {
  for (const f of [...fns].reverse()) {
    try { const r = f(); r?.catch?.((err) => console.warn('[task-board] 戻せませんでした', err)); } catch (err) { console.warn('[task-board] 戻せませんでした', err); }
  }
}
// entry を指定しなければ一番新しいもの。戻したら true
export function undo(entry) {
  const e = entry || history[history.length - 1];
  if (!e || !history.includes(e)) return false;
  history = history.filter((x) => x !== e);
  collect = [];
  try { run(e.fns); } finally {
    const back = collect;
    collect = null;
    // 消す系（again がある）は、やり直す＝もう一度消す
    redoStack = [...redoStack, e.again ? { fns: [e.again], again: e.again } : { fns: back }];
  }
  notifyHistory();
  return true;
}
export function redo() {
  const e = redoStack[redoStack.length - 1];
  if (!e) return false;
  redoStack = redoStack.slice(0, -1);
  collect = [];
  try { run(e.fns); } finally {
    const back = collect;
    collect = null;
    pushEntry(e.again ? { fns: back, again: e.again } : { fns: back });
  }
  return true;
}
// 履歴に積まずに書く（消す系の関数が、自分の戻し方を1つだけ積むため）
function quiet(fn) {
  muted++;
  try { return fn(); } finally { muted--; }
}

function emit() {
  for (const cb of listeners) cb(tasks);
}

// 画面側：store.subscribe((tasks) => …) でタスク全件を受け取る。変更のたびに呼ばれる
export function subscribe(cb) {
  listeners.push(cb);
  cb(tasks);
  return () => { listeners = listeners.filter((l) => l !== cb); };
}

export function getTasks() {
  return tasks;
}

// ゴミ箱の中（新しく消した順）
export function getTrash() {
  return allTasks.filter((x) => x.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
}

// プロジェクトのフェーズの数（文書が無ければ5）
export function getPhases(project) {
  const n = projects.get(project)?.phases;
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_PHASES;
}

// ---- WBS（プロジェクトの中のタスクの親子。親・子・孫の3段まで） ----
// タスクの parent に親のタスクの id。親がゴミ箱・別のプロジェクト・見つからない時は、いちばん上の段として扱う。
// 大項目（企画・開発など）も別の項目を作らずタスクとして持つ（2026-11-08 オーナー：案A）
export const WBS_MAX = 3;
function liveParent(x, byId) {
  const p = x.parent ? byId.get(x.parent) : null;
  return p && !p.deletedAt && p.project === x.project ? p : null;
}
// プロジェクトの木：[{ task, level: 1..3, kids: [...] }]（並びは order）
export function wbsTree(project) {
  const list = tasks.filter((x) => x.project === project);
  const byId = new Map(list.map((x) => [x.id, x]));
  const kids = new Map();
  const roots = [];
  for (const x of list) {
    const p = liveParent(x, byId);
    if (p) { if (!kids.has(p.id)) kids.set(p.id, []); kids.get(p.id).push(x); } else roots.push(x);
  }
  const ord = (a, b) => ((a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0));
  const build = (x, level) => ({ task: x, level, kids: level >= WBS_MAX ? [] : (kids.get(x.id) || []).sort(ord).map((c) => build(c, level + 1)) });
  return roots.sort(ord).map((x) => build(x, 1));
}
// 子を持つタスクか（親になっているもの。スプリントの箱には入れず、WBSの見出しとして扱う）
export function hasChildren(id) {
  return tasks.some((x) => x.parent === id && !x.deletedAt);
}
// 何段目か（1〜3）
export function wbsLevel(id) {
  const byId = new Map(tasks.map((x) => [x.id, x]));
  let n = 1;
  let x = byId.get(id);
  while (x && n <= WBS_MAX) { const p = liveParent(x, byId); if (!p) break; n++; x = p; }
  return n;
}
// 親の名前を上から（例：['企画','要件定義']）
export function parentPath(id) {
  const byId = new Map(tasks.map((x) => [x.id, x]));
  const out = [];
  let x = byId.get(id);
  for (let i = 0; i < WBS_MAX && x; i++) { const p = liveParent(x, byId); if (!p) break; out.unshift(p.title); x = p; }
  return out;
}
// 親にできるタスク（同じプロジェクト・2段目まで・自分と自分の下は除く）
export function parentChoices(project, selfId = null) {
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.task.id === selfId) continue; // 自分と自分の下は選べない
      if (n.level < WBS_MAX) out.push({ id: n.task.id, title: n.task.title, level: n.level });
      walk(n.kids);
    }
  };
  walk(wbsTree(project));
  // 自分の下の段を親にすると、段が深くなりすぎる・輪になるので、選んだ親の段＋自分の下の深さが3を超えるものも除く
  if (!selfId) return out;
  const depth = (id) => { const k = tasks.filter((x) => x.parent === id && !x.deletedAt); return k.length ? 1 + Math.max(...k.map((c) => depth(c.id))) : 0; };
  const d = depth(selfId);
  return out.filter((c) => c.level + 1 + d <= WBS_MAX);
}

// ---- スプリント（プロジェクトの中の期間） ----
// プロジェクトの文書の sprints に [{ id, name, start: 'YYYY-MM-DD', days }]。タスクは sprint に id を持つ（null＝バックログ）。
// 期間が終わったスプリントの未完了は、まだ終わっていない次のスプリントへ自動で移す（carryOver。無ければ同じ長さで作る）。
// 移したタスクには carried: true を付け、「持ち越し」の印を出す（手で動かしたら外す）
export const SPRINT_LENGTHS = [{ days: 7, label: '1週間' }, { days: 14, label: '2週間' }, { days: 28, label: '4週間' }];
const sprintEnd = (s) => addDays(s.start, s.days); // 終わりの翌日（この日から次）
export function getSprints(project) {
  const list = projects.get(project)?.sprints || [];
  return list.filter((s) => s && s.id && s.start).slice().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}
export function sprintOf(project, id) { return getSprints(project).find((s) => s.id === id) || null; }
// 今日を含むスプリント（無ければ null）
export function currentSprint(project) {
  const t = todayKey();
  return getSprints(project).find((s) => s.start <= t && t < sprintEnd(s)) || null;
}
export function sprintState(s) {
  const t = todayKey();
  return t < s.start ? 'future' : t < sprintEnd(s) ? 'now' : 'past';
}
function writeSprints(project, list) {
  const cur = projects.get(project) || {};
  projects = new Map(projects).set(project, { ...cur, sprints: list });
  emit();
  return backend.setProject(project, { name: project, sprints: list, updatedAt: Date.now() });
}
function newSprint(list, days) {
  const last = list[list.length - 1];
  const t = todayKey();
  // 続きは前のスプリントの次の日から。前が無い・もう過ぎている時は今週の月曜から
  const start = last && sprintEnd(last) > weekStart(t) ? sprintEnd(last) : weekStart(t);
  const n = list.length + 1;
  return { id: `sp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: `スプリント${n}`, start, days };
}
export function addSprint(project, days = 7) {
  const before = getSprints(project);
  const s = newSprint(before, days);
  record(() => writeSprints(project, before));
  writeSprints(project, [...before, s]);
  return s;
}
export function updateSprint(project, id, patch) {
  const before = getSprints(project);
  record(() => writeSprints(project, before));
  const clean = {};
  const name = typeof patch.name === 'string' ? patch.name.trim().slice(0, 30) : '';
  if (name) clean.name = name; // 空にした時は名前を変えない
  if (typeof patch.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(patch.start)) clean.start = patch.start;
  if (Number.isInteger(patch.days) && patch.days >= 1 && patch.days <= 90) clean.days = patch.days;
  return writeSprints(project, before.map((s) => (s.id === id ? { ...s, ...clean } : s)));
}
// 後ろのスプリントもまとめてずらす（タイムラインで使う）
export function shiftSprints(project, id, deltaDays, chain = true) {
  const before = getSprints(project);
  const i = before.findIndex((s) => s.id === id);
  if (i < 0 || !deltaDays) return null;
  record(() => writeSprints(project, before));
  return writeSprints(project, before.map((s, j) => (j === i || (chain && j > i) ? { ...s, start: addDays(s.start, deltaDays) } : s)));
}
// スプリントを消す：中のタスクはバックログへ（タスクは消さない）
export function deleteSprint(project, id) {
  const before = getSprints(project);
  const inside = allTasks.filter((x) => x.project === project && x.sprint === id);
  return group('deleteSprint', () => {
    record(() => writeSprints(project, before));
    updateMany(inside.map((x) => ({ id: x.id, patch: { sprint: null, carried: false } })));
    writeSprints(project, before.filter((s) => s.id !== id));
    return inside.length;
  });
}
// 期間が終わったスプリントの未完了を、次のスプリントへ移す。移した件数と、元に戻すための履歴を返す
export function carryOver() {
  const moves = [];
  let made = 0;
  group('carry', () => {
    for (const name of projectNames()) {
      let list = getSprints(name);
      if (!list.length) continue;
      const ended = list.filter((s) => sprintState(s) === 'past');
      const left = allTasks.filter((x) => !x.deletedAt && x.project === name && x.status !== 'done' && ended.some((s) => s.id === x.sprint));
      if (!left.length) continue;
      let target = list.find((s) => sprintState(s) !== 'past');
      if (!target) {
        target = newSprint(list, list[list.length - 1].days || 7);
        record(() => writeSprints(name, list));
        writeSprints(name, [...list, target]);
        made++;
      }
      updateMany(left.map((x) => ({ id: x.id, patch: { sprint: target.id, carried: true } })));
      moves.push({ project: name, count: left.length, to: target.name });
    }
  });
  return { moves, made, entry: moves.length ? lastHistory() : null };
}

// フェーズの名前（名前を付けていなければ「フェーズN」）
export function phaseName(project, n) {
  const v = projects.get(project)?.phaseNames?.[n];
  return typeof v === 'string' && v.trim() ? v : `フェーズ${n}`;
}

// フェーズの名前を変える。空にすると「フェーズN」に戻る。
// phaseNames は { 番号: 名前 } で持つ（merge で1つだけ書けるように。並びは番号のまま）
export function renamePhase(project, n, raw) {
  const name = String(raw || '').trim().slice(0, 30);
  const cur = projects.get(project) || {};
  const old = cur.phaseNames?.[n] || '';
  record(() => renamePhase(project, n, old));
  const phaseNames = { ...(cur.phaseNames || {}), [n]: name };
  projects = new Map(projects).set(project, { ...cur, phaseNames });
  emit();
  return backend.setProject(project, { name: project, phaseNames: { [n]: name }, updatedAt: Date.now() });
}

// フェーズを1つ足して保存する（待たなくてよい。端末内にはすぐ入る）
export async function addPhase(project) {
  const name = project ? String(project).trim() : '';
  if (!name) throw new Error('プロジェクトがありません');
  const phases = getPhases(name) + 1;
  projects = new Map(projects).set(name, { ...projects.get(name), phases });
  emit();
  return backend.setProject(name, { name, phases, updatedAt: Date.now() });
}

// 用途の一覧 [{ name, color }]
export function getAreas() {
  return areaList || AREAS.map((name) => ({ name, color: AREA_HEX[name] }));
}
export function areaNames() {
  return getAreas().map((a) => a.name);
}
// 用途の点の色（CSS の色）。決まった6つは --cat-*（ダークで変わる）、足した用途は保存した色
export function areaColor(name) {
  if (AREA_KEYS[name]) return `var(--cat-${AREA_KEYS[name]})`;
  return getAreas().find((a) => a.name === name)?.color || null;
}

// 用途を足す（同じ名前は足さない）。色は予備の色のうち、まだ使っていないものから順に。
// 名前がおかしい時はその場で Error を投げる（画面がすぐ出せるように async にしない）。書き込みの Promise を返す
export function addArea(raw) {
  const name = String(raw || '').trim();
  if (!name) throw new Error('名前を入れてください');
  if (name.length > 20) throw new Error('20文字までにしてください');
  const list = getAreas();
  if (list.some((a) => a.name === name)) throw new Error('同じ名前の用途があります');
  const used = new Set(list.map((a) => a.color));
  const extra = list.length - AREAS.length;
  const color = SPARE_COLORS.find((c) => !used.has(c)) || SPARE_COLORS[Math.max(0, extra) % SPARE_COLORS.length];
  const item = { name, color };
  // 文書がまだ無い時は、決まった6つも一緒に入れる（同じ形の要素は arrayUnion が重ねない）
  const add = areaList ? [item] : [...list, item];
  areaList = [...list, item];
  emit();
  return backend.addAreas(add);
}

// ---- バックアップ ----
// 端末に書き出す中身。ゴミ箱の中のタスクも入れる（ゴミ箱から戻したくなった時のため）。id も残す
export function exportData() {
  return {
    app: 'task-board',
    format: 1,
    exportedAt: new Date().toISOString(),
    tasks: allTasks,
    projects: [...projects.entries()].map(([name, x]) => ({ name, ...x })),
    areas: getAreas(),
    links,
  };
}

// バックアップのファイル（exportData の形）を読み込む。
// 同じ id のタスク・リンクは上書きし、ファイルに無いものは消さない（足し合わせる）。用途は名前で重ならないように足す。
// 履歴（元に戻す）には積まない（件数が多く、戻すより読み込み直す方が確か）。読み込んだ件数を返す
export function checkBackup(data) {
  if (!data || data.app !== 'task-board' || !Array.isArray(data.tasks)) throw new Error('task-board のバックアップのファイルではありません');
  return {
    tasks: data.tasks.filter((t) => t && typeof t.id === 'string' && typeof t.title === 'string').length,
    trash: data.tasks.filter((t) => t && typeof t.id === 'string' && t.deletedAt).length,
    links: Array.isArray(data.links) ? data.links.length : 0,
    projects: Array.isArray(data.projects) ? data.projects.length : 0,
    exportedAt: data.exportedAt || '',
  };
}
export function importData(data) {
  checkBackup(data);
  const tasksIn = data.tasks.filter((t) => t && typeof t.id === 'string' && typeof t.title === 'string');
  const ops = tasksIn.map(({ id, ...rest }) => ({ type: 'set', id, data: rest }));
  const writes = [backend.batch(ops)];
  for (const p of Array.isArray(data.projects) ? data.projects : []) {
    if (!p || typeof p.name !== 'string' || !p.name) continue;
    const { name, ...rest } = p;
    projects = new Map(projects).set(name, { ...(projects.get(name) || {}), ...rest });
    writes.push(backend.setProject(name, { name, ...rest }));
  }
  if (Array.isArray(data.areas)) {
    const have = new Set(getAreas().map((a) => a.name));
    const add = data.areas.filter((a) => a && typeof a.name === 'string' && !have.has(a.name)).map((a) => ({ name: a.name, color: a.color || null }));
    if (add.length) { areaList = [...getAreas(), ...add]; writes.push(backend.setMeta({ list: areaList })); }
  }
  const linksIn = Array.isArray(data.links) ? data.links.filter((l) => l && typeof l.id === 'string' && typeof l.url === 'string') : [];
  for (const { id, ...rest } of linksIn) writes.push(backend.setLink(id, rest));
  const byId = new Map(links.map((x) => [x.id, x]));
  for (const l of linksIn) byId.set(l.id, l);
  setLinks([...byId.values()]);
  emit();
  return { tasks: tasksIn.length, links: linksIn.length, done: Promise.all(writes) };
}

// ---- リンク集 ----
export function getLinks() {
  return links;
}

// 入れたURLを確かめて整える。「manaba.cit.ac.jp」のように https:// が無ければ付ける。
// http・https 以外（javascript: など）は、押した時に危ないので断る
export function normUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) throw new Error('URLを入れてください');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { throw new Error('URLの形になっていません'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('http か https で始まるURLにしてください');
  if (!u.hostname.includes('.') && u.hostname !== 'localhost') throw new Error('URLの形になっていません');
  return u.href;
}

// 用途は選ばなくてもよい（null＝用途なし。画面では一番下にまとめる）
function linkFields({ area, name, url }) {
  const a = String(area || '').trim();
  const n = String(name || '').trim();
  if (n.length > 40) throw new Error('名前は40文字までにしてください');
  return { area: a || null, name: n, url: normUrl(url) };
}

// 足す。おかしい時はその場で Error を投げる（addArea と同じ）。書き込みの Promise を返す
export function addLink(raw) {
  const now = Date.now();
  const data = { ...linkFields(raw), createdAt: now, updatedAt: now };
  return backend.addLink(data);
}

export function updateLink(id, raw) {
  const data = { ...linkFields(raw), updatedAt: Date.now() };
  return backend.updateLink(id, data);
}

export function deleteLink(id) {
  return backend.deleteLink(id);
}

// 並びは order（引きずって決めた順。0,1,2…）→ 無ければ足した時刻。order の無いもの（後から足したもの）は下に出る
const linkKey = (x) => (Number.isFinite(x.order) ? x.order : (x.createdAt || 0));
function setLinks(list) {
  links = list.slice().sort((a, b) => linkKey(a) - linkKey(b));
}

// リンクを引きずって並べ替えた時。ids＝落とした用途の中の新しい順。area＝その用途（null＝用途なし）。
// 別の用途から来たリンクは用途も書き換える。順番が変わったものだけ書く
export function reorderLinks(area, ids) {
  const byId = new Map(links.map((x) => [x.id, x]));
  const writes = [];
  ids.forEach((id, i) => {
    const x = byId.get(id);
    if (!x) return;
    const patch = {};
    if (x.order !== i) patch.order = i;
    if ((x.area || null) !== area) patch.area = area;
    if (Object.keys(patch).length) writes.push([id, patch]);
  });
  if (!writes.length) return Promise.resolve();
  const back = writes.map(([id]) => [id, { order: byId.get(id).order ?? null, area: byId.get(id).area || null }]);
  record(() => {
    const m = new Map(back);
    setLinks(links.map((x) => (m.has(x.id) ? { ...x, ...m.get(x.id) } : x)));
    emit();
    return Promise.all(back.map(([id, patch]) => backend.updateLink(id, { ...patch, updatedAt: Date.now() })));
  });
  const map = new Map(writes);
  setLinks(links.map((x) => (map.has(x.id) ? { ...x, ...map.get(x.id) } : x)));
  emit();
  return Promise.all(writes.map(([id, patch]) => backend.updateLink(id, { ...patch, updatedAt: Date.now() })));
}

// プロジェクトを作る（タスク0件でも一覧に出す）。同じ名前は作らない。addArea と同じくその場で Error を投げる
export function addProject(raw) {
  const name = String(raw || '').trim();
  if (!name) throw new Error('名前を入れてください');
  if (projectNames().includes(name)) throw new Error('同じ名前のプロジェクトがあります');
  const now = Date.now();
  projects = new Map(projects).set(name, { phases: DEFAULT_PHASES, updatedAt: now });
  emit();
  return backend.setProject(name, { name, phases: DEFAULT_PHASES, updatedAt: now });
}

// Firestore の文書の番号（名前の / や . をそのまま使えないため）
export function projectDocId(name) {
  return encodeURIComponent(name).replace(/\./g, '%2E');
}

// フェーズの値をそろえる：1以上の整数だけ。ほかは null
function toPhase(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  if (!/^\d+$/.test(String(v).trim())) return null;
  const n = Number(v);
  return n >= 1 ? n : null;
}

// 一覧に出すプロジェクト名（触った順・新しい順）。タスクの project に加えて、projects の文書の名前も（タスク0件でも出す）
export function projectNames() {
  const last = new Map(); // 名前 → 最後に触った時刻
  for (const t of tasks) {
    if (t.project) last.set(t.project, Math.max(last.get(t.project) || 0, t.updatedAt || 0));
  }
  for (const [name, p] of projects) {
    if (name) last.set(name, Math.max(last.get(name) || 0, p.updatedAt || 0));
  }
  const recent = [...last.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  if (!projectOrder.length) return recent;
  // 並べ替えた後に増えたプロジェクトは上に出す（左の一覧は上から数件だけなので、下に回すと見えなくなる）
  const ranked = new Set(projectOrder);
  return [...recent.filter((n) => !ranked.has(n)), ...projectOrder.filter((n) => last.has(n))];
}

// 左の一覧で引きずって並べ替えた時。names は新しい順の名前
export function reorderAreas(names) {
  const prev = areaNames();
  record(() => reorderAreas(prev));
  const byName = new Map(getAreas().map((a) => [a.name, a]));
  const list = names.filter((n) => byName.has(n)).map((n) => byName.get(n));
  for (const a of getAreas()) if (!names.includes(a.name)) list.push(a);
  areaList = list;
  emit();
  return backend.setMeta({ list });
}
// リンク集の用途の塊の順。keys は '' ＝用途なし
export function getLinkAreaOrder() { return linkAreaOrder; }
export function reorderLinkAreas(keys) {
  const prev = linkAreaOrder;
  record(() => reorderLinkAreas(prev));
  linkAreaOrder = [...keys];
  emit();
  return backend.setMeta({ linkAreaOrder });
}

export function reorderProjects(names) {
  const prev = projectOrder.length ? projectOrder : projectNames();
  record(() => reorderProjects(prev));
  projectOrder = [...names];
  emit();
  return backend.setMeta({ projectOrder });
}

function normalize(data) {
  const now = Date.now();
  const project = data.project ? String(data.project).trim() : null;
  return {
    title: (data.title || '').trim(),
    status: data.status || 'todo',
    doDate: data.doDate || null,
    dueDate: data.dueDate || null,
    area: data.area || null,
    project,
    phase: project ? toPhase(data.phase) : null,
    sprint: project && data.sprint ? String(data.sprint) : null,
    parent: project && data.parent ? String(data.parent) : null,
    priority: data.priority || null,
    memo: data.memo || '',
    repeat: normRepeat(data.repeat),
    order: typeof data.order === 'number' && Number.isFinite(data.order) ? data.order : now,
    createdAt: now,
    updatedAt: now,
    completedAt: data.status === 'done' ? now : null,
  };
}

export async function addTask(data) {
  const t = normalize(data);
  if (!t.title) throw new Error('タスク名が空です');
  return backend.add(t);
}

export async function updateTask(id, patch) {
  const before = allTasks.find((x) => x.id === id);
  if (before) {
    const back = {};
    for (const k of Object.keys(patch)) if (k !== 'updatedAt') back[k] = before[k] ?? null;
    record(() => updateTask(id, back));
  }
  const p = { ...patch, updatedAt: Date.now() };
  if ('status' in patch) p.completedAt = patch.status === 'done' ? Date.now() : null;
  if ('project' in patch) p.project = patch.project ? String(patch.project).trim() : null;
  if ('phase' in patch) p.phase = toPhase(patch.phase);
  if ('order' in patch && !(typeof patch.order === 'number' && Number.isFinite(patch.order))) delete p.order;
  if ('project' in patch && !p.project) p.phase = null; // プロジェクトを外したらフェーズも外す
  // プロジェクトが変わったらスプリントも外す（スプリントはプロジェクトごと）
  if ('project' in patch && !('sprint' in patch)) {
    const was = allTasks.find((x) => x.id === id);
    if (!was || (was.project || null) !== p.project) p.sprint = null;
  }
  // プロジェクトが変わったら親も外す（親子は同じプロジェクトの中だけ）
  if ('project' in patch && !('parent' in patch)) {
    const was = allTasks.find((x) => x.id === id);
    if (!was || (was.project || null) !== p.project) p.parent = null;
  }
  if ('repeat' in patch) p.repeat = normRepeat(patch.repeat);

  // 繰り返し：完了にした時に次の回を作る／完了を戻した時に未着手の次の回をゴミ箱へ
  const cur = allTasks.find((x) => x.id === id);
  const ops = [];
  if (cur && 'status' in patch) {
    const wasDone = cur.status === 'done';
    const nowDone = patch.status === 'done';
    const rep = 'repeat' in patch ? p.repeat : normRepeat(cur.repeat);
    if (!wasDone && nowDone && rep) {
      const next = nextOf({ ...cur, ...p }, rep);
      const nid = `${repeatRoot(id)}_${next.doDate}`;
      const have = allTasks.find((x) => x.id === nid);
      if (!have) ops.push({ type: 'set', id: nid, data: next });
      else if (have.deletedAt) ops.push({ type: 'update', id: nid, data: { deletedAt: null, updatedAt: Date.now() } });
      p.completedNextId = nid;
    } else if (wasDone && !nowDone && cur.completedNextId) {
      const nx = allTasks.find((x) => x.id === cur.completedNextId);
      if (nx && !nx.deletedAt && (nx.status || 'todo') === 'todo') {
        const untouched = nx.createdAt && nx.createdAt === nx.updatedAt;
        ops.push(untouched
          ? { type: 'delete', id: nx.id }
          : { type: 'update', id: nx.id, data: { deletedAt: Date.now(), updatedAt: Date.now() } });
      }
      p.completedNextId = null;
    }
  }
  if (!ops.length) return backend.update(id, p);
  ops.push({ type: 'update', id, data: p });
  return backend.batch(ops);
}

// 繰り返しの根：id の末尾に付けた日付（_YYYY-MM-DD、重なっていても全部）を外したもの
export function repeatRoot(id) {
  return String(id).replace(/(_\d{4}-\d{2}-\d{2})+$/, '');
}

// 次の回：同じ名前・分類・内容・繰り返しで、やる日を次の日に。締切があれば同じ日数だけずらす（やる日と締切の差を保つ）。
// やる日が無ければ今日を基準にする。計算した日が今日より前なら、規則どおり進めて今日以降の最初の回にする（今日を含む）
function nextOf(t, rep) {
  const today = todayKey();
  const base = t.doDate || today;
  let doDate = nextDate(rep, base);
  if (doDate < today) doDate = nextDate(rep, addDays(today, -1));
  const shift = daysBetween(base, doDate);
  return normalize({
    title: t.title,
    area: t.area,
    project: t.project,
    phase: t.phase,
    priority: t.priority,
    memo: t.memo,
    repeat: rep,
    doDate,
    dueDate: t.dueDate ? addDays(t.dueDate, shift) : null,
  });
}

// 削除＝ゴミ箱へ（文書は消さず deletedAt を付ける）
export async function deleteTask(id) {
  record(() => restoreTask(id));
  return backend.update(id, { deletedAt: Date.now(), updatedAt: Date.now() });
}

// ゴミ箱から戻す
export async function restoreTask(id) {
  record(() => deleteTask(id));
  return backend.update(id, { deletedAt: null, updatedAt: Date.now() });
}

// 完全に消す（ゴミ箱の「完全に消す」と、起動時の30日の掃除）
export async function purgeTask(id) {
  return backend.batch([{ type: 'delete', id }]);
}

// 何件もまとめて書き換える。entries = [{ id, patch }]。Firestore は writeBatch で BATCH_MAX 件ごとに分ける。
// 端末内にはすぐ入る（オフラインだと Promise は終わらないので、画面は待たない）
// ---- 分類（フェーズ・用途・プロジェクト）を消す ----
// 中のタスクは消さず、その分類を外す（プロジェクトだけは「タスクもゴミ箱へ」も選べる）。
// どれも「元に戻す」のための関数を返す（呼ぶと消す前の形に書き戻す）

// フェーズ n を消す：n のタスクはフェーズなし、n より後ろのフェーズは1つずつ前へ詰める（名前も一緒に）
export function deletePhase(project, n) {
  const r = quiet(() => deletePhaseRaw(project, n));
  r.entry = record(() => quiet(() => r.undo()));
  if (r.entry) r.entry.again = () => deletePhase(project, n);
  return r;
}
function deletePhaseRaw(project, n) {
  const cur = projects.get(project) || {};
  const count = getPhases(project);
  const inside = allTasks.filter((x) => x.project === project && Number.isInteger(x.phase) && x.phase >= n);
  const before = inside.map((x) => ({ id: x.id, patch: { phase: x.phase } }));
  const oldNames = {};
  const newNames = {};
  for (let i = 1; i <= count + 1; i++) {
    oldNames[i] = cur.phaseNames?.[i] || '';
    if (i >= n) newNames[i] = cur.phaseNames?.[i + 1] || ''; // 空＝「フェーズN」（merge で古い名前が残らないよう全部書く）
  }
  const phases = Math.max(1, count - 1);
  projects = new Map(projects).set(project, { ...cur, phases, phaseNames: { ...(cur.phaseNames || {}), ...newNames } });
  emit();
  const write = Promise.all([
    updateMany(inside.map((x) => ({ id: x.id, patch: { phase: x.phase === n ? null : x.phase - 1 } }))),
    backend.setProject(project, { name: project, phases, phaseNames: newNames, updatedAt: Date.now() }),
  ]);
  const undo = () => {
    projects = new Map(projects).set(project, { ...(projects.get(project) || {}), phases: count, phaseNames: oldNames });
    emit();
    return Promise.all([
      updateMany(before),
      backend.setProject(project, { name: project, phases: count, phaseNames: oldNames, updatedAt: Date.now() }),
    ]);
  };
  return { write, undo, moved: inside.filter((x) => x.phase === n).length };
}

// 用途を消す：タスクとリンクの用途を外し、一覧から除く
export function deleteArea(name) {
  const r = quiet(() => deleteAreaRaw(name));
  r.entry = record(() => quiet(() => r.undo()));
  if (r.entry) r.entry.again = () => deleteArea(name);
  return r;
}
function deleteAreaRaw(name) {
  const oldList = getAreas();
  const list = oldList.filter((a) => a.name !== name);
  const ts = allTasks.filter((x) => x.area === name);
  const ls = links.filter((x) => x.area === name);
  areaList = list;
  emit();
  const write = Promise.all([
    backend.setMeta({ list }),
    updateMany(ts.map((x) => ({ id: x.id, patch: { area: null } }))),
    ...ls.map((x) => backend.updateLink(x.id, { area: null })),
  ]);
  const undo = () => {
    areaList = oldList;
    emit();
    return Promise.all([
      backend.setMeta({ list: oldList }),
      updateMany(ts.map((x) => ({ id: x.id, patch: { area: name } }))),
      ...ls.map((x) => backend.updateLink(x.id, { area: name })),
    ]);
  };
  return { write, undo, count: ts.filter((x) => !x.deletedAt).length };
}

// プロジェクトを消す。withTasks＝true ならタスクもゴミ箱へ、false ならタスクからプロジェクトとフェーズを外す
export function deleteProject(name, withTasks) {
  const r = quiet(() => deleteProjectRaw(name, withTasks));
  r.entry = record(() => quiet(() => r.undo()));
  if (r.entry) r.entry.again = () => deleteProject(name, withTasks);
  return r;
}
function deleteProjectRaw(name, withTasks) {
  const saved = projects.get(name) || null;
  const ts = allTasks.filter((x) => x.project === name && !x.deletedAt);
  const oldOrder = projectOrder;
  const m = new Map(projects);
  m.delete(name);
  projects = m;
  projectOrder = projectOrder.filter((n) => n !== name);
  const now = Date.now();
  const patch = withTasks ? { deletedAt: now } : { project: null, phase: null };
  const write = Promise.all([
    updateMany(ts.map((x) => ({ id: x.id, patch }))),
    backend.deleteProject(name),
    oldOrder.includes(name) ? backend.setMeta({ projectOrder }) : null,
  ]);
  const undo = () => {
    if (saved) projects = new Map(projects).set(name, saved);
    projectOrder = oldOrder;
    emit();
    return Promise.all([
      updateMany(ts.map((x) => ({ id: x.id, patch: withTasks ? { deletedAt: null } : { project: name, phase: x.phase ?? null } }))),
      saved ? backend.setProject(name, { name, phases: saved.phases ?? DEFAULT_PHASES, phaseNames: saved.phaseNames || {}, updatedAt: Date.now() }) : null,
      oldOrder.includes(name) ? backend.setMeta({ projectOrder: oldOrder }) : null,
    ]);
  };
  emit();
  return { write, undo, count: ts.length };
}

export async function updateMany(entries) {
  const byId = new Map(allTasks.map((x) => [x.id, x]));
  const back = entries.filter(({ id }) => byId.has(id)).map(({ id, patch }) => {
    const b = {};
    for (const k of Object.keys(patch)) if (k !== 'updatedAt') b[k] = byId.get(id)[k] ?? null;
    return { id, patch: b };
  });
  if (back.length) record(() => updateMany(back));
  const now = Date.now();
  return backend.batch(entries.map(({ id, patch }) => ({ type: 'update', id, data: { ...patch, updatedAt: now } })));
}

// 30日より前にゴミ箱に入れたものを完全に消す（起動時に1回）
let purged = false;
function purgeOld() {
  if (purged || !backend) return;
  purged = true;
  const limit = Date.now() - TRASH_DAYS * 24 * 60 * 60 * 1000;
  const old = allTasks.filter((x) => x.deletedAt && x.deletedAt < limit).slice(0, PURGE_MAX);
  if (!old.length) return;
  backend.batch(old.map((x) => ({ type: 'delete', id: x.id }))).catch((e) => {
    console.warn('[task-board] ゴミ箱の掃除に失敗', e);
  });
}

// ops を BATCH_MAX 件ずつに分ける
function chunks(ops) {
  const out = [];
  for (let i = 0; i < ops.length; i += BATCH_MAX) out.push(ops.slice(i, i + BATCH_MAX));
  return out;
}

// ---- 裏側：Firestore ----
async function firestoreBackend(uid) {
  const { db } = await import('./firebase.js');
  const {
    collection, doc, addDoc, updateDoc, setDoc, deleteDoc, onSnapshot, writeBatch, arrayUnion,
  } = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
  const col = collection(db, 'users', uid, 'tasks');
  const unsub = onSnapshot(col, { includeMetadataChanges: false }, (snap) => {
    setAll(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    emit();
    purgeOld();
  });
  // プロジェクトの一覧（フェーズの数）。変わったらタスクと同じく画面を描き直す
  const pcol = collection(db, 'users', uid, 'projects');
  const unsubP = onSnapshot(pcol, (snap) => {
    const m = new Map();
    for (const d of snap.docs) {
      const x = d.data();
      let name = x.name;
      if (!name) { try { name = decodeURIComponent(d.id); } catch { name = d.id; } }
      m.set(name, { phases: x.phases, phaseNames: x.phaseNames || null, sprints: Array.isArray(x.sprints) ? x.sprints : [], updatedAt: x.updatedAt || 0 });
    }
    projects = m;
    emit();
  });
  // 用途の一覧（文書が無ければ決まった6つ）
  const areasRef = doc(db, 'users', uid, 'meta', 'areas');
  const unsubA = onSnapshot(areasRef, (snap) => {
    const list = snap.exists() ? snap.data().list : null;
    const po = snap.exists() ? snap.data().projectOrder : null;
    projectOrder = Array.isArray(po) ? po.filter((n) => typeof n === 'string') : [];
    const lo = snap.exists() ? snap.data().linkAreaOrder : null;
    linkAreaOrder = Array.isArray(lo) ? lo.filter((n) => typeof n === 'string') : [];
    areaList = Array.isArray(list) && list.length
      ? list.filter((a) => a && typeof a.name === 'string' && a.name).map((a) => ({ name: a.name, color: a.color || null }))
      : null;
    emit();
  });
  // リンク集
  const lcol = collection(db, 'users', uid, 'links');
  const unsubL = onSnapshot(lcol, (snap) => {
    setLinks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    emit();
  });
  return {
    add: (t) => addDoc(col, t).then((r) => r.id),
    update: (id, p) => updateDoc(doc(col, id), p),
    // ops = [{ type: 'set'|'update'|'delete', id, data }]。BATCH_MAX 件ごとに writeBatch
    batch: (ops) => Promise.all(chunks(ops).map((part) => {
      const b = writeBatch(db);
      for (const o of part) {
        const ref = doc(col, o.id);
        if (o.type === 'set') b.set(ref, o.data);
        else if (o.type === 'update') b.update(ref, o.data);
        else if (o.type === 'delete') b.delete(ref);
      }
      return b.commit();
    })),
    setProject: (name, data) => setDoc(doc(pcol, projectDocId(name)), data, { merge: true }),
    // 一覧を丸ごと上書きしない（2台で同時に足しても両方残る。オフラインでも書ける）
    addAreas: (items) => setDoc(areasRef, { list: arrayUnion(...items), updatedAt: Date.now() }, { merge: true }),
    // 並べ替えは並び全体を書く（順番は arrayUnion では表せないため）
    setMeta: (patch) => setDoc(areasRef, { ...patch, updatedAt: Date.now() }, { merge: true }),
    deleteProject: (name) => deleteDoc(doc(pcol, projectDocId(name))),
    addLink: (data) => addDoc(lcol, data).then((r) => r.id),
    updateLink: (id, data) => updateDoc(doc(lcol, id), data),
    deleteLink: (id) => deleteDoc(doc(lcol, id)),
    setLink: (id, data) => setDoc(doc(lcol, id), data),
    stop: () => { unsub(); unsubP(); unsubA(); unsubL(); },
  };
}

// ---- 裏側：見本データ（?demo=1） ----
function demoBackend() {
  const t = todayKey();
  let n = 0;
  const mk = (o) => ({ ...normalize(o), ...o, id: `demo${++n}` });
  const day = 24 * 60 * 60 * 1000;
  setAll([
    mk({ title: '経営戦略のレポートを書く', area: '大学', doDate: t, dueDate: addDays(t, 2), size: '中', priority: '高' }),
    mk({ title: 'ES提出（〇〇社）', area: '就活', project: '〇〇社選考', phase: 1, dueDate: addDays(t, -1), priority: '高' }),
    mk({ title: '企業研究をまとめる', area: '就活', project: '〇〇社選考', phase: 1, status: 'done' }),
    mk({ title: '面接の逆質問を考える', area: '就活', project: '〇〇社選考', phase: 2, doDate: addDays(t, 1), size: '小' }),
    mk({ title: 'task-board のMVPを作る', area: 'AI開発', project: 'task-board', status: 'doing', size: '大' }),
    mk({ title: '前日やり残した洗濯', area: '家事', doDate: addDays(t, -1) }),
    mk({ title: 'シフト提出', area: 'バイト', doDate: addDays(t, 3) }),
    mk({ title: '統計の復習', area: '勉強', doDate: addDays(t, 5), size: '小', priority: '低' }),
    mk({ title: '思いついたこと（未整理）' }),
    mk({ title: '先生の返信待ち', area: '大学', status: 'waiting' }),
    mk({ title: '終わったタスク', area: '大学', doDate: t, status: 'done' }),
    // ゴミ箱：3日前に消したもの（残る）と、31日前に消したもの（起動時に完全に消える）
    mk({ title: '3日前に消したタスク', area: '家事', deletedAt: Date.now() - 3 * day }),
    mk({ title: '31日前に消したタスク', area: '家事', deletedAt: Date.now() - 31 * day }),
  ]);
  projects = new Map();
  areaList = null;
  projectOrder = [];
  linkAreaOrder = [];
  setLinks([
    { id: 'demoL1', area: '大学', name: 'manaba', url: 'https://manaba.cit.ac.jp/', createdAt: 1 },
    { id: 'demoL2', area: '大学', name: '', url: 'https://portal.it-chiba.ac.jp/', createdAt: 2 },
    { id: 'demoL3', area: '就活', name: 'OfferBox', url: 'https://offerbox.jp/', createdAt: 3 },
  ]);
  const apply = (o) => {
    if (o.type === 'set') { setAll([...allTasks.filter((x) => x.id !== o.id), { ...o.data, id: o.id }]); return; }
    if (o.type === 'delete') { setAll(allTasks.filter((x) => x.id !== o.id)); return; }
    setAll(allTasks.map((x) => (x.id === o.id ? { ...x, ...o.data } : x)));
  };
  return {
    add: async (x) => { const id = `demo${++n}`; apply({ type: 'set', id, data: x }); emit(); return id; },
    update: async (id, p) => { apply({ type: 'update', id, data: p }); emit(); },
    batch: async (ops) => { for (const o of ops) apply(o); emit(); },
    setProject: async (name, data) => { const cur = projects.get(name) || {}; projects = new Map(projects).set(name, { ...cur, ...data, phaseNames: { ...(cur.phaseNames || {}), ...(data.phaseNames || {}) } }); emit(); },
    addAreas: async () => { emit(); },
    setMeta: async () => { emit(); },
    deleteProject: async () => { emit(); },
    addLink: async (data) => { const id = `demoL${++n}`; setLinks([...links, { ...data, id }]); emit(); return id; },
    updateLink: async (id, data) => { setLinks(links.map((x) => (x.id === id ? { ...x, ...data } : x))); emit(); },
    deleteLink: async (id) => { setLinks(links.filter((x) => x.id !== id)); emit(); },
    setLink: async (id, data) => { setLinks([...links.filter((x) => x.id !== id), { ...data, id }]); emit(); },
    stop: () => {},
  };
}

export const demo = isDemo;

// ログインした時（または demo の時）に app.js から呼ぶ
export async function start(uid) {
  if (backend) backend.stop();
  purged = false;
  backend = isDemo ? demoBackend() : await firestoreBackend(uid);
  emit();
  if (isDemo) purgeOld();
}

export function stop() {
  if (backend) backend.stop();
  backend = null;
  setAll([]);
  projects = new Map();
  areaList = null;
  projectOrder = [];
  linkAreaOrder = [];
  links = [];
  emit();
}
