// 画面「今日」＝今日から先の予定。担当：画面役。
// renderToday(container, tasks, opts)：opts = { group, setGroup, setContext, rerender }
// 上から 期限切れ → 持ち越し → 昨日のタスク → 今日 → 明日 → それ以降（日付ごと） → 進行中 → 受信箱 → 今日終えたもの。
// 1つのタスクは上の区分の1か所だけに出す（設計書 6章）。
// 「明日」より先は、やる日（doDate）があればその日、なければ締切（dueDate）の日に置く。
// 引きずって動かす：「今日」「明日」「日付ごとの見出し」へ落とすと、やる日をその日に。同じ区分の中の上下は順番（order）。
//   期限切れ・進行中・受信箱・今日終えたもの へは落とせない。受信箱・進行中からは引きずり出せる（期限切れは動かしても期限切れに残るので動かさない）
// 各区分の中は、引きずって決めた順（手動）だけ。並び替えの欄は置かない（引きずれば並べ替えられるため）。
// 期限切れは「期限切れ N件 ▸」の1行だけ。押すと中身が伸びる（開いたかは tb.overdueOpen）。
// 持ち越し（やる日が昨日以前で、締切は過ぎていない）も同じ形の1行（tb.carryOpen）。今日の区分に混ぜると今日やることが埋もれるため。
//   見出しの横に一括ボタン（今日／明日／なし）。期限切れは締切、持ち越しはやる日を書き換える。2回押し。
//   書いた直後に「◯件を動かしました・元に戻す」（元のやる日・締切に戻す）。
import { todayKey, toKey, addDays, label } from '../dates.js';
import { h, isOpen, taskCard, sectionHead } from './card.js';
import { filterPick, projectToggle, visibleTasks } from './filter.js';
import { withRepeats } from './repeats.js';
import { sorter } from './sort.js';
import { enableDrag, dropToDay } from './dnd.js';
import { updateMany, areaNames, projectNames, lastHistory, undo } from '../store.js';
import { showToast } from '../toast.js';

const AHEAD = 14; // 最初に出すのは何日先まで（それより先は「もっと見る」）

let filter = null; // 絞り込み：{ by: 'area'|'project', name } か null
let doneOpen = false; // 「今日終えたもの」を開いているか
let showFar = false; // 15日先以降も出しているか
let armed = null; // 一括ボタンを1回押した所：'overdue:today' のように 区分:行き先
let armTimer = 0;

function loadFlag(k) {
  try { return localStorage.getItem(k) === '1'; } catch { return false; }
}
function saveFlag(k, v) {
  try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* 保存できなくても動く */ }
}

// 持ち越し：畳んだ1行＋中身（期限切れと同じ見た目。今日・明日へ引きずって動かせる）。
// 開いている時だけ、見出しの横にやる日をまとめて動かすボタン（締切は変えない。持ち越しは締切を過ぎていないため。
// 閉じている時も出すと、毎日目に入って邪魔になるため）
function carryBox(list, t, opts) {
  if (!list.length) return null;
  const open = loadFlag('tb.carryOpen');
  const head = h('div', { class: 'tb-od-line' },
    h('h2', { class: 'tb-od-head' },
      h('button', {
        type: 'button', class: 'tb-od-btn tb-carry-btn', 'aria-expanded': String(open), 'aria-controls': 'tb-carry-body',
        onclick: () => { saveFlag('tb.carryOpen', !open); armed = null; opts.rerender(); },
      },
      h('span', { class: 'tb-od-title' }, '持ち越し'),
      h('span', { class: 'tb-od-n' }, `${list.length}件`),
      h('span', { class: 'tb-od-chev', 'aria-hidden': 'true' }, open ? '▾' : '▸'))),
    open ? bulkButtons('carry', list, t, opts) : null);
  if (!open) return h('section', { class: 'tb-sec tb-od tb-carry', 'data-sec': 'carry' }, head);
  return h('section', { class: 'tb-sec tb-od tb-carry is-open', 'data-sec': 'carry', 'data-drop': 'carry', 'data-drop-ok': false },
    head, bulkHint('carry', list),
    h('div', { class: 'tb-od-body', id: 'tb-carry-body' },
      h('div', { class: 'tb-cards' }, list.map((x) => taskCard(x, { badges: ['持ち越し'] })))));
}

