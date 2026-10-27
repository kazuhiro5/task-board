// 画面「週」。担当：画面役。
// renderWeek(container, tasks, opts)：opts = { group, setGroup, setContext, rerender }
// 月〜日の7列。やる日の列に置き、締切の日には「〆」付きで出す。PCは横並び、スマホは縦。
import { todayKey, addDays, weekDays, label, fromKey } from '../dates.js';
import { h, isOpen, compareTasks, taskCard, md } from './card.js';

let weekOffset = 0; // 0＝今週、-1＝前の週、1＝次の週
let pickedDay = null; // 見出しを押して「ここに追加」にした日

export function renderWeek(container, tasks, opts) {
  const t = todayKey();
  const days = weekDays(addDays(t, weekOffset * 7));
  if (pickedDay && !days.includes(pickedDay)) pickedDay = null;
  opts.setContext({ doDate: pickedDay || t });

  const go = (n) => { weekOffset = n; opts.rerender(); };
  const nav = h('div', { class: 'tb-weeknav' },
    h('button', { type: 'button', class: 'tb-btn', onclick: () => go(weekOffset - 1) }, '‹ 前の週'),
    h('button', { type: 'button', class: 'tb-btn' + (weekOffset === 0 ? ' is-active' : ''), 'aria-pressed': String(weekOffset === 0), onclick: () => go(0) }, '今週'),
    h('button', { type: 'button', class: 'tb-btn', onclick: () => go(weekOffset + 1) }, '次の週 ›'),
    h('span', { class: 'tb-weekrange' }, `${md(days[0])} 〜 ${md(days[6])}`),
  );

  const cols = days.map((d) => {
    const planned = tasks.filter((x) => isOpen(x) && x.doDate === d).sort(compareTasks);
    const dueOnly = tasks.filter((x) => isOpen(x) && x.dueDate === d && x.doDate !== d).sort(compareTasks);
    const done = tasks.filter((x) => !isOpen(x) && x.doDate === d).sort(compareTasks);
    const picked = pickedDay === d;
    const wd = fromKey(d).getDay();
    const head = h('button', {
      type: 'button',
      class: 'tb-day-head' + (d === t ? ' is-today' : '') + (picked ? ' is-picked' : ''),
      'aria-pressed': String(picked),
      onclick: () => { pickedDay = picked ? null : d; opts.rerender(); },
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

  container.replaceChildren(h('div', { class: 'tb-week' }, nav, h('div', { class: 'tb-days' }, cols)));
}
