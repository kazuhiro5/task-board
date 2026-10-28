// 表示の切り替え（リスト／3列／カレンダー／ボード）。一覧とプロジェクトの中で共通に使う。担当：画面役（UI改修）。
// renderModes(tasks, cfg) → 要素
//   cfg = { scope: 'list'|'project', groupKey, groupKeys, setGroup, baseCtx, setContext, rerender, hide, compact }
// 状態（完了を表示・選んだグループ・週のずれ など）は scope ごとにこのファイルが持つ。
import { updateTask } from '../store.js';
import { AREAS, SIZES, STATUSES } from '../constants.js';
import { todayKey, addDays, weekDays, label, fromKey } from '../dates.js';
import { h, isOpen, compareTasks, taskCard as baseCard, sectionHead, md, areaDot } from './card.js';

// cfg.hide（例：プロジェクトの中では ['project']）を、すべての行に足す
let extraHide = [];
function taskCard(x, o = {}) {
  return baseCard(x, { ...o, hide: [...(o.hide || []), ...extraHide] });
}

export const MODES = [
  { value: 'list', label: 'リスト' },
  { value: 'cols', label: '3列' },
  { value: 'cal', label: 'カレンダー' },
  { value: 'board', label: 'ボード' },
];

const NONE = '\u0000none'; // 未設定のグループ

const scopes = {};
function st(scope) {
  if (!scopes[scope]) {
    scopes[scope] = { showDone: false, picked: null, colPick: null, colOpen: false, weekOffset: 0, pickedDay: null };
  }
  return scopes[scope];
}

// プロジェクトを開き直した時などに、選んでいたグループ・週を戻す
export function resetScope(scope) {
  delete scopes[scope];
}

// ---- 選んだ表示の保存（画面ごと。tb.mode.list / tb.mode.project） ----
export function loadMode(scope) {
  try {
    const v = localStorage.getItem(`tb.mode.${scope}`);
    return MODES.some((m) => m.value === v) ? v : 'list';
  } catch { return 'list'; }
}
function saveMode(scope, v) {
  try { localStorage.setItem(`tb.mode.${scope}`, v); } catch { /* 保存できなくても動く */ }
}

function modeBar(scope, mode, rerender) {
  return h('div', { class: 'tb-seg tb-modes', role: 'group', 'aria-label': '表示の切り替え' },
    MODES.map((m) => h('button', {
      type: 'button',
      class: 'tb-seg-btn' + (m.value === mode ? ' is-active' : ''),
      'aria-pressed': String(m.value === mode),
      'data-mode': m.value,
      onclick: () => { if (m.value !== mode) { saveMode(scope, m.value); rerender(); } },
    }, m.label)));
}

