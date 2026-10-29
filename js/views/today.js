// 画面「今日」＝今日から先の予定。担当：画面役。
// renderToday(container, tasks, opts)：opts = { group, setGroup, setContext, rerender }
// 上から 期限切れ → 今日（持ち越し含む） → 明日 → それ以降（日付ごと） → 進行中 → 受信箱 → 今日終えたもの。
// 1つのタスクは上の区分の1か所だけに出す（設計書 6章）。
// 「明日」より先は、やる日（doDate）があればその日、なければ締切（dueDate）の日に置く。
// 引きずって動かす：「今日」「明日」「日付ごとの見出し」へ落とすと、やる日をその日に。同じ区分の中の上下は順番（order）。
//   期限切れ・進行中・受信箱・今日終えたもの へは落とせない。受信箱・進行中からは引きずり出せる（期限切れは動かしても期限切れに残るので動かさない）
// 上に「並び替え▼」（tb.sort.today）。各区分の中の並びにだけ効く。
// 期限切れは「期限切れ N件 ▸」の1行だけ。押すと中身が伸びる（開いたかは tb.overdueOpen）。
//   中の上に一括ボタン「全部今日へ／全部明日へ／日付なしへ」（やる日と締切の両方を書き換える）。2回押し。
//   書いた直後に「◯件を動かしました・元に戻す」（元のやる日・締切に戻す）。
import { todayKey, toKey, addDays, label } from '../dates.js';
import { h, isOpen, taskCard, sectionHead } from './card.js';
import { loadSort, saveSort, sorter, sortSelect } from './sort.js';
import { enableDrag, dropToDay } from './dnd.js';
import { updateMany } from '../store.js';
import { showToast } from '../toast.js';

const AHEAD = 14; // 最初に出すのは何日先まで（それより先は「もっと見る」）

let projFilter = null; // 「動いているプロジェクト」で絞り込み中の名前
let doneOpen = false; // 「今日終えたもの」を開いているか
let showFar = false; // 15日先以降も出しているか
let armed = null; // 一括ボタンを1回押した：'today' | 'tomorrow' | 'none'
let armTimer = 0;

function loadOverdueOpen() {
  try { return localStorage.getItem('tb.overdueOpen') === '1'; } catch { return false; }
}
function saveOverdueOpen(v) {
  try { localStorage.setItem('tb.overdueOpen', v ? '1' : '0'); } catch { /* 保存できなくても動く */ }
}

const BULK = [
  { key: 'today', label: '全部今日へ', done: '今日へ' },
  { key: 'tomorrow', label: '全部明日へ', done: '明日へ' },
  { key: 'none', label: '日付なしへ', done: '日付なしへ' },
];

// 期限切れをまとめて動かす。元の日付を覚えておき、「元に戻す」で戻す
function moveAll(list, key, t) {
  const day = key === 'today' ? t : key === 'tomorrow' ? addDays(t, 1) : null;
  const before = list.map((x) => ({ id: x.id, patch: { doDate: x.doDate || null, dueDate: x.dueDate || null } }));
  const fail = (e) => { console.warn('[task-board] 一括の書き換えに失敗', e); showToast(`動かせませんでした（${e.message || e}）`); };
  updateMany(list.map((x) => ({ id: x.id, patch: { doDate: day, dueDate: day } }))).catch(fail);
  const label = BULK.find((b) => b.key === key).done;
  showToast(`${list.length}件を${label}動かしました`, {
    action: '元に戻す',
    onAction: () => updateMany(before).catch(fail),
  });
}

// 期限切れ：畳んだ1行＋中身
function overdueBox(list, t, opts) {
  if (!list.length) return null;
  const open = loadOverdueOpen();
  const head = h('h2', { class: 'tb-od-head' },
    h('button', {
      type: 'button',
      class: 'tb-od-btn',
      'aria-expanded': String(open),
      'aria-controls': 'tb-od-body',
      onclick: () => { saveOverdueOpen(!open); armed = null; opts.rerender(); },
    },
    h('span', { class: 'tb-od-title' }, '期限切れ'),
    h('span', { class: 'tb-od-n' }, `${list.length}件`),
    h('span', { class: 'tb-od-chev', 'aria-hidden': 'true' }, open ? '▾' : '▸')));
  if (!open) return h('section', { class: 'tb-sec tb-od', 'data-sec': 'overdue' }, head);

  const bulk = h('div', { class: 'tb-od-bulk', role: 'group', 'aria-label': '期限切れをまとめて動かす' },
    BULK.map((b) => h('button', {
      type: 'button',
      class: 'tb-btn tb-od-move' + (armed === b.key ? ' is-armed' : ''),
      'data-bulk': b.key,
      onclick: () => {
        clearTimeout(armTimer);
        if (armed !== b.key) {
          armed = b.key;
          armTimer = setTimeout(() => { armed = null; opts.rerender(); }, 5000);
          opts.rerender();
          return;
        }
        armed = null;
        moveAll(list, b.key, t);
      },
    }, b.label)));
  const hint = armed
    ? h('p', { class: 'tb-od-hint', role: 'status' }, `もう一度押すと${list.length}件を動かします`)
    : null;
  const cards = list.map((x) => {
    const c = taskCard(x);
    c.dataset.drag = 'no';
    return c;
  });
  return h('section', { class: 'tb-sec tb-od is-open', 'data-sec': 'overdue', 'data-drop': 'overdue', 'data-drop-ok': false },
    head,
    h('div', { class: 'tb-od-body', id: 'tb-od-body' }, bulk, hint, h('div', { class: 'tb-cards' }, cards)));
}

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
    overdueBox(overdue, t, opts),
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
