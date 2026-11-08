// 画面「ホーム」：今日やることと、プロジェクトの今を一目で。
//   左上：今日のタスクを横に並ぶブロックで（期限切れ・持ち越しは件数のボタンだけ。押すと今日の画面へ）
//   左下：右のカードで選んだプロジェクトの中身。
//         「スプリント一覧」＝今と次のスプリントの作業、「タイムライン一覧」＝大項目とスプリントの期間の横のバー（全体像）
//   右：今日の Google カレンダーの予定と、ミニカレンダー（予定のある日・締切ややる日のある日に点）、その下にプロジェクトのカード（2列）
// 今日のタスクは今日・週と同じく「プロジェクトも表示」に従う（ふだんはプロジェクトの作業を出さない）。
import { todayKey, addDays, fromKey, toKey } from '../dates.js';
import { h, isOpen, md, dueTone, areaDot, toggleDone } from './card.js';
import { sorter } from './sort.js';
import { projectNames, currentSprint, getSprints, sprintState, hasChildren, wbsCode, wbsTree, getCalendarConf } from '../store.js';
import { visibleTasks } from './filter.js';
import { calendarFor } from '../gcal.js';
import { openEdit } from '../edit.js';
import { showWeekOf } from './week.js';

const manual = sorter('manual');
const DAY = 86400000;
let pmode = 'sprint'; // 'sprint' | 'timeline'
let openProject = null;
let miniMonth = null; // 'YYYY-MM'（ミニカレンダーで見ている月）

const daysBetween = (a, b) => Math.round((fromKey(b) - fromKey(a)) / DAY);
const spEnd = (sp) => addDays(sp.start, sp.days);

// ---- 今日のタスク（ブロック） ----
function tile(x, rerender) {
  const done = !isOpen(x);
  const over = !done && x.dueDate && x.dueDate < todayKey();
  const check = h('button', {
    type: 'button', class: 'hm-check', 'aria-label': done ? '未完了に戻す' : '完了にする',
    onclick: (e) => { e.stopPropagation(); toggleDone(x, e.currentTarget.closest('.hm-tile')); },
  }, done ? '✓' : '');
  return h('div', {
    class: 'hm-tile' + (done ? ' is-done' : '') + (over ? ' is-over' : ''), role: 'button', tabindex: '0',
    title: '押すと編集', onclick: () => openEdit(x), onkeydown: (e) => { if (e.key === 'Enter') openEdit(x); },
  },
  h('div', { class: 'hm-tile-top' }, x.area ? areaDot(x.area) : null, x.area || (x.project ? x.project : '用途なし'), check),
  h('div', { class: 'hm-tile-title' }, x.project && wbsCode(x.id) ? h('span', { class: 'tb-wbs-code' }, wbsCode(x.id)) : null, ' ', x.title),
  h('div', { class: 'hm-tile-meta' },
    x.priority === '高' ? h('span', { class: 'tb-tag tb-pri tb-pri--0' }, '優先高') : null,
    x.dueDate ? h('span', { class: 'tb-tag tb-due' + dueTone(x.dueDate, done) }, `〆${md(x.dueDate)}`) : null,
    x.project ? h('span', { class: 'tb-tag tb-tag--proj' }, x.project) : null));
}