// ---- グループ分け（一覧のリスト・3列で使う） ----
function groupsFor(key, list, showDone) {
  if (key === 'area') return { order: AREAS, value: (x) => x.area || NONE, label: (v) => v };
  if (key === 'size') return { order: SIZES, value: (x) => x.size || NONE, label: (v) => v };
  if (key === 'status') {
    const order = STATUSES.map((s) => s.value).filter((v) => v !== 'done' || showDone);
    const lab = Object.fromEntries(STATUSES.map((s) => [s.value, s.label]));
    return { order, value: (x) => x.status || 'todo', label: (v) => lab[v] || v };
  }
  const names = [...new Set(list.map((x) => x.project).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
  return { order: names, value: (x) => x.project || NONE, label: (v) => v };
}

// compact：中身のあるグループだけ出す（絞り込み中・プロジェクトの中）
function bucketize(key, list, showDone, compact) {
  const g = groupsFor(key, list, showDone);
  if (compact) g.order = g.order.filter((v) => list.some((x) => g.value(x) === v));
  const buckets = new Map(g.order.map((v) => [v, []]));
  for (const x of list) {
    const v = g.value(x);
    if (!buckets.has(v)) buckets.set(v, []);
    buckets.get(v).push(x);
  }
  if (buckets.has(NONE)) { const n = buckets.get(NONE); buckets.delete(NONE); buckets.set(NONE, n); }
  for (const items of buckets.values()) items.sort(compareTasks);
  return { g, buckets };
}

// グループを選んだ時に入力欄の初期値にするもの
function ctxFor(key, v) {
  if (v === NONE || (key === 'status' && v === 'done')) return {};
  return { [key]: v };
}

function groupBar(cfg, s) {
  return h('div', { class: 'tb-listbar' },
    h('div', { class: 'tb-seg', role: 'group', 'aria-label': 'グループ分け' },
      cfg.groupKeys.map((k) => h('button', {
        type: 'button',
        class: 'tb-seg-btn' + (k.value === cfg.groupKey ? ' is-active' : ''),
        'aria-pressed': String(k.value === cfg.groupKey),
        'data-group': k.value,
        onclick: () => { if (k.value !== cfg.groupKey) cfg.setGroup(k.value); },
      }, k.label))),
    h('button', {
      type: 'button',
      class: 'tb-btn tb-toggle' + (s.showDone ? ' is-active' : ''),
      'aria-pressed': String(s.showDone),
      onclick: () => { s.showDone = !s.showDone; cfg.rerender(); },
    }, s.showDone ? '✓ 完了を表示' : '完了を表示'));
}

// ---- リスト ----
function listMode(tasks, cfg, s) {
  const key = cfg.groupKey;
  const list = s.showDone ? tasks : tasks.filter(isOpen);
  const { g, buckets } = bucketize(key, list, s.showDone, cfg.compact);

  const pickedHere = s.picked && s.picked.startsWith(`${key}:`) ? s.picked.slice(key.length + 1) : null;
  if (pickedHere !== null && !buckets.has(pickedHere)) s.picked = null;
  cfg.setContext({ ...cfg.baseCtx, ...(s.picked && pickedHere !== null ? ctxFor(key, pickedHere) : {}) });

  const sections = [...buckets.entries()].map(([v, items]) => {
    const isPicked = pickedHere === v;
    return h('section', { class: 'tb-sec', 'data-group-value': v === NONE ? '' : v },
      sectionHead(v === NONE ? '未設定' : g.label(v), items.length, {
        picked: isPicked,
        onPick: () => { s.picked = isPicked ? null : `${key}:${v}`; cfg.rerender(); },
      }),
      items.length ? h('div', { class: 'tb-cards' }, items.map((x) => taskCard(x, { hide: [key] }))) : null);
  });
  return [groupBar(cfg, s),
    sections.length ? h('div', { class: 'tb-groups' }, sections) : h('p', { class: 'tb-empty' }, 'タスクはありません')];
}

// ---- 3列：左にグループ、右にそのグループのタスク ----
function colsMode(tasks, cfg, s) {
  const key = cfg.groupKey;
  const list = s.showDone ? tasks : tasks.filter(isOpen);
  const { g, buckets } = bucketize(key, list, s.showDone, cfg.compact);
  const values = [...buckets.keys()];
  const prefix = `${key}:`;
  let cur = s.colPick && s.colPick.startsWith(prefix) ? s.colPick.slice(prefix.length) : null;
  if (cur === null || !buckets.has(cur)) {
    // 最初はタスクのある最初のグループ
    cur = values.find((v) => buckets.get(v).length) ?? values[0] ?? null;
    s.colOpen = false;
  }
  cfg.setContext({ ...cfg.baseCtx, ...(cur !== null ? ctxFor(key, cur) : {}) });
  const nameOf = (v) => (v === NONE ? '未設定' : g.label(v));

  const nav = h('nav', { class: 'tb-cols-nav', 'aria-label': 'グループ' },
    values.map((v) => h('button', {
      type: 'button',
      class: 'tb-cols-item' + (v === cur ? ' is-active' : '') + (buckets.get(v).length ? '' : ' is-empty'),
      'aria-pressed': String(v === cur),
      'data-group-value': v === NONE ? '' : v,
      onclick: () => { s.colPick = prefix + v; s.colOpen = true; cfg.rerender(); },
    },
    key === 'area' && v !== NONE ? areaDot(v) : null,
    h('span', { class: 'tb-cols-name' }, nameOf(v)),
    h('span', { class: 'tb-count' }, String(buckets.get(v).length)))));

  const items = cur !== null ? buckets.get(cur) : [];
  const pane = h('section', { class: 'tb-cols-pane' },
    h('div', { class: 'tb-cols-head' },
      h('button', { type: 'button', class: 'tb-btn tb-back tb-cols-back', onclick: () => { s.colOpen = false; cfg.rerender(); } }, '‹ 戻る'),
      h('h2', { class: 'tb-cols-title' }, cur !== null ? nameOf(cur) : ''),
      h('span', { class: 'tb-count' }, String(items.length))),
    items.length
      ? h('div', { class: 'tb-cards' }, items.map((x) => taskCard(x, { hide: [key] })))
      : h('p', { class: 'tb-empty' }, 'タスクはありません'));

  return [groupBar(cfg, s),
    values.length
      ? h('div', { class: 'tb-cols' + (s.colOpen ? ' is-open' : '') }, nav, pane)
      : h('p', { class: 'tb-empty' }, 'タスクはありません')];
}

// ---- カレンダー：月曜始まりの週の格子 ----
function calMode(tasks, cfg, s) {
  const t = todayKey();
  const days = weekDays(addDays(t, s.weekOffset * 7));
  if (s.pickedDay && !days.includes(s.pickedDay)) s.pickedDay = null;
  cfg.setContext({ ...cfg.baseCtx, ...(s.pickedDay ? { doDate: s.pickedDay } : {}) });

  const go = (n) => { s.weekOffset = n; cfg.rerender(); };
  const nav = h('div', { class: 'tb-weeknav' },
    h('button', { type: 'button', class: 'tb-btn', onclick: () => go(s.weekOffset - 1) }, '‹ 前の週'),
    h('button', { type: 'button', class: 'tb-btn' + (s.weekOffset === 0 ? ' is-active' : ''), 'aria-pressed': String(s.weekOffset === 0), onclick: () => go(0) }, '今週'),
    h('button', { type: 'button', class: 'tb-btn', onclick: () => go(s.weekOffset + 1) }, '次の週 ›'),
    h('span', { class: 'tb-weekrange' }, `${md(days[0])} 〜 ${md(days[6])}`));

  const noDate = tasks.filter((x) => isOpen(x) && !x.doDate && !x.dueDate).sort(compareTasks);
  const band = h('section', { class: 'tb-nodate' },
    sectionHead('日付なし', noDate.length),
    noDate.length ? h('div', { class: 'tb-cards tb-nodate-cards' }, noDate.map((x) => taskCard(x))) : null);

  const cols = days.map((d) => {
    const planned = tasks.filter((x) => isOpen(x) && x.doDate === d).sort(compareTasks);
    const dueOnly = tasks.filter((x) => isOpen(x) && x.dueDate === d && x.doDate !== d).sort(compareTasks);
    const done = tasks.filter((x) => !isOpen(x) && x.doDate === d).sort(compareTasks);
    const picked = s.pickedDay === d;
    const wd = fromKey(d).getDay();
    const head = h('button', {
      type: 'button',
      class: 'tb-day-head' + (d === t ? ' is-today' : '') + (picked ? ' is-picked' : ''),
      'aria-pressed': String(picked),
      onclick: () => { s.pickedDay = picked ? null : d; cfg.rerender(); },
    },
    h('span', { class: 'tb-day-label' + (wd === 0 ? ' is-sun' : wd === 6 ? ' is-sat' : '') }, label(d)),
    d === t ? h('span', { class: 'tb-today-mark' }, '今日') : null,
    h('span', { class: 'tb-count' }, String(planned.length + dueOnly.length)),
    picked ? h('span', { class: 'tb-here' }, 'ここに追加') : null);
    const n = planned.length + dueOnly.length + done.length;
    return h('section', { class: 'tb-day' + (d === t ? ' is-today' : '') + (picked ? ' is-picked' : ''), 'data-day': d },
      head,
      h('div', { class: 'tb-cards' },
        planned.map((x) => taskCard(x, { hide: ['doDate'] })),
        dueOnly.map((x) => taskCard(x, { dueMark: true })),
        done.map((x) => taskCard(x, { hide: ['doDate'] })),
        n ? null : h('p', { class: 'tb-empty' }, 'なし')));
  });

  return [nav, band, h('div', { class: 'tb-days' }, cols)];
}

// ---- ボード：列は状態。カードの小さなボタンで状態を変える ----
const MOVES = {
  todo: ['doing', 'waiting'],
  doing: ['waiting', 'done'],
  waiting: ['doing', 'done'],
  done: ['back'],
};
const DONE_LIMIT = 30; // 完了の列に出す最大数（多すぎると重いので）

function moveTo(task, to, cardEl) {
  // 完了から戻す時は、チェックを外す時と同じく前の状態（無ければ未着手）へ
  if (to === 'back') to = task.prevStatus && task.prevStatus !== 'done' ? task.prevStatus : 'todo';
  const patch = to === 'done'
    ? { status: 'done', prevStatus: task.status || 'todo' }
    : { status: to, prevStatus: null };
  updateTask(task.id, patch).catch((e) => {
    console.warn('[task-board] 状態の変更に失敗', e);
    cardEl.querySelector('.tb-err')?.remove();
    const err = h('p', { class: 'tb-err', role: 'alert' }, '保存できませんでした。もう一度押してください');
    cardEl.append(err);
    setTimeout(() => err.remove(), 4000);
  });
}

function boardMode(tasks, cfg) {
  cfg.setContext({ ...cfg.baseCtx });
  const lab = Object.fromEntries(STATUSES.map((x) => [x.value, x.label]));
  const cols = STATUSES.map(({ value, label: name }) => {
    let items = tasks.filter((x) => (x.status || 'todo') === value);
    let more = 0;
    if (value === 'done') {
      items.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
      more = Math.max(0, items.length - DONE_LIMIT);
      items = items.slice(0, DONE_LIMIT);
    } else items.sort(compareTasks);
    const cards = items.map((x) => {
      const card = taskCard(x, { hide: ['status'] });
      card.append(h('div', { class: 'tb-moves' },
        MOVES[value].map((to) => h('button', {
          type: 'button',
          class: 'tb-move',
          'data-to': to,
          onclick: () => moveTo(x, to, card),
        }, to === 'back' ? '↩ 戻す' : `→${lab[to]}`))));
      return card;
    });
    return h('section', { class: 'tb-bcol tb-bcol--' + value, 'data-status': value },
      sectionHead(name, items.length + more),
      h('div', { class: 'tb-cards' }, cards,
        items.length ? null : h('p', { class: 'tb-empty' }, 'なし'),
        more ? h('p', { class: 'tb-empty' }, `ほか${more}件`) : null));
  });
  return [h('div', { class: 'tb-board', role: 'region', 'aria-label': 'ボード', tabindex: '0' }, cols)];
}

export function renderModes(tasks, cfg) {
  const s = st(cfg.scope);
  const mode = loadMode(cfg.scope);
  extraHide = cfg.hide || [];
  const body = mode === 'cols' ? colsMode(tasks, cfg, s)
    : mode === 'cal' ? calMode(tasks, cfg, s)
      : mode === 'board' ? boardMode(tasks, cfg)
        : listMode(tasks, cfg, s);
  return h('div', { class: `tb-modes-wrap is-${mode}`, 'data-mode': mode }, modeBar(cfg.scope, mode, cfg.rerender), body);
}
