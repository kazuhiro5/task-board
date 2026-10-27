// 画面「今日」。担当：画面役。
// renderToday(container, tasks, opts)：opts = { group, setGroup, setContext, rerender }
// 上から 期限切れ → 今日 → 進行中 → 受信箱。1つのタスクは上の区分の1か所だけに出す（設計書 6章）。
import { todayKey, toKey } from '../dates.js';
import { h, isOpen, compareTasks, taskCard, sectionHead } from './card.js';

let projFilter = null; // 「動いているプロジェクト」で絞り込み中の名前
let doneOpen = false; // 「今日終えたもの」を開いているか

function section(title, list, cardOpts) {
  return h('section', { class: 'tb-sec' },
    sectionHead(title, list.length),
    list.length ? h('div', { class: 'tb-cards' }, list.map((x) => taskCard(x, cardOpts?.(x)))) : null,
  );
}

export function renderToday(container, tasks, opts) {
  const t = todayKey();
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
  const doing = take((x) => x.status === 'doing');
  const inbox = take((x) => !x.doDate && !x.area && !x.project);
  const doneToday = tasks
    .filter((x) => !isOpen(x) && inScope(x) && x.completedAt && toKey(new Date(x.completedAt)) === t)
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  // 今日の画面で追加したら、やる日＝今日（絞り込み中ならそのプロジェクトも）
  opts.setContext(projFilter ? { doDate: t, project: projFilter } : { doDate: t });

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

  const doneBox = h('details', { class: 'tb-done-box', open: doneOpen || null },
    h('summary', {}, `今日終えたもの（${doneToday.length}）`),
    doneToday.length ? h('div', { class: 'tb-cards' }, doneToday.map((x) => taskCard(x))) : h('p', { class: 'tb-empty' }, 'まだありません'));
  doneBox.addEventListener('toggle', () => { doneOpen = doneBox.open; });

  container.replaceChildren(h('div', { class: 'tb-today' },
    chips,
    filterBar,
    section('期限切れ', overdue),
    section('今日', today, (x) => ({ badges: x.doDate && x.doDate < t ? ['持ち越し'] : [], hide: x.doDate && x.doDate >= t ? ['doDate'] : [] })),
    section('進行中', doing),
    section('受信箱', inbox),
    doneBox,
  ));
}
