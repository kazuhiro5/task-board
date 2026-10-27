// タスクの読み書きと購読。画面側はこのファイルの関数だけを使う（Firestore を直接触らない）。
//
// タスクの形（設計書 5章）：
// { id, title, status: 'todo'|'doing'|'waiting'|'done', doDate, dueDate, area, project,
//   size, priority, memo, createdAt, updatedAt, completedAt }
// 日付は 'YYYY-MM-DD' か null。createdAt などは ミリ秒の数値（端末の時計）。
//
// ?demo=1 で開くと、ログインせずにメモリ上の見本データで動く（画面の確認用）。
import { todayKey, addDays } from './dates.js';

const isDemo = new URLSearchParams(location.search).has('demo');

let backend = null;
let listeners = [];
let tasks = [];

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
  return {
    title: (data.title || '').trim(),
    status: data.status || 'todo',
    doDate: data.doDate || null,
    dueDate: data.dueDate || null,
    area: data.area || null,
    project: data.project ? String(data.project).trim() : null,
    size: data.size || null,
    priority: data.priority || null,
    memo: data.memo || '',
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
  return backend.update(id, p);
}

export async function deleteTask(id) {
  return backend.remove(id);
}

// ---- 裏側：Firestore ----
async function firestoreBackend(uid) {
  const { db } = await import('./firebase.js');
  const {
    collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  } = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
  const col = collection(db, 'users', uid, 'tasks');
  const unsub = onSnapshot(col, { includeMetadataChanges: false }, (snap) => {
    tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    emit();
  });
  return {
    add: (t) => addDoc(col, t).then((r) => r.id),
    update: (id, p) => updateDoc(doc(col, id), p),
    remove: (id) => deleteDoc(doc(col, id)),
    stop: unsub,
  };
}

// ---- 裏側：見本データ（?demo=1） ----
function demoBackend() {
  const t = todayKey();
  let n = 0;
  const mk = (o) => ({ ...normalize(o), ...o, id: `demo${++n}` });
  tasks = [
    mk({ title: '経営戦略のレポートを書く', area: '大学', doDate: t, dueDate: addDays(t, 2), size: '中', priority: '高' }),
    mk({ title: 'ES提出（〇〇社）', area: '就活', project: '〇〇社選考', dueDate: addDays(t, -1), priority: '高' }),
    mk({ title: '面接の逆質問を考える', area: '就活', project: '〇〇社選考', doDate: addDays(t, 1), size: '小' }),
    mk({ title: 'task-board のMVPを作る', area: 'AI開発', project: 'task-board', status: 'doing', size: '大' }),
    mk({ title: '前日やり残した洗濯', area: '家事', doDate: addDays(t, -1) }),
    mk({ title: 'シフト提出', area: 'バイト', doDate: addDays(t, 3) }),
    mk({ title: '統計の復習', area: '勉強', doDate: addDays(t, 5), size: '小', priority: '低' }),
    mk({ title: '思いついたこと（未整理）' }),
    mk({ title: '先生の返信待ち', area: '大学', status: 'waiting' }),
    mk({ title: '終わったタスク', area: '大学', doDate: t, status: 'done' }),
  ];
  const find = (id) => tasks.findIndex((x) => x.id === id);
  return {
    add: async (x) => { const id = `demo${++n}`; tasks = [...tasks, { ...x, id }]; emit(); return id; },
    update: async (id, p) => { const i = find(id); if (i >= 0) { tasks = tasks.map((x, j) => (j === i ? { ...x, ...p } : x)); emit(); } },
    remove: async (id) => { tasks = tasks.filter((x) => x.id !== id); emit(); },
    stop: () => {},
  };
}

export const demo = isDemo;

// ログインした時（または demo の時）に app.js から呼ぶ
export async function start(uid) {
  if (backend) backend.stop();
  backend = isDemo ? demoBackend() : await firestoreBackend(uid);
  emit();
}

export function stop() {
  if (backend) backend.stop();
  backend = null;
  tasks = [];
  emit();
}
