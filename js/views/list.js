// 画面「一覧」。担当：画面役。
// renderList(container, tasks, opts)：opts = { group, setGroup, setContext, rerender }
// グループ分けを 用途／プロジェクト／大中小／状態 に切り替える。見出しを押すとそこへ追加できる。
import { AREAS, SIZES, STATUSES, GROUP_KEYS } from '../constants.js';
import { h, isOpen, compareTasks, taskCard, sectionHead } from './card.js';

let showDone = false; // 「完了を表示」
let picked = null; // 「ここに追加」にしたグループ（'area:就活' の形）

const NONE = '\u0000none'; // 未設定のグループ

// 軸ごとに、グループの並び（空でも出すもの）と、タスクの値の取り出し方
function groupsFor(key, list) {
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

// グループを開いた時に入力欄の初期値にするもの
function ctxFor(key, v) {
  if (v === NONE || (key === 'status' && v === 'done')) return {};
  return { [key]: v };
}

export function renderList(container, tasks, opts) {
  const key = GROUP_KEYS.some((g) => g.value === opts.group) ? opts.group : 'area';
  const list = showDone ? tasks : tasks.filter(isOpen);
  const g = groupsFor(key, list);

  const buckets = new Map(g.order.map((v) => [v, []]));
  for (const x of list) {
    const v = g.value(x);
    if (!buckets.has(v)) buckets.set(v, []);
    buckets.get(v).push(x);
  }
  // 未設定は最後に
  if (buckets.has(NONE)) { const n = buckets.get(NONE); buckets.delete(NONE); buckets.set(NONE, n); }

  const pickedHere = picked && picked.startsWith(`${key}:`) ? picked.slice(key.length + 1) : null;
  if (pickedHere !== null && !buckets.has(pickedHere)) picked = null;
  opts.setContext(pickedHere !== null && buckets.has(pickedHere) ? ctxFor(key, pickedHere) : {});

  const bar = h('div', { class: 'tb-listbar' },
    h('div', { class: 'tb-seg', role: 'group', 'aria-label': 'グループ分け' },
      GROUP_KEYS.map((k) => h('button', {
        type: 'button',
        class: 'tb-seg-btn' + (k.value === key ? ' is-active' : ''),
        'aria-pressed': String(k.value === key),
        'data-group': k.value,
        onclick: () => { if (k.value !== key) opts.setGroup(k.value); },
      }, k.label))),
    h('button', {
      type: 'button',
      class: 'tb-btn tb-toggle' + (showDone ? ' is-active' : ''),
      'aria-pressed': String(showDone),
      onclick: () => { showDone = !showDone; opts.rerender(); },
    }, showDone ? '✓ 完了を表示' : '完了を表示'),
  );

  const sections = [...buckets.entries()].map(([v, items]) => {
    const isPicked = pickedHere === v;
    return h('section', { class: 'tb-sec', 'data-group-value': v === NONE ? '' : v },
      sectionHead(v === NONE ? '未設定' : g.label(v), items.length, {
        picked: isPicked,
        onPick: () => { picked = isPicked ? null : `${key}:${v}`; opts.rerender(); },
      }),
      items.length ? h('div', { class: 'tb-cards' }, items.sort(compareTasks).map((x) => taskCard(x, { hide: [key] }))) : null);
  });

  container.replaceChildren(h('div', { class: 'tb-list' }, bar,
    sections.length ? h('div', { class: 'tb-groups' }, sections) : h('p', { class: 'tb-empty' }, 'タスクはありません')));
}
