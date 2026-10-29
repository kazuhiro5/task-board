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
//
// プロジェクトの一覧（決定/0007）：users/{uid}/projects/{文書の番号} に { name, phases, updatedAt }。
// 文書の番号は encodeURIComponent(名前)（「大学/ゼミ」の / がパスの区切りにならないように。「.」も %2E に）。
// 文書が無いプロジェクトはフェーズ5つとして扱う。
//
// ?demo=1 で開くと、ログインせずにメモリ上の見本データで動く（画面の確認用）。
import { todayKey, addDays } from './dates.js';

const isDemo = new URLSearchParams(location.search).has('demo');

let backend = null;
let listeners = [];
let allTasks = []; // ゴミ箱の中も含む全部
let tasks = []; // ゴミ箱の中を除いたもの（画面に渡す）
let projects = new Map(); // プロジェクト名 → { phases }

export const DEFAULT_PHASES = 5;
const TRASH_DAYS = 30;
const PURGE_MAX = 200; // 起動時に完全に消す最大数（書き込みが一度に多くならないように）
const BATCH_MAX = 500; // Firestore の writeBatch 1回の上限

function setAll(list) {
  allTasks = list;
  tasks = list.filter((x) => !x.deletedAt);
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

// フェーズを1つ足して保存する（待たなくてよい。端末内にはすぐ入る）
export async function addPhase(project) {
  const name = project ? String(project).trim() : '';
  if (!name) throw new Error('プロジェクトがありません');
  const phases = getPhases(name) + 1;
  projects = new Map(projects).set(name, { phases });
  emit();
  return backend.setProject(name, { name, phases, updatedAt: Date.now() });
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

// 一覧に出すプロジェクト名（使われている順・新しい順）
export function projectNames() {
  const seen = new Map();
  for (const t of [...tasks].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) {
    if (t.project && !seen.has(t.project)) seen.set(t.project, true);
  }
  return [...seen.keys()];
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
    priority: data.priority || null,
    memo: data.memo || '',
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
  const p = { ...patch, updatedAt: Date.now() };
  if ('status' in patch) p.completedAt = patch.status === 'done' ? Date.now() : null;
  if ('project' in patch) p.project = patch.project ? String(patch.project).trim() : null;
  if ('phase' in patch) p.phase = toPhase(patch.phase);
  if ('order' in patch && !(typeof patch.order === 'number' && Number.isFinite(patch.order))) delete p.order;
  if ('project' in patch && !p.project) p.phase = null; // プロジェクトを外したらフェーズも外す
  return backend.update(id, p);
}

// 削除＝ゴミ箱へ（文書は消さず deletedAt を付ける）
export async function deleteTask(id) {
  return backend.update(id, { deletedAt: Date.now(), updatedAt: Date.now() });
}

// ゴミ箱から戻す
export async function restoreTask(id) {
  return backend.update(id, { deletedAt: null, updatedAt: Date.now() });
}

// 完全に消す（ゴミ箱の「完全に消す」と、起動時の30日の掃除）
export async function purgeTask(id) {
  return backend.batch([{ type: 'delete', id }]);
}

// 何件もまとめて書き換える。entries = [{ id, patch }]。Firestore は writeBatch で BATCH_MAX 件ごとに分ける。
// 端末内にはすぐ入る（オフラインだと Promise は終わらないので、画面は待たない）
export async function updateMany(entries) {
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
    collection, doc, addDoc, updateDoc, setDoc, onSnapshot, writeBatch,
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
      m.set(name, { phases: x.phases });
    }
    projects = m;
    emit();
  });
  return {
    add: (t) => addDoc(col, t).then((r) => r.id),
    update: (id, p) => updateDoc(doc(col, id), p),
    newId: () => doc(col).id,
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
    stop: () => { unsub(); unsubP(); },
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
  const apply = (o) => {
    if (o.type === 'set') { setAll([...allTasks.filter((x) => x.id !== o.id), { ...o.data, id: o.id }]); return; }
    if (o.type === 'delete') { setAll(allTasks.filter((x) => x.id !== o.id)); return; }
    setAll(allTasks.map((x) => (x.id === o.id ? { ...x, ...o.data } : x)));
  };
  return {
    add: async (x) => { const id = `demo${++n}`; apply({ type: 'set', id, data: x }); emit(); return id; },
    update: async (id, p) => { apply({ type: 'update', id, data: p }); emit(); },
    newId: () => `demo${++n}`,
    batch: async (ops) => { for (const o of ops) apply(o); emit(); },
    setProject: async (name, data) => { projects = new Map(projects).set(name, { phases: data.phases }); emit(); },
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
  emit();
}
