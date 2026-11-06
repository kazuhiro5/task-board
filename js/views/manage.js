// 画面「用途管理」「プロジェクト管理」（⋯メニューから開く）。用途・プロジェクトの削除はここからだけ。
// 消し方は card.js の areaMenuItems／projectMenuItems と同じ（2回押し・元に戻す付き）。
// 左の一覧の横に置かないのは、押し間違えた時の影響が大きいため。
import { areaNames, areaColor, projectNames, getTasks, addArea, addProject } from '../store.js';
import { h, areaMenuItems, projectMenuItems, inlineAdder } from './card.js';

function row(name, dot, info, items, rerender) {
  return h('li', { class: 'tb-manage-row' },
    dot,
    h('span', { class: 'tb-manage-name' }, name),
    h('span', { class: 'tb-manage-info' }, info),
    h('span', { class: 'tb-manage-btns' }, items.map((it) => {
      let armed = false;
      const b = h('button', { type: 'button', class: 'tb-btn tb-manage-del' }, it.short);
      b.addEventListener('click', () => {
        if (!armed) { armed = true; b.textContent = it.confirm; b.classList.add('is-armed'); return; }
        it.onSelect();
        rerender();
      });
      b.addEventListener('blur', () => { if (armed) { armed = false; b.textContent = it.short; b.classList.remove('is-armed'); } });
      return b;
    })));
}

function counts(key) {
  const m = new Map();
  for (const x of getTasks()) if (x[key]) m.set(x[key], (m.get(x[key]) || 0) + 1);
  return m;
}

export function renderManageAreas(container, _tasks, opts) {
  opts.setContext({});
  const n = counts('area');
  const list = areaNames();
  container.replaceChildren(h('div', { class: 'tb-manage' },
    h('p', { class: 'tb-empty' }, '消すと、その用途のタスクとリンクは「用途なし」になります（タスクは消えません）。2回押すと消えます'),
    list.length
      ? h('ul', { class: 'tb-manage-list' }, list.map((a) => {
        const dot = h('span', { class: 'tb-dot' });
        const c = areaColor(a);
        if (c) dot.style.background = c;
        return row(a, dot, `タスク${n.get(a) || 0}件`, areaMenuItems(a).map((it) => ({ ...it, short: '削除' })), opts.rerender);
      }))
      : h('p', { class: 'tb-empty' }, '用途はありません'),
    inlineAdder('manage-area', { label: '＋ 用途を追加', placeholder: '用途の名前', onAdd: addArea, rerender: opts.rerender })));
}

export function renderManageProjects(container, _tasks, opts) {
  opts.setContext({});
  const n = counts('project');
  const list = projectNames();
  container.replaceChildren(h('div', { class: 'tb-manage' },
    h('p', { class: 'tb-empty' }, '「プロジェクトだけ削除」はタスクを残し、「タスクもゴミ箱へ」はタスクも30日ゴミ箱に入ります。2回押すと消えます'),
    list.length
      ? h('ul', { class: 'tb-manage-list' }, list.map((p) => {
        const items = projectMenuItems(p);
        const shorts = items.length === 1 ? ['削除'] : ['プロジェクトだけ削除', 'タスクもゴミ箱へ'];
        return row(p, null, `タスク${n.get(p) || 0}件`, items.map((it, i) => ({ ...it, short: shorts[i] })), opts.rerender);
      }))
      : h('p', { class: 'tb-empty' }, 'プロジェクトはありません'),
    inlineAdder('manage-project', { label: '＋ プロジェクトを追加', placeholder: 'プロジェクトの名前', onAdd: addProject, rerender: opts.rerender })));
}
