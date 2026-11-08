// 画面「ホーム」：今日やることを一目で。上に今日のタスク（期限切れ・持ち越しの件数も）、
// その下に、今スプリントが動いているプロジェクトごとに、今のスプリントの未完了を並べる。
// 「今日」の画面（日付ごとの予定）と分けたのは、プロジェクトの今の期間の作業も一緒に一目で見るため。
import { todayKey, label, addDays } from '../dates.js';
import { h, isOpen, taskCard, sectionHead, md } from './card.js';
import { sorter } from './sort.js';
import { projectNames, currentSprint, hasChildren } from '../store.js';

const manual = sorter('manual');

export function renderHome(container, tasks, opts) {
  opts.setContext({});
  const t = todayKey();
  const open = tasks.filter(isOpen);
  const overdue = open.filter((x) => x.dueDate && x.dueDate < t);
  const carry = open.filter((x) => x.doDate && x.doDate < t && !(x.dueDate && x.dueDate < t));
  const today = open.filter((x) => (x.doDate === t || x.dueDate === t)).sort(manual);
  const doneToday = tasks.filter((x) => !isOpen(x) && x.completedAt && new Date(x.completedAt).toDateString() === new Date().toDateString()).length;

  // 今日：期限切れ・持ち越しは件数だけ（中身は「今日」の画面で）
  const notes = [];
  if (overdue.length) notes.push(h('button', { type: 'button', class: 'tb-home-note is-over', onclick: () => opts.navigate('today', {}) }, `期限切れ ${overdue.length}件 ›`));
  if (carry.length) notes.push(h('button', { type: 'button', class: 'tb-home-note', onclick: () => opts.navigate('today', {}) }, `持ち越し ${carry.length}件 ›`));

  const todaySec = h('section', { class: 'tb-sec tb-sec--today' },
    sectionHead(`今日　${label(t)}`, today.length),
    notes.length ? h('div', { class: 'tb-home-notes' }, notes) : null,
    today.length ? h('div', { class: 'tb-cards' }, today.map((x) => taskCard(x, { hide: ['doDate'] })))
      : h('p', { class: 'tb-empty' }, `今日の予定はありません${doneToday ? `（今日終えたもの ${doneToday}件）` : ''}`));

  // 今のスプリント（プロジェクトごと）。今日の欄に出たものは重ねて出さない
  const shown = new Set(today.map((x) => x.id));
  const sprintSecs = [];
  for (const name of projectNames()) {
    const sp = currentSprint(name);
    if (!sp) continue;
    const inside = tasks.filter((x) => x.project === name && x.sprint === sp.id && !hasChildren(x.id));
    const left = inside.filter((x) => isOpen(x) && !shown.has(x.id)).sort(manual);
    const done = inside.filter((x) => !isOpen(x)).length;
    const head = h('h2', { class: 'tb-sec-head tb-home-phead' },
      h('button', { type: 'button', class: 'tb-sec-btn', onclick: () => opts.navigate('projects', { project: name }) },
        h('span', { class: 'tb-sec-title' }, name),
        h('span', { class: 'tb-home-sp' }, `${sp.name}（${md(sp.start)}〜${md(addDays(sp.start, sp.days - 1))}）`),
        h('span', { class: 'tb-count' }, `${done}/${inside.length}`)));
    sprintSecs.push(h('section', { class: 'tb-sec tb-home-proj' },
      head,
      h('div', { class: 'tb-sp-bar' }, h('i', { style: `width:${inside.length ? (done / inside.length) * 100 : 0}%` })),
      left.length ? h('div', { class: 'tb-cards' }, left.map((x) => taskCard(x, { hide: ['project'] })))
        : h('p', { class: 'tb-empty' }, inside.length ? 'このスプリントの作業は全部終わりました' : 'このスプリントに作業がありません')));
  }

  container.replaceChildren(h('div', { class: 'tb-home' },
    todaySec,
    h('h2', { class: 'tb-divider' }, '今のスプリント'),
    sprintSecs.length ? sprintSecs : h('p', { class: 'tb-empty' }, '今動いているスプリントはありません（プロジェクトの「スプリント」で作れます）')));
}
