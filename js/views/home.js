// 画面「ホーム」：今日やることを一目で。のぞみ音楽教室の先生のホームと同じ組み立て：
//   上にあいさつと日付 → 「対応が必要なこと」の数字のカード（押すとその画面へ）
//   → 左に今日・今週のタスク（日ごと）、右にプロジェクトの様子（今のスプリントの進み具合と残りの作業）
//   → 下に今週の数字と、近い締切。
// 今日・今週のタスクは、今日・週と同じく「プロジェクトも表示」に従う（ふだんはプロジェクトの作業を出さない）。
import { todayKey, label, addDays, weekDays, fromKey, toKey } from '../dates.js';
import { h, isOpen, taskCard, md, dueTone } from './card.js';
import { sorter } from './sort.js';
import { projectNames, currentSprint, hasChildren, wbsCode } from '../store.js';
import { visibleTasks } from './filter.js';

const manual = sorter('manual');
const DAY = 86400000;

const ICON = {
  over: '<path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/>',
  carry: '<path d="M4 12h12M12 6l6 6-6 6"/>',
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>',
  due: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  proj: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
};
function icon(k) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICON[k].replace(/<(path|circle|rect)/g, '<$1 fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"');
  return s;
}
const greet = () => { const hr = new Date().getHours(); return hr < 11 ? 'おはようございます' : hr < 18 ? 'こんにちは' : 'こんばんは'; };

function statCard(kind, num, sub, text, onclick) {
  return h('button', { type: 'button', class: `tb-hstat is-${kind}${num ? '' : ' is-zero'}`, onclick },
    h('span', { class: 'tb-hstat-icon' }, icon(kind === 'week' ? 'due' : kind)),
    h('span', { class: 'tb-hstat-body' },
      h('span', { class: 'tb-hstat-num' }, String(num), sub ? h('small', {}, sub) : null),
      h('span', { class: 'tb-hstat-text' }, text)),
    h('span', { class: 'tb-hstat-go', 'aria-hidden': 'true' }, '›'));
}
const secTitle = (k, text) => h('h2', { class: 'tb-hsec-title' }, icon(k), text);

