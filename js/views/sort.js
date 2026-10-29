// 並び替え（週・今日・カレンダー）と、引きずった後の order の決め方。担当：画面役。
// - 並び替え▼：手動（order 順）／優先度／プロジェクト／用途。各日・各区分の中の並びにだけ効く
// - 選んだものは画面ごとに localStorage（tb.sort.week・tb.sort.today）
// - order：小さいほど上。無いタスクは createdAt で並べる（store.js の normalize と同じ考え）
import { updateTask, areaNames } from '../store.js';
import { PRIORITIES } from '../constants.js';
import { h } from './card.js';

export const SORTS = [
  { value: 'manual', label: '手動' },
  { value: 'priority', label: '優先度' },
  { value: 'project', label: 'プロジェクト' },
  { value: 'area', label: '用途' },
];

export function loadSort(scope) {
  try {
    const v = localStorage.getItem(`tb.sort.${scope}`);
    return SORTS.some((s) => s.value === v) ? v : 'manual';
  } catch { return 'manual'; }
}
export function saveSort(scope, v) {
  try { localStorage.setItem(`tb.sort.${scope}`, v); } catch { /* 保存できなくても動く */ }
}

export const orderKey = (t) => (typeof t.order === 'number' && Number.isFinite(t.order) ? t.order : (t.createdAt || 0));

function byManual(a, b) {
  const d = orderKey(a) - orderKey(b);
  if (d) return d;
  const c = (a.createdAt || 0) - (b.createdAt || 0);
  if (c) return c;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
}
const rank = (list, v) => (v && list.includes(v) ? list.indexOf(v) : list.length);

export function sorter(mode) {
  if (mode === 'priority') return (a, b) => rank(PRIORITIES, a.priority) - rank(PRIORITIES, b.priority) || byManual(a, b);
  if (mode === 'area') {
    const names = areaNames();
    return (a, b) => rank(names, a.area) - rank(names, b.area) || byManual(a, b);
  }
  if (mode === 'project') {
    return (a, b) => {
      if (!!a.project !== !!b.project) return a.project ? -1 : 1; // なしは最後
      const c = a.project && b.project ? a.project.localeCompare(b.project, 'ja') : 0;
      return c || byManual(a, b);
    };
  }
  return byManual;
}

// 「並び替え▼」。見た目は他のボタン（丸い枠）に合わせ、中身は端末の選択（iPhoneは下から出る）
export function sortSelect(scope, value, onChange) {
  const sel = h('select', { class: 'tb-sort-sel', 'aria-label': '並び替え', 'data-sort-scope': scope },
    SORTS.map((s) => h('option', { value: s.value, selected: s.value === value || null }, s.label)));
  sel.value = value;
  sel.addEventListener('change', () => { saveSort(scope, sel.value); onChange(sel.value); });
  return h('label', { class: 'tb-sort' }, h('span', { class: 'tb-sort-label', 'aria-hidden': 'true' }, '並び替え'), sel);
}

const STEP = 1024;
const MIN_GAP = 1e-6;

// 引きずって落とした後の書き込み。
//   finalIds：落とした先の区分の、落とした後の並び（表示の順・動かしたタスクを含む）
//   datePatch：日付の変更（{ doDate } か {}）
//   sameZone：同じ日・区分の中での並べ直しか（手動でない時は手動に切り替え、表示の順をそのまま order にする）
//   mode：今の並び替え
// 戻り値：[id, patch] の配列（呼んだ側で updateTask する）
export function planDrop({ id, finalIds, byId, datePatch, sameZone, mode }) {
  const writes = new Map();
  const put = (k, p) => writes.set(k, { ...(writes.get(k) || {}), ...p });
  if (Object.keys(datePatch).length) put(id, datePatch);

  const renumber = () => {
    finalIds.forEach((k, i) => {
      const o = (i + 1) * STEP;
      if (k === id || orderKey(byId.get(k)) !== o) put(k, { order: o });
    });
  };

  if (sameZone && mode !== 'manual') {
    renumber(); // 見えている順をそのまま手動の順にする
  } else if (mode === 'manual') {
    const i = finalIds.indexOf(id);
    const prev = i > 0 ? byId.get(finalIds[i - 1]) : null;
    const next = i < finalIds.length - 1 ? byId.get(finalIds[i + 1]) : null;
    if (prev && next) {
      const lo = orderKey(prev);
      const hi = orderKey(next);
      const m = (lo + hi) / 2;
      // 中間値が両隣の間に厳密に入る時だけ使う（小数の丸めで隣と同じ値になると位置がずれるため）
      if (hi - lo > MIN_GAP && lo < m && m < hi) put(id, { order: m });
      else renumber(); // 詰まりすぎ・前後が逆（週の「〆だけ」の行をまたいだ時など）→ その日の分だけ振り直す
    } else if (prev) put(id, { order: orderKey(prev) + STEP });
    else if (next) put(id, { order: orderKey(next) - STEP });
  }
  // 手動でない時に日をまたいだ：日付だけ変える（order はそのまま）
  return [...writes.entries()];
}

// planDrop の結果を保存する。失敗したら onError
export function saveWrites(writes, onError) {
  return Promise.all(writes.map(([k, p]) => updateTask(k, p))).catch((e) => {
    console.warn('[task-board] 並べ替えの保存に失敗', e);
    onError?.(e);
  });
}
