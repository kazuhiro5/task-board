// 画面「ゴミ箱」（⋯メニューから開く。下のタブ・左の一覧には出さない）。担当：画面役。
// renderTrash(container, tasks, opts)：消したタスクを新しく消した順に出す。
// 「戻す」＝ゴミ箱から出す。「完全に消す」＝2回押し（1回目で「もう一度押すと消す」）。
// 30日より前に消したものは、起動時に store が完全に消す。
import { getTrash, restoreTask, purgeTask } from '../store.js';
import { toKey } from '../dates.js';
import { h, areaMark, md } from './card.js';
import { showToast } from '../toast.js';

let armedId = null; // 「完全に消す」を1回押したタスク
let armTimer = 0;

function fail(msg) {
  return (e) => {
    console.warn('[task-board]', msg, e);
    showToast(`${msg}（${e.message || e}）`);
  };
}

export function renderTrash(container, _tasks, opts) {
  opts.setContext({});
  const list = getTrash();
  if (armedId && !list.some((x) => x.id === armedId)) armedId = null;

  const rows = list.map((x) => {
    const armed = armedId === x.id;
    return h('div', { class: 'tb-card tb-trash-row', 'data-id': x.id },
      h('div', { class: 'tb-trash-body' },
        h('span', { class: 'tb-line' },
          x.area ? areaMark(x.area) : null,
          h('span', { class: 'tb-title' }, x.title || '（無題）')),
        h('span', { class: 'tb-meta' },
          h('span', { class: 'tb-tag' }, `${md(toKey(new Date(x.deletedAt)))}に削除`),
          x.project ? h('span', { class: 'tb-tag tb-tag--proj' }, x.project) : null)),
      h('div', { class: 'tb-trash-btns' },
        h('button', {
          type: 'button',
          class: 'tb-btn',
          onclick: () => { restoreTask(x.id).catch(fail('戻せませんでした')); },
        }, '戻す'),
        h('button', {
          type: 'button',
          class: 'tb-btn tb-danger' + (armed ? ' is-armed' : ''),
          onclick: () => {
            clearTimeout(armTimer);
            if (!armed) {
              armedId = x.id;
              armTimer = setTimeout(() => { armedId = null; opts.rerender(); }, 4000);
              opts.rerender();
              return;
            }
            armedId = null;
            purgeTask(x.id).catch(fail('消せませんでした'));
          },
        }, armed ? 'もう一度押すと消す' : '完全に消す')));
  });

  container.replaceChildren(h('div', { class: 'tb-trash' },
    h('div', { class: 'tb-trash-head' },
      h('button', { type: 'button', class: 'tb-btn tb-back', onclick: () => opts.navigate('today', {}) }, '‹ 今日へ'),
      h('p', { class: 'tb-empty' }, '消したタスクは30日たつと完全に消えます')),
    list.length ? h('div', { class: 'tb-cards' }, rows) : h('p', { class: 'tb-empty tb-guide' }, 'ゴミ箱は空です')));
}