export function renderHome(container, rawTasks, opts) {
  opts.setContext({});
  const t = todayKey();
  const tasks = visibleTasks(rawTasks, null);
  const open = tasks.filter(isOpen);
  const overdue = open.filter((x) => x.dueDate && x.dueDate < t);
  const carry = open.filter((x) => x.doDate && x.doDate < t && !(x.dueDate && x.dueDate < t));
  const todayAll = tasks.filter((x) => x.doDate === t || x.dueDate === t || (!isOpen(x) && x.completedAt && toKey(new Date(x.completedAt)) === t && x.doDate === t));
  const todayDone = todayAll.filter((x) => !isOpen(x)).length;
  const week = weekDays(t);
  const weekEnd = week[6];
  const dueWeek = open.filter((x) => x.dueDate && x.dueDate >= t && x.dueDate <= weekEnd);

  // ---- 対応が必要なこと ----
  const stats = h('div', { class: 'tb-hstats' },
    statCard('over', overdue.length, null, '期限切れ', () => opts.navigate('today', {})),
    statCard('carry', carry.length, null, '持ち越し', () => opts.navigate('today', {})),
    statCard('today', todayDone, ` / ${todayAll.length}件`, '今日のタスク（終えた数）', () => opts.navigate('today', {})),
    statCard('week', dueWeek.length, null, '今週の締切', () => opts.navigate('week', {})));

  // ---- 今日・今週のタスク（今日から日曜まで、日ごと） ----
  const days = week.filter((d) => d >= t);
  const dayBlocks = days.map((d) => {
    const list = open.filter((x) => x.doDate === d || (!x.doDate && x.dueDate === d)).sort(manual);
    if (!list.length && d !== t) return null;
    return h('div', { class: 'tb-hday' },
      h('div', { class: 'tb-hday-head' }, label(d), d === t ? h('span', { class: 'tb-today-mark' }, '今日') : null, h('span', { class: 'tb-count' }, String(list.length))),
      list.length ? h('div', { class: 'tb-cards' }, list.map((x) => taskCard(x, { hide: ['doDate'] })))
        : h('p', { class: 'tb-empty' }, '今日の予定はありません'));
  }).filter(Boolean);
  const nextWeek = open.filter((x) => x.doDate && x.doDate > weekEnd && x.doDate <= addDays(weekEnd, 7)).length;
  const left = h('section', { class: 'tb-hcol' },
    secTitle('due', '今日・今週のタスク'),
    h('div', { class: 'tb-hpanel' }, dayBlocks,
      h('button', { type: 'button', class: 'tb-hmore', onclick: () => opts.navigate('week', {}) }, `来週は${nextWeek}件 ・ 週の画面で全部見る ›`)));

  // ---- プロジェクトの様子（今のスプリント） ----
  const projRows = [];
  const idle = [];
  for (const name of projectNames()) {
    const sp = currentSprint(name);
    if (!sp) { if (rawTasks.some((x) => x.project === name && isOpen(x))) idle.push(name); continue; }
    const inside = rawTasks.filter((x) => x.project === name && x.sprint === sp.id && !hasChildren(x.id));
    const done = inside.filter((x) => !isOpen(x)).length;
    const left3 = inside.filter(isOpen).sort(manual);
    const daysLeft = Math.max(0, Math.round((fromKey(addDays(sp.start, sp.days)) - fromKey(t)) / DAY));
    projRows.push(h('div', { class: 'tb-hproj' },
      h('button', { type: 'button', class: 'tb-hproj-head', onclick: () => opts.navigate('projects', { project: name }) },
        h('span', { class: 'tb-hproj-name' }, name),
        h('span', { class: 'tb-hproj-sp' }, `${sp.name}・あと${daysLeft}日`),
        h('span', { class: 'tb-count' }, `${done}/${inside.length}`)),
      h('div', { class: 'tb-sp-bar' }, h('i', { style: `width:${inside.length ? (done / inside.length) * 100 : 0}%` })),
      left3.length
        ? h('ul', { class: 'tb-hproj-list' }, left3.slice(0, 3).map((x) => h('li', {},
          wbsCode(x.id) ? h('span', { class: 'tb-wbs-code' }, wbsCode(x.id)) : null,
          h('span', { class: 'tb-hproj-task' }, x.title))),
          left3.length > 3 ? h('li', { class: 'tb-hproj-rest' }, `ほか${left3.length - 3}件`) : null)
        : h('p', { class: 'tb-empty' }, inside.length ? 'このスプリントは全部終わりました' : 'このスプリントに作業がありません')));
  }
  const right = h('section', { class: 'tb-hcol' },
    secTitle('proj', 'プロジェクトの様子'),
    h('div', { class: 'tb-hpanel' },
      projRows.length ? projRows : h('p', { class: 'tb-empty' }, '今動いているスプリントはありません'),
      idle.length ? h('p', { class: 'tb-hidle' }, `スプリントが無いプロジェクト：${idle.join('・')}`) : null));

  // ---- 今週の数字・近い締切 ----
  const doneOn = (x) => (x.completedAt ? toKey(new Date(x.completedAt)) : null);
  const doneWeek = rawTasks.filter((x) => !isOpen(x) && doneOn(x) && doneOn(x) >= week[0] && doneOn(x) <= weekEnd).length;
  const monthKey = t.slice(0, 7);
  const doneMonth = rawTasks.filter((x) => !isOpen(x) && doneOn(x) && doneOn(x).startsWith(monthKey)).length;
  // 直近14日で、追加か完了をした日の数（task-board の合格ライン「14日のうち10日以上」と同じ数え方）
  const active = new Set();
  for (const x of rawTasks) {
    for (const ms of [x.createdAt, x.completedAt]) {
      if (!ms) continue;
      const k = toKey(new Date(ms));
      if (k > addDays(t, -14) && k <= t) active.add(k);
    }
  }
  const nums = h('section', { class: 'tb-hcol' },
    secTitle('chart', '今週の数字'),
    h('div', { class: 'tb-hpanel tb-hnums' },
      h('div', { class: 'tb-hnum' }, h('b', {}, String(doneWeek)), h('span', {}, '今週終えた')),
      h('div', { class: 'tb-hnum' }, h('b', {}, String(doneMonth)), h('span', {}, `${Number(monthKey.slice(5))}月に終えた`)),
      h('div', { class: 'tb-hnum' }, h('b', {}, `${active.size}`, h('small', {}, ' / 14日')), h('span', {}, '直近14日で動いた日'))));
  const soon = open.filter((x) => x.dueDate && x.dueDate >= t && x.dueDate <= addDays(t, 14)).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)).slice(0, 6);
  const dues = h('section', { class: 'tb-hcol' },
    secTitle('due', '近い締切（2週間）'),
    h('div', { class: 'tb-hpanel' },
      soon.length
        ? h('ul', { class: 'tb-hdue' }, soon.map((x) => h('li', {},
          h('span', { class: 'tb-tag tb-due' + dueTone(x.dueDate) }, `〆${md(x.dueDate)}`),
          h('span', { class: 'tb-hproj-task' }, x.title))))
        : h('p', { class: 'tb-empty' }, '2週間以内の締切はありません')));

  container.replaceChildren(h('div', { class: 'tb-home2' },
    h('div', { class: 'tb-hhead' },
      h('h2', { class: 'tb-hgreet' }, greet()),
      h('span', { class: 'tb-hdate' }, label(t))),
    h('h2', { class: 'tb-hsec-title is-alert' }, icon('over'), '対応が必要なこと'),
    stats,
    h('div', { class: 'tb-hgrid' }, left, right),
    h('div', { class: 'tb-hgrid' }, nums, dues)));
}