// 昨日のタスク：やる日が昨日だったものを、終わったものも含めて全部（昨日どこまでできたかを振り返る）。
// 終わっていないものは持ち越し・期限切れにも出る（ここは振り返り用で、置き場ではないため。引きずって今日などへ動かせる）
function yesterdayBox(list, opts) {
  if (!list.length) return null;
  const open = loadFlag('tb.yesterdayOpen');
  const doneN = list.filter((x) => !isOpen(x)).length;
  const head = h('h2', { class: 'tb-od-head' },
    h('button', {
      type: 'button', class: 'tb-od-btn tb-yest-btn', 'aria-expanded': String(open), 'aria-controls': 'tb-yest-body',
      onclick: () => { saveFlag('tb.yesterdayOpen', !open); opts.rerender(); },
    },
    h('span', { class: 'tb-od-title' }, '昨日のタスク'),
    h('span', { class: 'tb-od-n' }, `${doneN}/${list.length}件済`),
    h('span', { class: 'tb-od-chev', 'aria-hidden': 'true' }, open ? '▾' : '▸')));
  if (!open) return h('section', { class: 'tb-sec tb-od tb-yest', 'data-sec': 'yesterday' }, head);
  return h('section', { class: 'tb-sec tb-od tb-yest is-open', 'data-sec': 'yesterday', 'data-drop': 'yesterday', 'data-drop-ok': false },
    head,
    h('div', { class: 'tb-od-body', id: 'tb-yest-body' },
      h('div', { class: 'tb-cards' }, list.map((x) => taskCard(x, { hide: ['doDate'] })))));
}

function loadOverdueOpen() {
  try { return localStorage.getItem('tb.overdueOpen') === '1'; } catch { return false; }
}
function saveOverdueOpen(v) {
  try { localStorage.setItem('tb.overdueOpen', v ? '1' : '0'); } catch { /* 保存できなくても動く */ }
}

// まとめて動かすボタン（期限切れ・持ち越しの見出しの横）。2回押しで動かす（1回目は押した所が色付きになる）。
//   期限切れ：締切を書き換える（やる日はそのまま。やる日が過ぎていれば、締切が直った後は持ち越しに出る）
//   持ち越し：やる日を書き換える（締切はそのまま）
const BULK = [
  { key: 'today', label: '今日', done: '今日へ' },
  { key: 'tomorrow', label: '明日', done: '明日へ' },
  { key: 'none', label: 'なし', done: '日付なしへ' },
];
const FIELD = { overdue: { field: 'dueDate', name: '締切' }, carry: { field: 'doDate', name: 'やる日' } };

// 元の日付を覚えておき、「元に戻す」で戻す
function moveAll(kind, list, key, t) {
  const day = key === 'today' ? t : key === 'tomorrow' ? addDays(t, 1) : null;
  const { field, name } = FIELD[kind];
  const fail = (e) => { console.warn('[task-board] 一括の書き換えに失敗', e); showToast(`動かせませんでした（${e.message || e}）`); };
  updateMany(list.map((x) => ({ id: x.id, patch: { [field]: day } }))).catch(fail);
  const entry = lastHistory();
  const label = BULK.find((b) => b.key === key).done;
  showToast(`${list.length}件の${name}を${label}`, { action: '元に戻す', onAction: () => undo(entry) });
}

function bulkButtons(kind, list, t, opts) {
  const { name } = FIELD[kind];
  return h('div', { class: 'tb-od-bulk', role: 'group', 'aria-label': `${name}をまとめて動かす` },
    h('span', { class: 'tb-od-bulk-label' }, `${name}→`),
    BULK.map((b) => {
      const id = `${kind}:${b.key}`;
      return h('button', {
        type: 'button',
        class: 'tb-btn tb-od-move' + (armed === id ? ' is-armed' : ''),
        'data-bulk': id, title: `${list.length}件の${name}を${b.done}`,
        onclick: () => {
          clearTimeout(armTimer);
          if (armed !== id) {
            armed = id;
            armTimer = setTimeout(() => { armed = null; opts.rerender(); }, 5000);
            opts.rerender();
            return;
          }
          armed = null;
          moveAll(kind, list, b.key, t);
        },
      }, b.label);
    }));
}
function bulkHint(kind, list) {
  if (!armed || !armed.startsWith(`${kind}:`)) return null;
  const b = BULK.find((x) => `${kind}:${x.key}` === armed);
  return h('p', { class: 'tb-od-hint', role: 'status' }, `もう一度押すと${list.length}件の${FIELD[kind].name}を${b.done}動かします`);
}

