// 画面「今日」＝今日から先の予定。担当：画面役。
// renderToday(container, tasks, opts)：opts = { group, setGroup, setContext, rerender }
// 上から 期限切れ → 今日（持ち越し含む） → 明日 → それ以降（日付ごと） → 進行中 → 受信箱 → 今日終えたもの。
// 1つのタスクは上の区分の1か所だけに出す（設計書 6章）。
// 「明日」より先は、やる日（doDate）があればその日、なければ締切（dueDate）の日に置く。
// 引きずって動かす：「今日」「明日」「日付ごとの見出し」へ落とすと、やる日をその日に。同じ区分の中の上下は順番（order）。
//   期限切れ・進行中・受信箱・今日終えたもの へは落とせない。受信箱・進行中からは引きずり出せる（期限切れは動かしても期限切れに残るので動かさない）
// 上に「並び替え▼」（tb.sort.today）。各区分の中の並びにだけ効く。
import { todayKey, toKey, addDays, label } from '../dates.js';
import { h, isOpen, taskCard, sectionHead } from './card.js';
import { loadSort, saveSort, sorter, sortSelect } from './sort.js';
import { enableDrag, dropToDay } from './dnd.js';

const AHEAD = 14; // 最初に出すのは何日先まで（それより先は「もっと見る」）

let projFilter = null; // 「動いているプロジェクト」で絞り込み中の名前
let doneOpen = false; // 「今日終えたもの」を開いているか
let showFar = false; // 15日先以降も出しているか

// drop：落とせる区分の名前（'today' 'tomorrow' 日付）。noDrop：落とせない区分の名前。fixed：行を引きずれない
function section(title, list, cardOpts, attrs = {}, dnd = {}) {
  const cards = list.map((x) => {
    const c = taskCard(x, cardOpts?.(x));
    if (dnd.fixed) c.dataset.drag = 'no';
    return c;
  });
  return h('section', {
    class: 'tb-sec',
    ...attrs,
    'data-drop': dnd.drop || dnd.noDrop,
    'data-drop-ok': !!dnd.drop,
  },
  sectionHead(title, list.length),
  list.length ? h('div', { class: 'tb-cards' }, cards) : null,
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
  const mode = loadSort('today');
  const cmp = sorter(mode);

  // 動いているプロジェクト（未完了がある）
  const projCount = new Map();
  for (const x of open) if (x.project) projCount.set(x.project, (projCount.get(x.project) || 0) + 1);
  const projects = [...projCount.keys()].sort((a, b) => a.localeCompare(b, 'ja'));
  if (projFilter && !projCount.has(projFilter)) projFilter = null;

  const inScope = (x) => !projFilter || x.project === projFilter;
  const used = new Set();
  const take = (pred) => {
    const list = open.filter((x) => !used.has(x.id) && inScope(x) && pred(x)).sort(cmp);
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

  const topBar = h('div', { class: 'tb-today-top' },
    projects.length ? h('span', { class: 'tb-projs-label' }, '動いているプロジェクト') : null,
    sortSelect('today', mode, () => opts.rerender()));

  const chips = projects.length
    ? h('div', { class: 'tb-projs', role: 'group', 'aria-label': '動いているプロジェクト' },
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
    shownDays.map((d) => section(label(d), byDay.get(d), dayCard, { 'data-day': d }, { drop: d })),
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

  doneBox.dataset.drop = 'done';

  const root = h('div', { class: 'tb-today' },
    topBar,
    chips,
    filterBar,
    section('期限切れ', overdue, null, { 'data-sec': 'overdue' }, { noDrop: 'overdue', fixed: true }),
    section('今日', today, (x) => ({ badges: x.doDate && x.doDate < t ? ['持ち越し'] : [], hide: x.doDate && x.doDate >= t ? ['doDate'] : [] }), { 'data-sec': 'today' }, { drop: 'today' }),
    section('明日', tmr, dayCard, { 'data-sec': 'tomorrow' }, { drop: 'tomorrow' }),
    ahead,
    h('h2', { class: 'tb-divider' }, '日付なし'),
    section('進行中', doing, null, { 'data-sec': 'doing' }, { noDrop: 'doing' }),
    section('受信箱', inbox, null, { 'data-sec': 'inbox' }, { noDrop: 'inbox' }),
    doneBox,
  );

  // 区分の名前 → やる日
  const dateOf = (k) => (k === 'today' ? t : k === 'tomorrow' ? tomorrow : /^\d{4}-\d{2}-\d{2}$/.test(k) ? k : null);
  const setManual = () => { saveSort('today', 'manual'); opts.rerender(); };
  enableDrag(root, {
    rootSel: '.tb-today',
    onDrop: (ev) => dropToDay(ev, { mode: loadSort('today'), sameZoneSetsDate: false, dateOf, setManual }),
    // Alt+←/→：前後の日へ（今日より前には戻さない。受信箱・進行中からは → で今日へ）
    onKey: (id, key, dir) => {
      const from = dateOf(key);
      const day = from ? addDays(from, dir) : dir > 0 ? t : null;
      if (!day || day < t) return;
      dropToDay({ id, fromKey: key, toKey: day, finalIds: [id] }, { mode: loadSort('today'), sameZoneSetsDate: false, dateOf, setManual });
    },
  });
  container.replaceChildren(root);
}
