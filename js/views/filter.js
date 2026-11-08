// 画面ごとの「絞り込み」の欄（今日・週・プロジェクトで同じ形）。
// filterPick({ tasks, value, kinds, onChange }) → 要素
//   value：{ by: 'area'|'project'|'status', name } か null。kinds：出す種類（例 ['area','project']）
//   用途を選んでいる時は左に用途の色の丸、右に ×（解除）。選ぶ欄の中には色を付けられないので重ねて置く。
// 絞り込みは画面ごとに持つ（画面をまたいで引き継ぐと「タスクが消えた」と誤解されやすいため）
import { h, isOpen, areaDot } from './card.js';
import { areaNames, projectNames, sprintOf, hasChildren } from '../store.js';
import { STATUSES } from '../constants.js';

const LABEL = { area: '用途', project: 'プロジェクト', status: '状態' };

export function filterPick({ tasks, value, kinds, onChange }) {
  const open = tasks.filter(isOpen);
  const count = (k, v) => (k === 'status' ? tasks.filter((x) => (x.status || 'todo') === v) : open.filter((x) => x[k] === v)).length;
  const lists = {
    area: areaNames().filter((a) => count('area', a)),
    project: projectNames().filter((p) => count('project', p)),
    status: STATUSES.map((s) => s.value),
  };
  const statusLabel = Object.fromEntries(STATUSES.map((s) => [s.value, s.label]));
  const sel = h('select', {
    class: 'tb-filter-select' + (value ? ' is-on' : ''), 'aria-label': '絞り込み',
    onchange: (e) => {
      const v = e.target.value;
      if (!v) { onChange(null); return; }
      const i = v.indexOf(':');
      onChange({ by: v.slice(0, i), name: v.slice(i + 1) });
    },
  },
  h('option', { value: '' }, '絞り込み：すべて'),
  kinds.map((k) => (lists[k].length
    ? h('optgroup', { label: LABEL[k] }, lists[k].map((v) => h('option', { value: `${k}:${v}` }, `${k === 'status' ? statusLabel[v] : v}（${count(k, v)}）`)))
    : null)));
  sel.value = value ? `${value.by}:${value.name}` : '';
  const wrap = value?.by === 'area'
    ? h('span', { class: 'tb-filter-wrap has-dot' }, areaDot(value.name), sel)
    : h('span', { class: 'tb-filter-wrap' }, sel);
  return h('span', { class: 'tb-filter-pick' }, wrap,
    value ? h('button', { type: 'button', class: 'tb-x', 'aria-label': '絞り込みを解除', title: '解除', onclick: () => onChange(null) }, '×') : null);
}

// 絞り込みに合うか（状態は「未着手」なら status 無しも含む）
export function matchFilter(x, value) {
  if (!value) return true;
  if (value.by === 'status') return (x.status || 'todo') === value.name;
  return x[value.by] === value.name;
}

// ---- プロジェクトのタスクを、今日・週・一覧に出すか ----
// ふだんは出さない（プロジェクトの作業は数が多く、日々のタスクが埋もれるため。プロジェクトの画面で見る）。
// 「プロジェクトも表示」を押した時だけ出す（端末ごとに覚える）。プロジェクトで絞り込んだ時は、そのプロジェクトだけ出す。
// 出す時、スプリントに入っていてやる日の無い作業は、そのスプリントの始まりの日（月曜）をやる日として並べる
// （週の画面で引きずると、その日が本当のやる日として入る）。
const KEY = 'tb.showProjects';
export function showProjects() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function projectToggle(rerender) {
  const on = showProjects();
  return h('button', {
    type: 'button', class: 'tb-btn tb-proj-toggle' + (on ? ' is-active' : ''), 'aria-pressed': String(on),
    title: 'プロジェクトの作業も、ここに出すか',
    onclick: () => { try { localStorage.setItem(KEY, on ? '0' : '1'); } catch { /* 覚えられなくても動く */ } rerender(); },
  }, on ? '✓ プロジェクトも表示' : 'プロジェクトも表示');
}
export function visibleTasks(tasks, filter) {
  const all = showProjects();
  return tasks.flatMap((x) => {
    if (!x.project) return [x];
    if (!all && !(filter?.by === 'project' && filter.name === x.project)) return [];
    if (hasChildren(x.id)) return []; // WBSの見出し（下に作業を持つもの）は日々のタスクにしない
    if (x.doDate || !x.sprint) return [x];
    const sp = sprintOf(x.project, x.sprint);
    return [sp ? { ...x, doDate: sp.start, viaSprint: true } : x];
  });
}