// 期限切れ：畳んだ1行＋中身。開いている時だけ、見出しの横に締切をまとめて動かすボタン
function overdueBox(list, t, opts) {
  if (!list.length) return null;
  const open = loadOverdueOpen();
  const head = h('div', { class: 'tb-od-line' },
    h('h2', { class: 'tb-od-head' },
      h('button', {
        type: 'button',
        class: 'tb-od-btn',
        'aria-expanded': String(open),
        'aria-controls': 'tb-od-body',
        onclick: () => { saveOverdueOpen(!open); armed = null; opts.rerender(); },
      },
      h('span', { class: 'tb-od-title' }, '期限切れ'),
      h('span', { class: 'tb-od-n' }, `${list.length}件`),
      h('span', { class: 'tb-od-chev', 'aria-hidden': 'true' }, open ? '▾' : '▸'))),
    open ? bulkButtons('overdue', list, t, opts) : null);
  if (!open) return h('section', { class: 'tb-sec tb-od', 'data-sec': 'overdue' }, head);
  const cards = list.map((x) => {
    const c = taskCard(x);
    c.dataset.drag = 'no';
    return c;
  });
  return h('section', { class: 'tb-sec tb-od is-open', 'data-sec': 'overdue', 'data-drop': 'overdue', 'data-drop-ok': false },
    head, bulkHint('overdue', list),
    h('div', { class: 'tb-od-body', id: 'tb-od-body' }, h('div', { class: 'tb-cards' }, cards)));
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

export function renderToday(container, rawTasks, opts) {
  const t = todayKey();
  // 繰り返しの先の回（予定）も、出している範囲だけ足す（もっと見るを開いた時は60日先まで）
  const tasks = withRepeats(visibleTasks(rawTasks, filter), addDays(t, 1), addDays(t, showFar ? 60 : AHEAD));
  const tomorrow = addDays(t, 1);
  const limit = addDays(t, AHEAD);
  const open = tasks.filter(isOpen);
  const mode = 'manual';
  const cmp = sorter(mode);

  // 絞り込みの選択肢：未完了がある用途（用途の並び）とプロジェクト（左の一覧の並び）
  const count = (k, v) => open.filter((x) => x[k] === v).length;
  const areas = areaNames().filter((a) => count('area', a));
  const projects = projectNames().filter((p) => count('project', p));
  if (filter && !(filter.by === 'area' ? areas : projects).includes(filter.name)) filter = null;

  const inScope = (x) => !filter || x[filter.by] === filter.name;
  const used = new Set();
  const take = (pred) => {
    const list = open.filter((x) => !used.has(x.id) && inScope(x) && pred(x)).sort(cmp);
    for (const x of list) used.add(x.id);
    return list;
  };
  const overdue = take((x) => x.dueDate && x.dueDate < t);
  const yesterdayKey = addDays(t, -1);
  const yesterday = tasks.filter((x) => !x.deletedAt && x.doDate === yesterdayKey && inScope(x))
    .sort((a, b) => (isOpen(a) ? 0 : 1) - (isOpen(b) ? 0 : 1) || cmp(a, b));
  const carry = take((x) => x.doDate && x.doDate < t && x.dueDate !== t);
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

  // 今日の画面で名前だけ追加したら受信箱へ（受け入れ基準4）。絞り込み中だけ、その用途・プロジェクトを付ける
  opts.setContext(filter ? { [filter.by]: filter.name } : {});

  // 絞り込み（今日・週・プロジェクトで同じ部品。filter.js）
  const topBar = h('div', { class: 'tb-today-top' },
    filterPick({ tasks: rawTasks, value: filter, kinds: ['area', 'project'], onChange: (v) => { filter = v; opts.rerender(); } }),
    projectToggle(opts.rerender));
  const chips = null;
  const filterBar = null;

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
    overdue.length || carry.length || yesterday.length
      ? h('div', { class: 'tb-od-wrap' }, overdueBox(overdue, t, opts), carryBox(carry, t, opts), yesterdayBox(yesterday, opts)) : null,
    section(`今日　${label(t)}`, today, (x) => ({ badges: x.doDate && x.doDate < t ? ['持ち越し'] : [], hide: x.doDate && x.doDate >= t ? ['doDate'] : [] }), { 'data-sec': 'today', class: 'tb-sec tb-sec--today' }, { drop: 'today' }),
    section('明日', tmr, dayCard, { 'data-sec': 'tomorrow' }, { drop: 'tomorrow' }),
    ahead,
    h('h2', { class: 'tb-divider' }, '日付なし'),
    section('進行中', doing, null, { 'data-sec': 'doing' }, { noDrop: 'doing' }),
    section('受信箱', inbox, null, { 'data-sec': 'inbox' }, { noDrop: 'inbox' }),
    doneBox,
  );

  // 区分の名前 → やる日
  const dateOf = (k) => (k === 'today' ? t : k === 'tomorrow' ? tomorrow : /^\d{4}-\d{2}-\d{2}$/.test(k) ? k : null);
  const setManual = () => opts.rerender();
  enableDrag(root, {
    rootSel: '.tb-today',
    onDrop: (ev) => dropToDay(ev, { mode: 'manual', sameZoneSetsDate: false, dateOf, setManual }),
    // Alt+←/→：前後の日へ（今日より前には戻さない。受信箱・進行中からは → で今日へ）
    onKey: (id, key, dir) => {
      const from = dateOf(key);
      const day = from ? addDays(from, dir) : dir > 0 ? t : null;
      if (!day || day < t) return;
      dropToDay({ id, fromKey: key, toKey: day, finalIds: [id] }, { mode: 'manual', sameZoneSetsDate: false, dateOf, setManual });
    },
  });
  container.replaceChildren(root);
}