// ---- プロジェクト ----
function projectCards(names, cur, rawTasks, rerender) {
  return h('div', { class: 'hm-projs' }, names.map((name) => {
    // 今のスプリントが無い時（始まる前・合間）は、次のスプリントを出す
    const sps = getSprints(name);
    const sp = currentSprint(name) || sps.find((y) => sprintState(y) === 'future') || null;
    const inside = sp ? rawTasks.filter((x) => x.project === name && x.sprint === sp.id && !hasChildren(x.id)) : [];
    const done = inside.filter((x) => !isOpen(x)).length;
    const all = rawTasks.filter((x) => x.project === name && !hasChildren(x.id));
    const allDone = all.filter((x) => !isOpen(x)).length;
    const sub = pmode === 'sprint'
      ? (!sp ? 'スプリントなし'
        : sprintState(sp) === 'now' ? `${sp.name.replace(/（.*）/, '')}・あと${daysBetween(todayKey(), spEnd(sp))}日・${done}/${inside.length}`
          : `次：${sp.name.replace(/（.*）/, '')}・${md(sp.start)}から`)
      : (sps.length ? `${md(sps[0].start)}〜${md(addDays(spEnd(sps[sps.length - 1]), -1))}・作業 ${allDone}/${all.length}` : `作業 ${allDone}/${all.length}`);
    const rate = pmode === 'sprint' ? (inside.length ? done / inside.length : 0) : (all.length ? allDone / all.length : 0);
    return h('button', {
      type: 'button', class: 'hm-pchip' + (cur === name ? ' is-on' : ''),
      onclick: () => {
        openProject = name;
        rerender();
        // 1列になる幅ではカードが中身より下にあるので、選んだ中身まで送る
        if (window.matchMedia('(max-width: 1100px)').matches) document.querySelector('.hm-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    }, h('b', {}, name), h('small', {}, sub), h('span', { class: 'hm-bar' }, h('i', { style: `width:${rate * 100}%` })));
  }));
}
function sprintDetail(name, rawTasks, navigate) {
  const sps = getSprints(name).filter((sp) => sprintState(sp) !== 'past');
  const cols = sps.slice(0, 3).map((sp, i) => {
    const items = rawTasks.filter((x) => x.project === name && x.sprint === sp.id && !hasChildren(x.id)).sort(manual);
    return h('div', { class: 'hm-spcol' + (sprintState(sp) === 'now' ? ' is-now' : '') },
      h('h4', {}, sp.name),
      h('p', {}, `${md(sp.start)}〜${md(addDays(spEnd(sp), -1))}${sprintState(sp) === 'now' ? '・今' : ''}`),
      h('ul', {}, items.length ? items.map((x) => h('li', { class: isOpen(x) ? '' : 'is-done' },
        wbsCode(x.id) ? h('span', { class: 'tb-wbs-code' }, wbsCode(x.id)) : null, h('span', {}, x.title)))
        : h('li', {}, h('span', { class: 'tb-empty' }, 'まだ入っていない'))));
  });
  return [
    h('h3', {}, `${name}　今と次のスプリント`, h('button', { type: 'button', class: 'hm-open', onclick: () => navigate('projects', { project: name }) }, 'プロジェクトを開く ›')),
    cols.length ? h('div', { class: 'hm-spcols' }, cols) : h('p', { class: 'tb-empty' }, 'これからのスプリントがありません'),
  ];
}
// タイムライン：大項目（WBSの1段目）の期間と、スプリントを横のバーで（今週の1週前から8週間）
function timelineDetail(name, rawTasks, navigate) {
  const t = todayKey();
  const start = addDays(t, -((fromKey(t).getDay() + 6) % 7) - 7);
  const span = 56;
  const px = 12;
  const x = (k) => daysBetween(start, k) * px;
  const sps = getSprints(name);
  const lines = Array.from({ length: span / 7 + 1 }, (_, i) => h('i', { class: 'v', style: `left:${i * 7 * px}px` }));
  const lane = (bars) => h('div', { class: 'hm-tl-lane', style: `width:${span * px}px` }, lines.map((l) => l.cloneNode()), h('i', { class: 'today', style: `left:${x(t)}px` }), bars);
  const bar = (a, b, text, rate, cls = '') => h('div', { class: 'hm-tl-bar' + cls, style: `left:${x(a)}px;width:${Math.max(px, x(b) - x(a) - 2)}px`, title: text }, h('i', { style: `width:${rate * 100}%` }), text);
  const rows = [h('div', { class: 'hm-tl-row is-head' }, h('div', { class: 'hm-tl-label' }),
    h('div', { class: 'hm-tl-lane hm-tl-days', style: `width:${span * px}px` }, Array.from({ length: span / 7 }, (_, i) => h('span', { style: `left:${i * 7 * px}px` }, md(addDays(start, i * 7))))))];
  const leaves = (n) => (n.kids.length ? n.kids.flatMap(leaves) : [n.task]);
  for (const n of wbsTree(name).filter((k) => k.kids.length)) {
    const ls = leaves(n);
    const inS = sps.filter((sp) => ls.some((y) => y.sprint === sp.id));
    const r = ls.length ? ls.filter((y) => !isOpen(y)).length / ls.length : 0;
    rows.push(h('div', { class: 'hm-tl-row' }, h('div', { class: 'hm-tl-label is-big' }, `${n.code} ${n.task.title}`),
      lane(inS.length ? bar(inS[0].start, inS.reduce((m, sp) => (spEnd(sp) > m ? spEnd(sp) : m), inS[0].start), n.task.title, r, ' is-big')
        : h('span', { class: 'hm-tl-none' }, r === 1 ? '完了' : `スプリント未定（${ls.filter((y) => !isOpen(y)).length}/${ls.length}）`))));
  }
  rows.push(h('div', { class: 'hm-tl-row' }, h('div', { class: 'hm-tl-label' }, 'スプリント'), lane(sps.map((sp) => {
    const items = rawTasks.filter((y) => y.project === name && y.sprint === sp.id && !hasChildren(y.id));
    return bar(sp.start, spEnd(sp), sp.name.replace(/（.*）/, ''), items.length ? items.filter((y) => !isOpen(y)).length / items.length : 0);
  }))));
  return [
    h('h3', {}, `${name}　全体像（8週間）`, h('button', { type: 'button', class: 'hm-open', onclick: () => navigate('projects', { project: name }) }, 'プロジェクトを開く ›')),
    h('div', { class: 'hm-tl' }, rows),
  ];
}

// ---- 右：Googleカレンダーとミニカレンダー ----
function calendarCard(rerender) {
  const t = todayKey();
  const r = calendarFor(t.slice(0, 7), t, rerender);
  let body;
  if (r.state === 'none') {
    body = h('p', { class: 'tb-empty' }, 'つないでいません。右上の ⋯ →「Googleカレンダーをつなぐ」から。');
  } else if (r.state === 'loading') {
    body = h('p', { class: 'tb-empty' }, '読み込み中…');
  } else if (r.state === 'error') {
    body = h('p', { class: 'tb-empty' }, `読めませんでした（${r.error}）`);
  } else if (!r.today.length) {
    body = h('p', { class: 'tb-empty' }, '今日の予定はありません');
  } else {
    const now = new Date();
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    body = h('ul', { class: 'hm-ev' }, r.today.map((e) => h('li', { class: !e.allDay && e.start <= hm && hm < e.end ? 'is-now' : '' },
      h('time', {}, e.allDay ? '終日' : [e.start, h('br'), e.end]),
      h('div', { style: `--c:${e.color || 'var(--cat-univ)'}` }, e.title, e.place || e.calendar ? h('small', {}, [e.place, e.calendar].filter(Boolean).join('・')) : null))));
  }
  return h('section', { class: 'hm-card' }, h('h2', { class: 'hm-title' }, '今日の予定（Googleカレンダー）'), body);
}
function miniCalendar(rawTasks, navigate, rerender) {
  const t = todayKey();
  const month = miniMonth || t.slice(0, 7);
  const r = calendarFor(month, t, rerender);
  const evDays = r.state === 'ok' ? r.days : new Set();
  const taskDays = new Set(rawTasks.filter(isOpen).flatMap((x) => [x.doDate, x.dueDate]).filter((k) => k && k.startsWith(month)));
  const first = `${month}-01`;
  const start = addDays(first, -((fromKey(first).getDay() + 6) % 7));
  const shift = (n) => { const d = fromKey(first); d.setMonth(d.getMonth() + n); miniMonth = toKey(d).slice(0, 7); rerender(); };
  const rows = [h('tr', {}, ['月', '火', '水', '木', '金', '土', '日'].map((w) => h('th', {}, w)))];
  for (let i = 0; i < 6; i++) {
    rows.push(h('tr', {}, Array.from({ length: 7 }, (_, j) => {
      const k = addDays(start, i * 7 + j);
      const inM = k.startsWith(month);
      return h('td', {
        class: (inM ? '' : 'is-other') + (k === t ? ' is-today' : ''), title: '押すとこの週を開く',
        onclick: () => { showWeekOf(k); navigate('week', {}); },
      }, h('span', {}, String(fromKey(k).getDate())),
      inM && evDays.has(k) ? h('i', { class: 'is-ev' }) : null,
      inM && taskDays.has(k) ? h('i', { class: 'is-task' }) : null);
    })));
  }
  return h('section', { class: 'hm-card' },
    h('div', { class: 'hm-mini-head' },
      h('button', { type: 'button', 'aria-label': '前の月', onclick: () => shift(-1) }, '‹'),
      h('span', {}, `${month.slice(0, 4)}年${Number(month.slice(5))}月`),
      h('button', { type: 'button', 'aria-label': '次の月', onclick: () => shift(1) }, '›')),
    h('table', { class: 'hm-mini' }, rows),
    h('div', { class: 'hm-legend' },
      getCalendarConf() ? h('span', { style: '--c: var(--cat-univ)' }, '予定') : null,
      h('span', { style: '--c: var(--accent)' }, 'やる日・締切')));
}

export function renderHome(container, rawTasks, opts) {
  opts.setContext({});
  const t = todayKey();
  const tasks = visibleTasks(rawTasks, null);
  const open = tasks.filter(isOpen);
  const overdue = open.filter((x) => x.dueDate && x.dueDate < t);
  const carry = open.filter((x) => x.doDate && x.doDate < t && !(x.dueDate && x.dueDate < t));
  const todays = tasks.filter((x) => x.doDate === t || (!x.doDate && x.dueDate === t))
    .sort((a, b) => (isOpen(a) ? 0 : 1) - (isOpen(b) ? 0 : 1) || manual(a, b));
  const done = todays.filter((x) => !isOpen(x)).length;

  const notes = [];
  if (overdue.length) notes.push(h('button', { type: 'button', class: 'hm-note is-over', onclick: () => opts.navigate('today', {}) }, `期限切れ ${overdue.length}件 ›`));
  if (carry.length) notes.push(h('button', { type: 'button', class: 'hm-note', onclick: () => opts.navigate('today', {}) }, `持ち越し ${carry.length}件 ›`));

  // 動いているプロジェクト（未完了の作業があるもの）。最初に開くのはスプリントのある一番上
  const names = projectNames().filter((n) => rawTasks.some((x) => x.project === n && isOpen(x)));
  // 選んだものは覚えるが、決まっていない間は毎回選び直す（読み込みの途中で決めた物に固まらないように）
  const cur = names.includes(openProject) ? openProject : names.find((n) => getSprints(n).length) || names[0] || null;

  const projSec = h('section', { class: 'hm-sec' },
    h('div', { class: 'hm-projbar' },
      h('h2', { class: 'hm-title', style: 'margin:0' }, 'プロジェクト'),
      h('div', { class: 'tb-seg', role: 'group', 'aria-label': 'プロジェクトの見方', style: 'flex:0 0 auto' },
        [['sprint', 'スプリント一覧'], ['timeline', 'タイムライン一覧']].map(([v, l]) => h('button', {
          type: 'button', class: 'tb-seg-btn' + (pmode === v ? ' is-active' : ''), 'aria-pressed': String(pmode === v),
          onclick: () => { pmode = v; opts.rerender(); },
        }, l)))),
    names.length
      ? h('div', { class: 'hm-detail' }, pmode === 'sprint' ? sprintDetail(cur, rawTasks, opts.navigate) : timelineDetail(cur, rawTasks, opts.navigate))
      : h('p', { class: 'tb-empty' }, '動いているプロジェクトはありません'));
  // プロジェクトのカードは右の列に縦に並べる（左の上に置くと、中身を見るのにスクロールが要るため）
  const projCard = names.length ? h('section', { class: 'hm-card' }, h('h2', { class: 'hm-title' }, 'プロジェクト'), projectCards(names, cur, rawTasks, opts.rerender)) : null;

  container.replaceChildren(h('div', { class: 'hm' },
    h('div', {},
      h('section', { class: 'hm-sec' },
        h('h2', { class: 'hm-title' }, '今日のタスク', h('span', { class: 'tb-count' }, `${done}/${todays.length}`)),
        notes.length ? h('div', { class: 'hm-notes' }, notes) : null,
        todays.length ? h('div', { class: 'hm-tiles' }, todays.map((x) => tile(x, opts.rerender)))
          : h('p', { class: 'tb-empty' }, '今日のタスクはありません')),
      projSec),
    h('aside', { class: 'hm-side' }, calendarCard(opts.rerender), miniCalendar(rawTasks, opts.navigate, opts.rerender), projCard)));
}
