// 画面「一覧」。担当：画面役。
// renderList(container, tasks, opts)：opts = { group, setGroup, setContext, rerender, params, navigate }
// 上のChrome風のタブで「用途」「進捗」を切り替える（選んだタブは localStorage の tb.listTab）。
//   用途：用途ごとのグループ（大学…勉強→未設定）。「完了を表示」で完了も出す
//   進捗：状態ごと（未着手・進行中・待ち・完了）。本文が広い時は4列、狭い時は見出し付きの縦のリスト
// opts.params.area があれば、その用途に絞って出す（「就活で絞り込み中 ×」で解除）。
// 見出しを押すと「ここに追加」（入力欄の初期値をその用途・状態にする）。
import { AREAS, STATUSES } from '../constants.js';
import { h, isOpen, compareTasks, taskCard, sectionHead, areaDot } from './card.js';
import { addMoves, doneItems } from './modes.js';

const TABS = [
  { value: 'area', label: '用途' },
  { value: 'status', label: '進捗' },
];
const NONE = '\u0000none'; // 未設定のグループ

let areaFilter = null; // 絞り込み中の用途
let lastParams = ''; // 最後に受け取った params（同じものを何度も受けても、解除した絞り込みを戻さない）
let showDone = false; // 用途タブで完了も出すか
let picked = null; // 「ここに追加」で選んだ見出し（'area:大学' / 'status:doing'）

function loadTab() {
  try {
    const v = localStorage.getItem('tb.listTab');
    return TABS.some((x) => x.value === v) ? v : 'area';
  } catch { return 'area'; }
}
function saveTab(v) {
  try { localStorage.setItem('tb.listTab', v); } catch { /* 保存できなくても動く */ }
}

function tabStrip(cur, rerender) {
  return h('div', { class: 'tb-ctabs', role: 'tablist', 'aria-label': '一覧の切り替え' },
    TABS.map((x) => h('button', {
      type: 'button',
      role: 'tab',
      id: `tb-ctab-${x.value}`,
      class: 'tb-ctab' + (x.value === cur ? ' is-active' : ''),
      'aria-selected': String(x.value === cur),
      'aria-controls': 'tb-ctab-panel',
      'data-tab': x.value,
      onclick: () => { if (x.value !== cur) { saveTab(x.value); picked = null; rerender(); } },
    }, h('span', { class: 'tb-ctab-label' }, x.label))));
}

// 押せる見出し付きの区分。key：'area' | 'status'、v：その値
function group(key, v, title, items, cardOpts, extra = {}) {
  const id = `${key}:${v}`;
  const pickable = !(v === NONE || (key === 'status' && v === 'done'));
  const isPicked = picked === id;
  return h('section', { class: 'tb-sec' + (extra.cls ? ` ${extra.cls}` : ''), 'data-group-value': v === NONE ? '' : v },
    sectionHead(title, items.length + (extra.more || 0), pickable
      ? { picked: isPicked, onPick: () => { picked = isPicked ? null : id; extra.rerender(); } }
      : {}),
    h('div', { class: 'tb-cards' },
      items.map((x) => cardOpts(x)),
      extra.empty && !items.length ? h('p', { class: 'tb-empty' }, 'なし') : null,
      extra.more ? h('p', { class: 'tb-empty' }, `ほか${extra.more}件`) : null));
}

// 用途タブ
function areaTab(scoped, opts) {
  const list = showDone ? scoped : scoped.filter(isOpen);
  const order = [...AREAS, NONE].filter((v) => !areaFilter || list.some((x) => (x.area || NONE) === v));
  const buckets = new Map(order.map((v) => [v, []]));
  for (const x of list) buckets.get(x.area || NONE)?.push(x);
  for (const items of buckets.values()) items.sort(compareTasks);

  const bar = h('div', { class: 'tb-listbar' },
    h('button', {
      type: 'button',
      class: 'tb-btn tb-toggle' + (showDone ? ' is-active' : ''),
      'aria-pressed': String(showDone),
      onclick: () => { showDone = !showDone; opts.rerender(); },
    }, showDone ? '✓ 完了を表示' : '完了を表示'));
  const sections = [...buckets.entries()].map(([v, items]) =>
    group('area', v, v === NONE ? '未設定' : v, items, (x) => taskCard(x, { hide: ['area'] }), { rerender: opts.rerender }));
  return [bar, sections.length ? h('div', { class: 'tb-groups' }, sections) : h('p', { class: 'tb-empty' }, 'タスクはありません')];
}

// 進捗タブ
function statusTab(scoped, opts) {
  const cols = STATUSES.map(({ value, label }) => {
    let items = scoped.filter((x) => (x.status || 'todo') === value);
    let more = 0;
    if (value === 'done') ({ items, more } = doneItems(items));
    else items.sort(compareTasks);
    return group('status', value, label, items, (x) => addMoves(taskCard(x, { hide: ['status'] }), x),
      { cls: `tb-bcol tb-bcol--${value}`, more, empty: true, rerender: opts.rerender });
  });
  return [h('div', { class: 'tb-prog' }, cols)];
}

export function renderList(container, tasks, opts) {
  const params = opts.params || {};
  const sig = JSON.stringify(params);
  if (sig !== lastParams) { lastParams = sig; areaFilter = params.area || null; picked = null; }

  const tab = loadTab();
  const scoped = areaFilter ? tasks.filter((x) => x.area === areaFilter) : tasks;

  // 入力欄の初期値：絞り込んだ用途＋選んだ見出し
  const base = areaFilter ? { area: areaFilter } : {};
  if (picked && !picked.startsWith(`${tab}:`)) picked = null;
  if (picked && tab === 'area' && areaFilter && picked !== `area:${areaFilter}`) picked = null;
  const pickedVal = picked ? picked.slice(tab.length + 1) : null;
  opts.setContext({ ...base, ...(pickedVal ? { [tab]: pickedVal } : {}) });

  const filterBar = areaFilter
    ? h('div', { class: 'tb-filterbar' },
      areaDot(areaFilter),
      h('span', {}, `${areaFilter}で絞り込み中`),
      h('button', {
        type: 'button',
        class: 'tb-x',
        'aria-label': '絞り込みを解除',
        onclick: () => { areaFilter = null; if (opts.navigate) opts.navigate('list', {}); else opts.rerender(); },
      }, '×'))
    : null;

  container.replaceChildren(h('div', { class: 'tb-list' },
    filterBar,
    tabStrip(tab, opts.rerender),
    h('div', { class: `tb-ctab-panel is-${tab}`, id: 'tb-ctab-panel', role: 'tabpanel', 'aria-labelledby': `tb-ctab-${tab}` },
      tab === 'status' ? statusTab(scoped, opts) : areaTab(scoped, opts))));
}
