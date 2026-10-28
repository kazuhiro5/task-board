// 画面「プロジェクト」。担当：画面役（UI改修）。
// renderProjects(container, tasks, opts)：opts = { group, setGroup, setContext, rerender, params, navigate }
// プロジェクトを大きなカードで並べ、押すとそのプロジェクトのタスク（表示切り替え付き）を出す。
// opts.params.project があれば、最初からそのプロジェクトの中を開く。
import { AREAS, GROUP_KEYS } from '../constants.js';
import { h, isOpen, md, areaDot } from './card.js';
import { renderModes, resetScope } from './modes.js';
import { todayKey } from '../dates.js';

let openName = null; // 開いているプロジェクト
let lastParams = '';

function summarize(tasks) {
  const map = new Map();
  for (const x of tasks) {
    if (!x.project) continue;
    if (!map.has(x.project)) map.set(x.project, []);
    map.get(x.project).push(x);
  }
  return [...map.entries()].map(([name, list]) => {
    const open = list.filter(isOpen);
    const next = open.filter((x) => x.dueDate).sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))[0] || null;
    const areas = AREAS.filter((a) => list.some((x) => x.area === a));
    return { name, total: list.length, open: open.length, done: list.length - open.length, next, areas };
  }).sort((a, b) => {
    // 未完了があるもの → 締切が近い順 → 名前順
    if (!!a.open !== !!b.open) return a.open ? -1 : 1;
    const da = a.next?.dueDate || '9999-99-99';
    const db = b.next?.dueDate || '9999-99-99';
    if (da !== db) return da < db ? -1 : 1;
    return a.name.localeCompare(b.name, 'ja');
  });
}

// 開く・戻るは opts.navigate があればそれで（app.js の params と合わせる）。なければこの画面の中だけで切り替える
function open(name, opts) {
  openName = name;
  resetScope('project');
  if (opts.navigate) opts.navigate('projects', name ? { project: name } : {});
  else opts.rerender();
}

function projectCard(p, opts) {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return h('button', { type: 'button', class: 'tb-pcard', 'data-project': p.name, onclick: () => open(p.name, opts) },
    h('span', { class: 'tb-pcard-name' }, p.name),
    p.areas.length
      ? h('span', { class: 'tb-pcard-areas' }, p.areas.map((a) => h('span', { class: 'tb-area' }, areaDot(a), a)))
      : null,
    h('span', { class: 'tb-pcard-row' },
      h('span', { class: 'tb-pcard-open' }, p.open ? `未完了 ${p.open}件` : 'すべて完了')),
    h('span', { class: 'tb-pcard-next' + (p.next && p.next.dueDate < todayKey() ? ' is-over' : '') },
      p.next ? `次の〆 ${md(p.next.dueDate)}：${p.next.title}` : '締切なし'),
    h('span', { class: 'tb-progress' },
      h('span', { class: 'tb-bar', role: 'img', 'aria-label': `完了 ${p.done}/${p.total}` },
        h('span', { class: 'tb-bar-fill', style: `width:${pct}%` })),
      h('span', { class: 'tb-bar-text' }, `${p.done}/${p.total}`)));
}

export function renderProjects(container, tasks, opts) {
  const params = opts.params || {};
  const sig = JSON.stringify(params);
  if (sig !== lastParams) {
    lastParams = sig;
    // params が変わったら、それに合わせる（タブや左の「プロジェクト」＝{} なら一覧のカードに戻る）
    openName = params.project || null;
    resetScope('project');
  }

  const projects = summarize(tasks);
  if (openName && !projects.some((p) => p.name === openName)) openName = null;

  if (!openName) {
    opts.setContext({});
    container.replaceChildren(h('div', { class: 'tb-projects' },
      projects.length
        ? h('div', { class: 'tb-pgrid' }, projects.map((p) => projectCard(p, opts)))
        : h('p', { class: 'tb-empty tb-guide' }, 'タスクにプロジェクトを付けるとここに出ます')));
    return;
  }

  const p = projects.find((x) => x.name === openName);
  const inside = tasks.filter((x) => x.project === openName);
  const keys = GROUP_KEYS.filter((k) => k.value !== 'project');
  const key = keys.some((k) => k.value === opts.group) ? opts.group : 'area';

  container.replaceChildren(h('div', { class: 'tb-projects is-inside' },
    h('div', { class: 'tb-phead' },
      h('button', { type: 'button', class: 'tb-btn tb-back', onclick: () => open(null, opts) }, '‹ プロジェクト'),
      h('h2', { class: 'tb-phead-name' }, openName),
      h('span', { class: 'tb-count' }, `${p.done}/${p.total}`)),
    renderModes(inside, {
      scope: 'project',
      groupKey: key,
      groupKeys: keys,
      setGroup: opts.setGroup,
      baseCtx: { project: openName },
      hide: ['project'],
      compact: true,
      setContext: opts.setContext,
      rerender: opts.rerender,
    })));
}
