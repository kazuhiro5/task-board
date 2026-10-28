// 画面「一覧」。担当：画面役。
// renderList(container, tasks, opts)：opts = { group, setGroup, setContext, rerender, params, navigate }
// 上の切り替えで リスト／3列／カレンダー／ボード を選ぶ（js/views/modes.js）。
// opts.params.area があれば、その用途に絞って出す（「就活で絞り込み中 ×」で解除）。
import { GROUP_KEYS } from '../constants.js';
import { h, areaDot } from './card.js';
import { renderModes } from './modes.js';

let areaFilter = null; // 絞り込み中の用途
let lastParams = ''; // 最後に受け取った params（同じものを何度も受けても、解除した絞り込みを戻さない）

export function renderList(container, tasks, opts) {
  const params = opts.params || {};
  const sig = JSON.stringify(params);
  if (sig !== lastParams) { lastParams = sig; areaFilter = params.area || null; }

  const key = GROUP_KEYS.some((g) => g.value === opts.group) ? opts.group : 'area';
  const scoped = areaFilter ? tasks.filter((x) => x.area === areaFilter) : tasks;

  const filterBar = areaFilter
    ? h('div', { class: 'tb-filterbar' },
      areaDot(areaFilter),
      h('span', {}, `${areaFilter}で絞り込み中`),
      h('button', {
        type: 'button',
        class: 'tb-x',
        'aria-label': '絞り込みを解除',
        onclick: () => { areaFilter = null; if (opts.navigate) opts.navigate('list', {}); else opts.rerender(); },
      }, '×'))
    : null;

  container.replaceChildren(h('div', { class: 'tb-list' },
    filterBar,
    renderModes(scoped, {
      scope: 'list',
      groupKey: key,
      groupKeys: GROUP_KEYS,
      setGroup: opts.setGroup,
      baseCtx: areaFilter ? { area: areaFilter } : {},
      compact: !!areaFilter,
      setContext: opts.setContext,
      rerender: opts.rerender,
    })));
}
