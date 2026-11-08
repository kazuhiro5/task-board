// 画面「週」。担当：画面役。
// renderWeek(container, tasks, opts)：opts = { group, setGroup, setContext, rerender }
// 月〜日の7列。やる日の列に置き、締切の日には「〆」付きで出す。PCは横並び、スマホは縦。
// 行を別の日の列へ引きずる → やる日をその日に。同じ日の中で上下 → 順番（order）。〆だけの行も、引きずるとやる日が入る。
// 日の中は、引きずって決めた順（手動）だけ。並び替えの欄は置かない（引きずれば並べ替えられるため）。
// 上に「日付なし」（やる日の無い未完了）を2行の帯で並べ、横に流す。日の列へ引きずるとやる日が入る。
//   帯へは落とせない（日付を消すのは編集で）。件数が多い時は「すべて表示」で折り返して全部出す。
//   ふだんは「日付なし N件 ▸」のボタンだけ（帯が出ていると、週の予定より先に目に入るため）。
import { todayKey, addDays, weekDays, label, fromKey } from '../dates.js';
import { h, isOpen, compareTasks, taskCard, md } from './card.js';
import { sorter } from './sort.js';
import { enableDrag, dayDrag } from './dnd.js';

let weekOffset = 0; // 0＝今週、-1＝前の週、1＝次の週
let pickedDay = null; // 見出しを押して「ここに追加」にした日
let stripOpen = false; // 日付なしを開いているか（ふだんは閉じて、週の予定を先に見せる）
let stripAll = false; // 日付なしの帯を折り返して全部出しているか

// 日付なしの帯。PCのマウスでは横に流しにくいので、左右の送りボタンを付ける
// プロジェクトのカレンダー（modes.js）でも使う。opts は rerender があればよい
export function noDateStrip(tasks, cmp, opts) {
  const items = tasks.filter((x) => isOpen(x) && !x.doDate).sort(cmp);
  if (!items.length) return null;
  const toggle = h('button', {
    type: 'button', class: 'tb-btn tb-strip-toggle' + (stripOpen ? ' is-active' : ''), 'aria-expanded': String(stripOpen),
    onclick: () => { stripOpen = !stripOpen; opts.rerender(); },
  }, `日付なし ${items.length}件 ${stripOpen ? '▾' : '▸'}`);
  if (!stripOpen) return h('div', { class: 'tb-strip is-closed' }, toggle);
  const scroller = h('div', { class: 'tb-strip-cards tb-cards' + (stripAll ? ' is-all' : '') },
    items.map((x) => taskCard(x, { hide: ['doDate'], areaInMeta: true, memoPreview: true })));
  const step = (dir) => scroller.scrollBy({ left: dir * scroller.clientWidth * 0.8, behavior: 'smooth' });
  return h('section', { class: 'tb-strip', 'data-drop': 'nodate', 'aria-label': '日付なし' },
    h('div', { class: 'tb-strip-head' },
      toggle,
      h('span', { class: 'tb-strip-hint' }, '日の列へ引きずると、やる日が入ります'),
      stripAll ? null : h('button', { type: 'button', class: 'tb-btn tb-strip-arrow', 'aria-label': '左へ', onclick: () => step(-1) }, '‹'),
      stripAll ? null : h('button', { type: 'button', class: 'tb-btn tb-strip-arrow', 'aria-label': '右へ', onclick: () => step(1) }, '›'),
      h('button', {
        type: 'button', class: 'tb-btn tb-strip-all', 'aria-pressed': String(stripAll),
        onclick: () => { stripAll = !stripAll; opts.rerender(); },
      }, stripAll ? 'たたむ' : 'すべて表示')),
    scroller);
}

export function renderWeek(container, tasks, opts) {
  const t = todayKey();
  const days = weekDays(addDays(t, weekOffset * 7));
  if (pickedDay && !days.includes(pickedDay)) pickedDay = null;
  opts.setContext({ doDate: pickedDay || t });

  const mode = 'manual';
  const cmp = sorter(mode);
  const go = (n) => { weekOffset = n; opts.rerender(); };
  const nav = h('div', { class: 'tb-weeknav' },
    h('button', { type: 'button', class: 'tb-btn', onclick: () => go(weekOffset - 1) }, '‹ 前の週'),
    h('button', { type: 'button', class: 'tb-btn' + (weekOffset === 0 ? ' is-active' : ''), 'aria-pressed': String(weekOffset === 0), onclick: () => go(0) }, '今週'),
    h('button', { type: 'button', class: 'tb-btn', onclick: () => go(weekOffset + 1) }, '次の週 ›'),
    h('span', { class: 'tb-weekrange' }, `${md(days[0])} 〜 ${md(days[6])}`),
  );

  const cols = days.map((d) => {
    const planned = tasks.filter((x) => isOpen(x) && x.doDate === d).sort(cmp);
    const dueOnly = tasks.filter((x) => isOpen(x) && x.dueDate === d && x.doDate !== d).sort(cmp);
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
    return h('section', {
      class: 'tb-day' + (d === t ? ' is-today' : '') + (picked ? ' is-picked' : ''), 'data-day': d, 'data-drop': d, 'data-drop-ok': true,
      title: 'ダブルクリックでこの日に追加',
      // 空いている所をダブルクリック → この日をやる日にして入力欄を開く（タスクの上では開かない）
      ondblclick: (e) => {
        if (e.target.closest('.tb-card, button')) return;
        pickedDay = d;
        opts.setContext({ doDate: d });
        opts.rerender();
        document.dispatchEvent(new CustomEvent('tb:add-open'));
      },
    },
      head,
      h('div', { class: 'tb-cards' },
        planned.map((x) => taskCard(x, { hide: ['doDate'] })),
        dueOnly.map((x) => taskCard(x, { dueMark: true })),
        done.map((x) => taskCard(x, { hide: ['doDate'] })),
        n ? null : h('p', { class: 'tb-empty' }, 'なし')));
  });

  const root = h('div', { class: 'tb-week' }, nav, noDateStrip(tasks, cmp, opts), h('div', { class: 'tb-days' }, cols));
  enableDrag(root, dayDrag('.tb-week', () => 'manual', () => opts.rerender()));
  container.replaceChildren(root);
}

