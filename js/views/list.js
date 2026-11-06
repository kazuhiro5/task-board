// 画面「一覧」。担当：画面役。
// renderList(container, tasks, opts)：opts = { group, setGroup, setContext, rerender, params, navigate }
// 上の切り替えで「用途」「用途なし」「進捗」を選ぶ（選んだタブは localStorage の tb.listTab）。
// 用途タブの「完了を表示」の横の「絞り込み」で用途を選ぶと、その用途の一覧へ（用途なし・進捗のタブには出さない）。
//   用途：用途ごとのグループ（大学…勉強→未設定）。「完了を表示」で完了も出す
//   進捗：状態ごと（未着手・進行中・待ち・完了）。本文が広い時は4列、狭い時は見出し付きの縦のリスト
//   用途なし：用途の付いていない未完了（ほかのタブで埋もれがちなもの）。進捗ごと
// opts.params.area があれば、その用途に絞って出す（「就活で絞り込み中 ×」で解除）。
// 見出しを押すと「ここに追加」（入力欄の初期値をその用途・状態にする）。
import { STATUSES } from '../constants.js';
import { areaNames, addArea } from '../store.js';
import { h, isOpen, compareTasks, taskCard, sectionHead, areaDot, inlineAdder } from './card.js';
import { addMoves, doneItems } from './modes.js';

const TABS = [
  { value: 'area', label: '用途' },
  { value: 'noarea', label: '用途なし' },
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
    if (v === 'nodate') return 'noarea'; // 前の「日付なし」を選んでいた端末
    return TABS.some((x) => x.value === v) ? v : 'area';
  } catch { return 'area'; }
}
function saveTab(v) {
  try { localStorage.setItem('tb.listTab', v); } catch { /* 保存できなくても動く */ }
}

// プロジェクトの表示の切り替え（modes.js の modeBar）と同じ丸い切り替えにそろえる
function tabStrip(cur, rerender) {
  return h('div', { class: 'tb-seg tb-modes', role: 'tablist', 'aria-label': '一覧の切り替え' },
    TABS.map((x) => h('button', {
      type: 'button',
      role: 'tab',
      id: `tb-ctab-${x.value}`,
      class: 'tb-seg-btn' + (x.value === cur ? ' is-active' : ''),
      'aria-selected': String(x.value === cur),
      'aria-controls': 'tb-ctab-panel',
      'data-tab': x.value,
      onclick: () => { if (x.value !== cur) { saveTab(x.value); picked = null; rerender(); } },
    }, x.label)));
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

// 用途ごとに分ける（areaNames の順 → 一覧に無い用途 → 未設定）
function byArea(list) {
  const names = areaNames();
  // 一覧に無い用途（消した用途の古いタスクなど）も、未設定の前に出す
  const unknown = [...new Set(list.map((x) => x.area).filter((a) => a && !names.includes(a)))];
  const order = [...names, ...unknown, NONE].filter((v) => !areaFilter || list.some((x) => (x.area || NONE) === v));
  const buckets = new Map(order.map((v) => [v, []]));
  for (const x of list) buckets.get(x.area || NONE)?.push(x);
  for (const items of buckets.values()) items.sort(compareTasks);
  return buckets;
}

// 絞り込み：用途を選ぶと、左の一覧でその用途を押した時と同じ画面へ（×で一覧に戻る）
function areaPick(opts) {
  const pick = h('select', {
    class: 'tb-filter-select' + (areaFilter ? ' is-on' : ''), 'aria-label': '絞り込み',
    onchange: (e) => { const v = e.target.value; if (opts.navigate) opts.navigate('list', v ? { area: v } : {}); },
  },
  h('option', { value: '' }, '絞り込み：すべて'),
  areaNames().map((a) => h('option', { value: a }, a)));
  pick.value = areaFilter || '';
  return pick;
}

// 用途タブ
function areaTab(scoped, opts) {
  const list = showDone ? scoped : scoped.filter(isOpen);
  const buckets = byArea(list);

  const bar = h('div', { class: 'tb-listbar' },
    h('button', {
      type: 'button',
      class: 'tb-btn tb-toggle' + (showDone ? ' is-active' : ''),
      'aria-pressed': String(showDone),
      onclick: () => { showDone = !showDone; opts.rerender(); },
    }, showDone ? '✓ 完了を表示' : '完了を表示'),
    areaPick(opts),
    // スマホ幅（左の一覧が無い）だけ出す
    h('div', { class: 'tb-narrow-only tb-adder-wrap' }, inlineAdder('list-area', {
      label: '＋ 用途を追加', placeholder: '用途の名前', onAdd: addArea, rerender: opts.rerender,
    })));
  const sections = [...buckets.entries()].map(([v, items]) =>
    group('area', v, v === NONE ? '未設定' : v, items, (x) => taskCard(x, { hide: ['area'] }), { rerender: opts.rerender }));
  return [bar, sections.length ? h('div', { class: 'tb-groups is-rows' }, sections) : h('p', { class: 'tb-empty' }, 'タスクはありません')];
}

// 用途なしタブ：用途の付いていない未完了。進捗（状態）ごとに分け、中身の無い状態は出さない
function noareaTab(scoped, opts) {
  const list = scoped.filter((x) => isOpen(x) && !x.area).sort(compareTasks);
  const sections = STATUSES.filter((s) => s.value !== 'done')
    .map(({ value, label }) => [value, label, list.filter((x) => (x.status || 'todo') === value)])
    .filter(([, , items]) => items.length)
    .map(([value, label, items]) => group('noarea', value, label, items, (x) => taskCard(x, { hide: ['status'] }), { rerender: opts.rerender }));
  return [sections.length
    ? h('div', { class: 'tb-groups is-rows' }, sections)
    : h('p', { class: 'tb-empty' }, '用途の無いタスクはありません')];
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
  if (picked && tab !== 'status' && areaFilter && picked !== `${tab}:${areaFilter}`) picked = null;
  const pickedVal = picked ? picked.slice(tab.length + 1) : null;
  // 用途なしタブの見出しは状態（「ここに追加」で、その状態の用途なしのタスクになる）
  const ctxKey = tab === 'noarea' ? 'status' : tab;
  opts.setContext({ ...base, ...(pickedVal ? { [ctxKey]: pickedVal } : {}) });

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
    h('div', { class: 'tb-list-top' }, tabStrip(tab, opts.rerender)),
    h('div', { class: `tb-ctab-panel is-${tab}`, id: 'tb-ctab-panel', role: 'tabpanel', 'aria-labelledby': `tb-ctab-${tab}` },
      tab === 'status' ? statusTab(scoped, opts) : tab === 'noarea' ? noareaTab(scoped, opts) : areaTab(scoped, opts))));
}
