// 画面（今日・週・一覧・プロジェクト）で共通に使う部品：タスクの1行・並べ替え・区分の見出し。担当：画面役。
import { updateTask } from '../store.js';
import { openEdit } from '../edit.js';
import { todayKey, relLabel, fromKey } from '../dates.js';
import { PRIORITIES, STATUS_LABEL } from '../constants.js';

// 要素を作る小さな道具。h('div', { class: 'x', onclick: fn }, '文字', 子要素…)
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const isOpen = (t) => t.status !== 'done';

// 用途の点（色だけに頼らないよう、使う所では用途名の文字と一緒に出す）
const AREA_KEY = { 大学: 'univ', AI開発: 'ai', 就活: 'job', バイト: 'work', 勉強: 'study', 家事: 'home' };
export function areaDot(area) {
  return h('span', { class: `tb-dot tb-dot--${AREA_KEY[area] || 'none'}`, 'aria-hidden': 'true' });
}
// 行の先頭に置く「● 用途名」
export function areaMark(area) {
  return h('span', { class: 'tb-area' }, areaDot(area), area);
}

// 'YYYY-MM-DD' → '10/30'
export function md(key) {
  const d = fromKey(key);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 並び：未完了→締切が近い順→優先度 高中低→作成順
export function compareTasks(a, b) {
  const da = isOpen(a) ? 0 : 1;
  const db = isOpen(b) ? 0 : 1;
  if (da !== db) return da - db;
  const ua = a.dueDate || '9999-99-99';
  const ub = b.dueDate || '9999-99-99';
  if (ua !== ub) return ua < ub ? -1 : 1;
  const pa = a.priority ? PRIORITIES.indexOf(a.priority) : PRIORITIES.length;
  const pb = b.priority ? PRIORITIES.indexOf(b.priority) : PRIORITIES.length;
  if (pa !== pb) return pa - pb;
  return (a.createdAt || 0) - (b.createdAt || 0);
}

// 失敗したら、そのカードの下に短いエラーを数秒だけ出す（alert は使わない）
function showCardError(cardEl, msg) {
  cardEl.querySelector('.tb-err')?.remove();
  const err = h('p', { class: 'tb-err', role: 'alert' }, msg);
  cardEl.append(err);
  setTimeout(() => err.remove(), 4000);
}

function toggleDone(task, cardEl) {
  // 完了にする時は前の状態（進行中・待ちなど）を prevStatus に残し、戻す時にそこへ戻す
  const patch = isOpen(task)
    ? { status: 'done', prevStatus: task.status || 'todo' }
    : { status: task.prevStatus && task.prevStatus !== 'done' ? task.prevStatus : 'todo', prevStatus: null };
  updateTask(task.id, patch).catch((e) => {
    console.warn('[task-board] 完了の切り替えに失敗', e);
    showCardError(cardEl, '保存できませんでした。もう一度押してください');
  });
}

// タスクの1行。opts.badges：タイトルの前に出す小さな印（例：['持ち越し']）
//              opts.hide：メタ情報から省く項目（例：['doDate']）
//              opts.dueMark：締切の日として置いた行（週の画面。〆を目立たせる）
//              opts.showPhase：フェーズの印（F2 など）を出す（プロジェクトの中だけ）
export function taskCard(task, opts = {}) {
  const t = todayKey();
  const done = !isOpen(task);
  const hide = new Set(opts.hide || []);
  const meta = [];
  for (const b of opts.badges || []) meta.push(h('span', { class: 'tb-tag tb-tag--badge' }, b));
  if ((task.status === 'doing' || task.status === 'waiting') && !hide.has('status')) {
    meta.push(h('span', { class: `tb-tag tb-tag--${task.status}` }, STATUS_LABEL[task.status]));
  }
  if (task.priority && !hide.has('priority')) {
    meta.push(h('span', { class: `tb-tag tb-pri tb-pri--${PRIORITIES.indexOf(task.priority)}` }, `優先${task.priority}`));
  }
  if (task.dueDate && !hide.has('dueDate')) {
    const over = !done && task.dueDate < t;
    meta.push(h('span', { class: 'tb-tag tb-due' + (over ? ' is-over' : '') }, `〆${md(task.dueDate)}`));
  }
  if (task.doDate && !hide.has('doDate')) meta.push(h('span', { class: 'tb-tag' }, relLabel(task.doDate)));
  if (task.project && !hide.has('project')) meta.push(h('span', { class: 'tb-tag tb-tag--proj' }, task.project));
  if (opts.showPhase && task.phase && !hide.has('phase')) {
    meta.push(h('span', { class: 'tb-tag tb-phase', title: `フェーズ${task.phase}` }, `F${task.phase}`));
  }

  const cls = 'tb-card' + (done ? ' is-done' : '') + (opts.dueMark ? ' is-due-entry' : '');
  const card = h('div', { class: cls, 'data-id': task.id },
    h('button', {
      type: 'button',
      class: 'tb-check',
      'aria-label': done ? '未完了に戻す' : '完了にする',
      'aria-pressed': String(done),
      onclick: () => toggleDone(task, card),
    }, h('span', { class: 'tb-check-mark', 'aria-hidden': 'true' }, done ? '✓' : '')),
    h('button', { type: 'button', class: 'tb-body', onclick: () => openEdit(task) },
      h('span', { class: 'tb-line' },
        task.area && !hide.has('area') ? areaMark(task.area) : null,
        h('span', { class: 'tb-title' }, task.title || '（無題）')),
      meta.length ? h('span', { class: 'tb-meta' }, meta) : null,
    ),
  );
  return card;
}

// 区分の見出し＋件数。onPick があれば押せる見出しにする（押すと「ここに追加」）
export function sectionHead(title, count, opts = {}) {
  const inner = [
    h('span', { class: 'tb-sec-title' }, title),
    h('span', { class: 'tb-count' }, count ? String(count) : 'なし'),
    opts.picked ? h('span', { class: 'tb-here' }, 'ここに追加') : null,
  ];
  const cls = 'tb-sec-head' + (count ? '' : ' is-empty') + (opts.picked ? ' is-picked' : '');
  if (!opts.onPick) return h('h2', { class: cls }, inner);
  return h('h2', { class: cls },
    h('button', { type: 'button', class: 'tb-sec-btn', 'aria-pressed': String(!!opts.picked), onclick: opts.onPick }, inner));
}
