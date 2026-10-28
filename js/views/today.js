// 画面「今日」＝今日から先の予定。担当：画面役。
// renderToday(container, tasks, opts)：opts = { group, setGroup, setContext, rerender }
// 上から 期限切れ → 今日（持ち越し含む） → 明日 → それ以降（日付ごと） → 進行中 → 受信箱 → 今日終えたもの。
// 1つのタスクは上の区分の1か所だけに出す（設計書 6章）。
// 「明日」より先は、やる日（doDate）があればその日、なければ締切（dueDate）の日に置く。
import { todayKey, toKey, addDays, label } from '../dates.js';
import { h, isOpen, compareTasks, taskCard, sectionHead } from './card.js';

const AHEAD = 14; // 最初に出すのは何日先まで（それより先は「もっと見る」）

let projFilter = null; // 「動いているプロジェクト」で絞り込み中の名前
let doneOpen = false; // 「今日終えたもの」を開いているか
let showFar = false; // 15日先以降も出しているか

function section(title, list, cardOpts, attrs = {}) {
  return h('section', { class: 'tb-sec', ...attrs },
    sectionHead(title, list.length),
    list.length ? h('div', { class: 'tb-cards' }, list.map((x) => taskCard(x, cardOpts?.(x)))) : null,
  );
}

// 日付の区分に置いた行：やる日で置いたものは日付を省き、締切だけで置いたものは〆を目立たせる
const dayCard = (x) => (x.doDate ? { hide: ['doDate'] } : { dueMark: true });
const placeKey = (x) => x.doDate || x.dueDate;

export function renderToday(container, tasks, opts) {
  const t = todayKey();
  const tomorrow = addDays(t, 1);
  const limit = addDays(t, AHEAD);
  const open = tasks.filter(isOpen);

  // 動いているプロジェクト（未完了がある）
  const projCount = new Map();
  for (const x of open) if (x.project) projCount.set(x.project, (projCount.get(x.project) || 0) + 1);
  const projects = [...projCount.keys()].sort((a, b) => a.localeCompare(b, 'ja'));
  if (projFilter && !projCount.has(projFilter)) projFilter = null;

  const inScope = (x) => !projFilter || x.project === projFilter;
  const used = new Set();
  const take = (pred) => {
    const list = open.filter((x) => !used.has(x.id) && inScope(x) && pred(x)).sort(compareTasks);
    for (const x of list) used.add(x.id);
    return list;
  };
  const overdue = take((x) => x.dueDate && x.dueDate < t);
  const today = take((x) => (x.doDate && x.doDate <= t) || x.dueDate === t);
  const tmr = take((x) => placeKey(x) === tomorrow);
  const later = take((x) => placeKey(x) > tomorrow);
  const doing = take((x) => x.status === 'doing');
  const inbox = take((x) => !x.doDate && !x.area && !x.project);
  const doneToday = tasks
    .filter((x) => !isOpen(x) && inScope(x) && x.completedAt && toKey(new Date(x.completedAt)) === t)
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  // それ以降：日付ごとにまとめる（日付の早い順）
  const byDay = new Map();
  for (const x of later) {
    const d = placeKey(x);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(x);
  }
  const days = [...byDay.keys()].sort();
  const near = days.filter((d) => d <= limit);
  const far = days.filter((d) => d > limit);
  const farCount = far.reduce((n, d) => n + byDay.get(d).length, 0);
  const shownDays = showFar ? days : near;

  // 今日の画面で名前だけ追加したら受信箱へ（受け入れ基準4）。プロジェクトで絞り込み中だけ、そのプロジェクトを付ける
  opts.setContext(projFilter ? { project: projFilter } : {});

  const chips = projects.length
    ? h('div', { class: 'tb-projs', role: 'group', 'aria-label': '動いているプロジェクト' },
      h('span', { class: 'tb-projs-label' }, '動いているプロジェクト'),
      projects.map((p) => h('button', {
        type: 'button',
        class: 'tb-chip' + (projFilter === p ? ' is-active' : ''),
        'aria-pressed': String(projFilter === p),
        onclick: () => { projFilter = projFilter === p ? null : p; opts.rerender(); },
      }, p, h('span', { class: 'tb-chip-n' }, String(projCount.get(p))))))
    : null;

  const filterBar = projFilter
    ? h('div', { class: 'tb-filter' },
      h('span', {}, `「${projFilter}」だけを表示中`),
      h('button', { type: 'button', class: 'tb-link', onclick: () => { projFilter = null; opts.rerender(); } }, '解除'))
    : null;

  const ahead = h('div', { class: 'tb-ahead', 'aria-label': 'それ以降' },
    shownDays.map((d) => section(label(d), byDay.get(d), dayCard, { 'data-day': d })),
    farCount
      ? h('button', {
        type: 'button',
        class: 'tb-btn tb-more',
        'aria-expanded': String(showFar),
        onclick: () => { showFar = !showFar; opts.rerender(); },
      }, showFar ? `${AHEAD}日先までにする` : `もっと見る（${AHEAD}日より先 ${farCount}件）`)
      : null);

  const doneBox = h('details', { class: 'tb-done-box', open: doneOpen || null },
    h('summary', {}, `今日終えたもの（${doneToday.length}）`),
    doneToday.length ? h('div', { class: 'tb-cards' }, doneToday.map((x) => taskCard(x))) : h('p', { class: 'tb-empty' }, 'まだありません'));
  doneBox.addEventListener('toggle', () => { doneOpen = doneBox.open; });

  container.replaceChildren(h('div', { class: 'tb-today' },
    chips,
    filterBar,
    section('期限切れ', overdue, null, { 'data-sec': 'overdue' }),
    section('今日', today, (x) => ({ badges: x.doDate && x.doDate < t ? ['持ち越し'] : [], hide: x.doDate && x.doDate >= t ? ['doDate'] : [] }), { 'data-sec': 'today' }),
    section('明日', tmr, dayCard, { 'data-sec': 'tomorrow' }),
    ahead,
    h('h2', { class: 'tb-divider' }, '日付なし'),
    section('進行中', doing, null, { 'data-sec': 'doing' }),
    section('受信箱', inbox, null, { 'data-sec': 'inbox' }),
    doneBox,
  ));
}
