// 表示の切り替え（スプリント／一覧／カレンダー／進捗）。プロジェクトの中で使う。担当：画面役（UI改修）。
// renderModes(tasks, cfg) → 要素
//   cfg = { scope: 'list'|'project', groupKey, groupKeys, setGroup, baseCtx, setContext, rerender, hide, compact, project }
//   プロジェクトの中は groupKey: 'sprint'（スプリント（始まりの早い順）→ バックログ）。
//   スプリント＝プロジェクトの中の期間（store の getSprints）。タスクを入れていないものはバックログ。
// 状態（完了を表示・選んだグループ・週のずれ など）は scope ごとにこのファイルが持つ。
import { updateTask, areaNames, phaseName, renamePhase, deletePhase, lastHistory, undo, group, getTasks,
  getSprints, addSprint, updateSprint, deleteSprint, sprintState, SPRINT_LENGTHS, wbsTree, hasChildren, addTask, WBS_MAX,
  shiftSprints, parentChoices } from '../store.js';
import { STATUSES } from '../constants.js';
import { todayKey, addDays, weekDays, label, fromKey } from '../dates.js';
import { h, isOpen, compareTasks, taskCard as baseCard, sectionHead, md, areaDot, moreMenu } from './card.js';
import { loadSort, saveSort, sorter, sortSelect, planDrop, saveWrites } from './sort.js';
import { enableDrag, dayDrag } from './dnd.js';
import { showToast } from '../toast.js';
import { noDateStrip } from './week.js';
import { filterPick, matchFilter } from './filter.js';

// cfg.hide（例：プロジェクトの中では ['project']）を、すべての行に足す
let extraHide = [];
let showPhase = false; // プロジェクトの中だけ、行にフェーズの印（F2）を出す
function taskCard(x, o = {}) {
  return baseCard(x, { showPhase, ...o, hide: [...(o.hide || []), ...extraHide] });
}

export const MODES = [
  { value: 'wbs', label: 'WBS' },
  { value: 'sprint', label: 'スプリント' },
  { value: 'timeline', label: 'タイムライン' },
  { value: 'list', label: '一覧' },
  { value: 'cal', label: 'カレンダー' },
  { value: 'board', label: '進捗' },
];

const NONE = '\u0000none'; // 未設定のグループ

const scopes = {};
const projFilters = new Map(); // プロジェクトごとの絞り込み（表示を切り替えても残す）
function st(scope) {
  if (!scopes[scope]) {
    scopes[scope] = { showDone: false, picked: null, colPick: null, colOpen: false, weekOffset: 0, pickedDay: null };
  }
  return scopes[scope];
}

// プロジェクトを開き直した時などに、選んでいたグループ・週を戻す
export function resetScope(scope) {
  delete scopes[scope];
}

// ---- 選んだ表示の保存（画面ごと。tb.mode.list / tb.mode.project） ----
export function loadMode(scope) {
  try {
    const v = localStorage.getItem(`tb.mode.${scope}`);
    if (v === 'cols') return 'sprint'; // フェーズの表示はスプリントに置き換えた
    return MODES.some((m) => m.value === v) ? v : 'sprint';
  } catch { return 'list'; }
}
function saveMode(scope, v) {
  try { localStorage.setItem(`tb.mode.${scope}`, v); } catch { /* 保存できなくても動く */ }
}

function modeBar(scope, mode, rerender) {
  return h('div', { class: 'tb-seg tb-modes', role: 'group', 'aria-label': '表示の切り替え' },
    MODES.map((m) => h('button', {
      type: 'button',
      class: 'tb-seg-btn' + (m.value === mode ? ' is-active' : ''),
      'aria-pressed': String(m.value === mode),
      'data-mode': m.value,
      onclick: () => { if (m.value !== mode) { saveMode(scope, m.value); rerender(); } },
    }, m.label)));
}

// ---- グループ分け（一覧のリスト・3列で使う） ----
// フェーズの値：1以上の整数だけ。ほかは「フェーズなし」
const phaseOf = (x) => (Number.isInteger(x.phase) && x.phase >= 1 ? x.phase : NONE);

const sprintDates = (s) => `${md(s.start)}〜${md(addDays(s.start, s.days - 1))}`;
function groupsFor(key, list, showDone, cfg = {}) {
  if (key === 'sprint') {
    const sps = getSprints(cfg.project);
    const ids = new Set(sps.map((s) => s.id));
    return {
      order: sps.map((s) => s.id),
      value: (x) => (x.sprint && ids.has(x.sprint) ? x.sprint : NONE),
      label: (v) => { const s = sps.find((x) => x.id === v); return s ? `${s.name}（${sprintDates(s)}）${sprintState(s) === 'now' ? '・今' : ''}` : v; },
      noneLabel: 'バックログ',
      keepEmpty: true,
    };
  }
  if (key === 'area') return { order: areaNames(), value: (x) => x.area || NONE, label: (v) => v };
  if (key === 'phase') {
    // 1…N（N＝フェーズの数。もっと大きい番号のタスクがあればそこまで）
    const max = Math.max(cfg.phases || 0, ...list.map((x) => (phaseOf(x) === NONE ? 0 : x.phase)));
    return {
      order: Array.from({ length: max }, (_, i) => i + 1),
      value: phaseOf,
      label: (v) => (cfg.project ? phaseName(cfg.project, v) : `フェーズ${v}`),
      noneLabel: 'フェーズなし',
      keepEmpty: true,
    };
  }
  if (key === 'status') {
    const order = STATUSES.map((s) => s.value).filter((v) => v !== 'done' || showDone);
    const lab = Object.fromEntries(STATUSES.map((s) => [s.value, s.label]));
    return { order, value: (x) => x.status || 'todo', label: (v) => lab[v] || v };
  }
  const names = [...new Set(list.map((x) => x.project).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
  return { order: names, value: (x) => x.project || NONE, label: (v) => v };
}

// compact：中身のあるグループだけ出す（絞り込み中・プロジェクトの中）
function bucketize(key, list, showDone, compact, cfg) {
  const g = groupsFor(key, list, showDone, cfg);
  if (compact && !g.keepEmpty) g.order = g.order.filter((v) => list.some((x) => g.value(x) === v));
  const buckets = new Map(g.order.map((v) => [v, []]));
  for (const x of list) {
    const v = g.value(x);
    if (!buckets.has(v)) buckets.set(v, []);
    buckets.get(v).push(x);
  }
  if (g.keepEmpty && !buckets.has(NONE)) buckets.set(NONE, []); // フェーズなし は空でも出す（押して追加できるように）
  if (buckets.has(NONE)) { const n = buckets.get(NONE); buckets.delete(NONE); buckets.set(NONE, n); }
  for (const items of buckets.values()) items.sort(compareTasks);
  return { g, buckets };
}

// グループを選んだ時に入力欄の初期値にするもの
function ctxFor(key, v) {
  if (v === NONE || (key === 'status' && v === 'done')) return {};
  return { [key]: v };
}

// 見出しの番号（選んだ見出しを覚えるため。値が数字でも文字にそろえる）
const idOf = (key, v) => `${key}:${v === NONE ? '' : v}`;
const nameOf = (g, v) => (v === NONE ? (g.noneLabel || '未設定') : g.label(v));

// 区分（フェーズ・状態）へ引きずって落とした時：区分が変わればその値を書き、区分の中の順番（order）も書く。
// 動かしたら必ず「元に戻す」を出す。落とす先の名前＝'sprint:id'／'status:値'／'area:用途'（用途なし＝'area:'）
const manual = sorter('manual');
const byManual = (a, b) => (isOpen(a) ? 0 : 1) - (isOpen(b) ? 0 : 1) || manual(a, b);
export function dropToGroup({ id, fromKey, toKey, finalIds }) {
  const byId = new Map(getTasks().map((x) => [x.id, x]));
  const task = byId.get(id);
  if (!task) return;
  const [key, v] = [toKey.slice(0, toKey.indexOf(':')), toKey.slice(toKey.indexOf(':') + 1)];
  const patch = {};
  if (key === 'phase') { const nv = v ? Number(v) : null; if ((task.phase ?? null) !== nv) patch.phase = nv; }
  if (key === 'sprint' && (task.sprint || null) !== (v || null)) { patch.sprint = v || null; patch.carried = false; }
  if (key === 'status' && (task.status || 'todo') !== v) patch.status = v;
  if (key === 'area' && (task.area || null) !== (v || null)) patch.area = v || null;
  const writes = planDrop({ id, finalIds, byId, datePatch: patch, sameZone: fromKey === toKey, mode: 'manual' });
  if (!writes.length) return;
  group('move', () => saveWrites(writes, (err) => showToast(`動かせませんでした（${err.message || err}）`)));
  const entry = lastHistory();
  showToast(fromKey === toKey ? '並べ替えました' : `「${task.title}」を動かしました`, { action: '元に戻す', onAction: () => undo(entry) });
}

// フェーズの名前をダブルクリックで直す（プロジェクトの中だけ）。Enter・外を押すで保存、Esc でやめる
function renamable(nameEl, cfg, key, v) {
  if (key !== 'phase' || !cfg.project || v === NONE) return nameEl;
  nameEl.title = 'ダブルクリックで名前を変える';
  // dblclick は使えない：1回目の click で画面が描き直され、2回目は消えた要素に届くため。
  // 2回目を押した瞬間（mousedown の detail＝2）に始め、その直後の click が親のボタンに届かないようにする
  nameEl.addEventListener('mousedown', (e) => {
    if (e.detail !== 2) return;
    e.preventDefault();
    e.stopPropagation();
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 400);
    start();
  });
  // 「…」のメニューの「名前を変える」からも呼ぶ
  nameEl.startRename = () => start();
  function start() {
    const input = h('input', { type: 'text', class: 'tb-rename', value: phaseName(cfg.project, v), maxlength: '30', 'aria-label': `フェーズ${v}の名前` });
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save && input.value.trim() !== phaseName(cfg.project, v)) {
        renamePhase(cfg.project, v, input.value).catch((err) => showToast(`名前を保存できませんでした（${err.message || err}）`));
      }
      cfg.rerender();
    };
    // 親のボタンの click（開く・選ぶ）に届かないようにする
    for (const t of ['click', 'pointerdown', 'dblclick']) input.addEventListener(t, (ev) => ev.stopPropagation());
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
      if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    nameEl.replaceWith(input);
    input.focus();
    input.select();
  }
  return nameEl;
}

// フェーズの「…」：名前を変える／削除（中のタスクはフェーズなしへ。後ろのフェーズは1つ詰める）
function phaseMenu(cfg, key, v, nameEl, tasks) {
  if (key !== 'phase' || !cfg.project || v === NONE) return null;
  const n = tasks.filter((x) => x.phase === v).length;
  return moreMenu(`${phaseName(cfg.project, v)}のメニュー`, () => [
    { label: '名前を変える', onSelect: () => nameEl.startRename?.() },
    {
      label: 'フェーズを削除', danger: true,
      confirm: n ? `もう一度押すと削除（${n}件はフェーズなしへ）` : 'もう一度押すと削除',
      onSelect: () => {
        const label = phaseName(cfg.project, v);
        const r = deletePhase(cfg.project, v);
        const fail = (err) => showToast(`フェーズを削除できませんでした（${err.message || err}）`);
        r.write.catch(fail);
        showToast(`「${label}」を削除しました${r.moved ? `（${r.moved}件はフェーズなし）` : ''}`, { action: '元に戻す', onAction: () => undo(r.entry) });
        cfg.rerender();
      },
    },
  ], 'tb-phase-more');
}

// 「＋ フェーズを追加」（cfg.onAddPhase がある時だけ）
function addPhaseBtn(cfg, cls = '') {
  if (!cfg.onAddPhase) return null;
  return h('button', { type: 'button', class: 'tb-btn tb-addphase' + (cls ? ` ${cls}` : ''), onclick: cfg.onAddPhase }, '＋ フェーズを追加');
}

function groupBar(cfg, s) {
  return h('div', { class: 'tb-listbar' },
    !cfg.groupKeys?.length ? null : h('div', { class: 'tb-seg', role: 'group', 'aria-label': 'グループ分け' },
      cfg.groupKeys.map((k) => h('button', {
        type: 'button',
        class: 'tb-seg-btn' + (k.value === cfg.groupKey ? ' is-active' : ''),
        'aria-pressed': String(k.value === cfg.groupKey),
        'data-group': k.value,
        onclick: () => { if (k.value !== cfg.groupKey) cfg.setGroup(k.value); },
      }, k.label))),
    h('button', {
      type: 'button',
      class: 'tb-btn tb-toggle' + (s.showDone ? ' is-active' : ''),
      'aria-pressed': String(s.showDone),
      onclick: () => { s.showDone = !s.showDone; cfg.rerender(); },
    }, s.showDone ? '✓ 完了を表示' : '完了を表示'));
}

// ---- リスト ----
function listMode(tasks, cfg, s) {
  const key = cfg.groupKey;
  const list = s.showDone ? tasks : tasks.filter(isOpen);
  const { g, buckets } = bucketize(key, list, s.showDone, cfg.compact, cfg);

  const pickedV = [...buckets.keys()].find((v) => idOf(key, v) === s.picked);
  if (pickedV === undefined) s.picked = null;
  cfg.setContext({ ...cfg.baseCtx, ...(pickedV !== undefined ? ctxFor(key, pickedV) : {}) });

  const draggable = cfg.scope === 'project' && (key === 'phase' || key === 'sprint');
  if (draggable) for (const items of buckets.values()) items.sort(byManual);
  const sections = [...buckets.entries()].map(([v, items]) => {
    const isPicked = pickedV === v;
    const head = sectionHead(nameOf(g, v), items.length, {
      picked: isPicked,
      onPick: () => { s.picked = isPicked ? null : idOf(key, v); cfg.rerender(); },
    });
    const menu = key === 'sprint' ? sprintMenu(cfg, v, tasks) : phaseMenu(cfg, key, v, renamable(head.querySelector('.tb-sec-title'), cfg, key, v), tasks);
    if (menu) head.append(menu);
    return h('section', { class: 'tb-sec', 'data-group-value': v === NONE ? '' : v, ...(draggable ? { 'data-drop': idOf(key, v), 'data-drop-ok': true } : {}) },
      head,
      items.length ? h('div', { class: 'tb-cards' }, items.map((x) => taskCard(x, { hide: [key] }))) : null);
  });
  const groups = sections.length ? h('div', { class: 'tb-groups' + (cfg.scope === 'project' ? ' is-rows' : '') }, sections) : null;
  if (groups && draggable) enableDrag(groups, { rootSel: '.tb-groups.is-rows', onDrop: dropToGroup });
  return [groupBar(cfg, s),
    key === 'sprint' ? addSprintBar(cfg) : null,
    groups || h('p', { class: 'tb-empty' }, 'タスクはありません'),
    key === 'sprint' ? null : addPhaseBtn(cfg)];
}

// ---- WBS ----
// プロジェクトでやることを 親 → 子 → 孫 の3段で書き出す。下に何も無い作業（葉）は右でスプリントを選ぶ。
// 各行の「＋」でその下に足し、一番下の「＋ 項目を追加」でいちばん上の段に足す。親は下の終わった割合を出す
let wbsAdding = null; // 下に足そうとしている行の id（'' ＝いちばん上の段）
function wbsAdder(cfg, parentId) {
  const input = h('input', { type: 'text', class: 'tb-adder-input', placeholder: parentId ? '下に足す作業の名前' : '項目の名前（例：企画）', maxlength: '80', 'aria-label': '名前' });
  const done = () => { wbsAdding = null; cfg.rerender(); };
  const submit = (e) => {
    e?.preventDefault();
    const title = input.value.trim();
    if (!title) { done(); return; }
    addTask({ title, project: cfg.project, parent: parentId || null, doDate: null, area: cfg.baseCtx?.area || null })
      .catch((err) => showToast(`足せませんでした（${err.message || err}）`));
    input.value = '';
    input.focus(); // 続けて足せるように開いたまま
  };
  const form = h('form', { class: 'tb-adder tb-wbs-adder', autocomplete: 'off', onsubmit: submit },
    input, h('button', { type: 'submit', class: 'primary' }, '追加'), h('button', { type: 'button', class: 'tb-btn', onclick: done }, '閉じる'));
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); done(); } });
  setTimeout(() => input.focus(), 0);
  return form;
}
function wbsMode(tasks, cfg) {
  cfg.setContext({ ...cfg.baseCtx });
  const sps = getSprints(cfg.project);
  const rows = [];
  const leafStats = (n) => (n.kids.length ? n.kids.reduce((a, k) => { const s = leafStats(k); return [a[0] + s[0], a[1] + s[1]]; }, [0, 0]) : [isOpen(n.task) ? 0 : 1, 1]);
  const walk = (nodes) => {
    for (const n of nodes) {
      const leaf = !n.kids.length;
      const [done, total] = leafStats(n);
      const card = taskCard(n.task, { hide: ['parent', 'sprint'] });
      const pick = leaf ? (() => {
        const sel = h('select', {
          class: 'tb-wbs-pick' + (n.task.sprint ? '' : ' is-backlog'), 'aria-label': 'スプリント',
          onchange: (e) => {
            updateTask(n.task.id, { sprint: e.target.value || null, carried: false }).catch((err) => showToast(`保存できませんでした（${err.message || err}）`));
            const entry = lastHistory();
            showToast(`「${n.task.title}」を${e.target.value ? sps.find((x) => x.id === e.target.value)?.name : 'バックログ'}へ`, { action: '元に戻す', onAction: () => undo(entry) });
          },
        }, h('option', { value: '' }, 'バックログ'), sps.map((sp) => h('option', { value: sp.id }, `${sp.name}（${sprintDates(sp)}）${sprintState(sp) === 'now' ? '・今' : sprintState(sp) === 'past' ? '・終了' : ''}`)));
        sel.value = n.task.sprint && sps.some((x) => x.id === n.task.sprint) ? n.task.sprint : '';
        return sel;
      })() : h('span', { class: 'tb-wbs-prog' }, `${done}/${total}`);
      const addBtn = n.level < WBS_MAX
        ? h('button', { type: 'button', class: 'tb-btn tb-wbs-add', title: 'この下に足す', 'aria-label': `「${n.task.title}」の下に足す`, onclick: () => { wbsAdding = n.task.id; cfg.rerender(); } }, '＋')
        : h('span', { class: 'tb-wbs-add is-none' });
      rows.push(h('div', { class: `tb-wbs-row is-l${n.level}${leaf ? ' is-leaf' : ''}`, 'data-drop': `wbs:${n.task.id}`, 'data-drop-ok': true, 'data-into': n.level < WBS_MAX ? '1' : '0' }, card, pick, addBtn));
      if (wbsAdding === n.task.id) rows.push(h('div', { class: `tb-wbs-row is-l${Math.min(n.level + 1, WBS_MAX)} is-adder` }, wbsAdder(cfg, n.task.id)));
      walk(n.kids);
    }
  };
  walk(wbsTree(cfg.project));
  // 行を引きずって落とす：行の右寄り＝その中に入れる（子にする）、左寄り＝そのタスクの下に並べる、
  // 行の上の端＝その上に並べる（先頭へ動かす時のため）。3段目の行には中へ入れられないので、右寄りでも下に並べる。
  // 一番下の欄へ落とすと、いちばん上の段の最後へ
  const modeOf = (zone, x, y) => {
    const r = zone.getBoundingClientRect();
    if ((y - r.top) / Math.max(1, r.height) < 0.2) return 'before';
    const canInto = zone.dataset.into === '1';
    // 境目は左から2割（左1：右4）。中へ入れる方を広く取る（右へ大きく動かさなくても入るように）
    return canInto && x > r.left + r.width * 0.2 ? 'into' : 'after';
  };
  const root = rows.length ? h('div', { class: 'tb-wbs' }, rows,
    h('div', { class: 'tb-wbs-top', 'data-drop': 'wbs:', 'data-drop-ok': true }, 'ここへ引きずると、いちばん上の段の最後に')) : null;
  if (root) enableDrag(root, {
    rootSel: '.tb-wbs',
    allowDone: true,
    onHover: (zone, x, y) => { if (zone.dataset.drop !== 'wbs:') zone.dataset.mode = modeOf(zone, x, y); },
    onDrop: ({ id, toKey, toZone, x, y }) => {
      const all = getTasks();
      const byId = new Map(all.map((x) => [x.id, x]));
      const task = byId.get(id);
      const targetId = toKey.slice(4) || null;
      if (!task || id === targetId) return;
      const mode = targetId ? modeOf(toZone, x, y) : 'end';
      const target = targetId ? byId.get(targetId) : null;
      // 新しい親と、同じ親の中の並び（order）
      const parent = mode === 'into' ? targetId : mode === 'end' ? null : (target.parent && byId.get(target.parent) && !byId.get(target.parent).deletedAt ? target.parent : null);
      if (parent && parent !== task.parent && !parentChoices(cfg.project, id).some((c) => c.id === parent)) {
        showToast('そこには入れられません（3段を超えるか、自分の下です）');
        cfg.rerender();
        return;
      }
      if (parent === id) return;
      const ord = (x) => x.order ?? x.createdAt ?? 0;
      const sibs = all.filter((x) => x.project === cfg.project && x.id !== id && (x.parent || null) === parent && !x.deletedAt).sort((a, b) => ord(a) - ord(b));
      let order;
      if (mode === 'before' || mode === 'after') {
        const i = sibs.findIndex((x) => x.id === targetId);
        const prev = mode === 'before' ? sibs[i - 1] : target;
        const next = mode === 'before' ? target : sibs[i + 1];
        order = prev && next ? (ord(prev) + ord(next)) / 2 : prev ? ord(prev) + 1024 : ord(next) - 1024;
      } else {
        order = sibs.length ? ord(sibs[sibs.length - 1]) + 1024 : Date.now();
      }
      updateTask(id, { parent, order }).catch((err) => showToast(`動かせませんでした（${err.message || err}）`));
      const entry = lastHistory();
      const msg = mode === 'into' ? `「${target.title}」の中へ` : mode === 'end' ? 'いちばん上の段へ' : `「${target.title}」の${mode === 'before' ? '上' : '下'}へ`;
      showToast(`「${task.title}」を${msg}`, { action: '元に戻す', onAction: () => undo(entry) });
    },
  });
  return [
    h('p', { class: 'tb-empty tb-sp-help' }, 'やることを 親 → 子 → 孫 の3段で書き出します。「＋」でその下に足し、下に何も無い作業は右でスプリントを選びます（選ばなければバックログ）。行を引きずって、ほかの行の右寄りに落とすとその中へ、左寄りに落とすとその下に並びます。'),
    root || h('p', { class: 'tb-empty' }, 'まだ何もありません'),
    wbsAdding === '' ? wbsAdder(cfg, null) : h('button', { type: 'button', class: 'tb-btn tb-addphase', onclick: () => { wbsAdding = ''; cfg.rerender(); } }, '＋ 項目を追加'),
  ];
}

// ---- タイムライン ----
// スプリントの期間を横のバーで並べる（上に WBS の1段目＝大項目の期間、下にスプリント）。縦線は1日、濃い線は週の区切り、赤は今日。
// スプリントのバーを引きずると日付がずれる（「後ろもまとめて」で以降も一緒に）。大項目の期間は、下の作業が入っているスプリントから出す
let tlZoom = 'week';
let tlChain = true;
function timelineMode(tasks, cfg) {
  cfg.setContext({ ...cfg.baseCtx });
  const sps = getSprints(cfg.project);
  const px = tlZoom === 'week' ? 28 : 10;
  const t = todayKey();
  const first = sps.length ? (sps[0].start < t ? sps[0].start : t) : t;
  const start = addDays(first, -((fromKey(first).getDay() + 6) % 7) - 7); // 最初の週の1週前の月曜から
  const lastEnd = sps.length ? addDays(sps[sps.length - 1].start, sps[sps.length - 1].days) : t;
  const span = Math.max(tlZoom === 'week' ? 35 : 84, Math.round((fromKey(lastEnd) - fromKey(start)) / 86400000) + 14);
  const dx = (key) => Math.round((fromKey(key) - fromKey(start)) / 86400000) * px;
  const lines = [];
  const labels = [];
  for (let i = 0; i <= span; i++) {
    const d = addDays(start, i);
    const mon = fromKey(d).getDay() === 1;
    if (tlZoom === 'week' || mon) lines.push(h('i', { class: 'tb-tl-v' + (mon ? ' is-week' : ''), style: `left:${i * px}px` }));
    if (mon) labels.push(h('span', { style: `left:${i * px}px` }, md(d)));
  }
  const lane = (bar) => h('div', { class: 'tb-tl-lane', style: `width:${(span + 1) * px}px` },
    lines.map((x) => x.cloneNode()), h('i', { class: 'tb-tl-today', style: `left:${dx(t)}px` }), bar);
  const rows = [h('div', { class: 'tb-tl-row is-head' }, h('div', { class: 'tb-tl-label' }, '週の始まり'), h('div', { class: 'tb-tl-days', style: `width:${(span + 1) * px}px` }, labels))];
  // 大項目（WBSの1段目で、下に作業があるもの）
  const leafIds = (n) => (n.kids.length ? n.kids.flatMap(leafIds) : [n.task]);
  for (const n of wbsTree(cfg.project).filter((x) => x.kids.length)) {
    const leaves = leafIds(n);
    const inS = sps.filter((sp) => leaves.some((x) => x.sprint === sp.id));
    const done = leaves.filter((x) => !isOpen(x)).length;
    let bar = null;
    if (inS.length) {
      const a = inS[0].start;
      const b = inS.reduce((m, sp) => { const e = addDays(sp.start, sp.days); return e > m ? e : m; }, a);
      bar = h('div', { class: 'tb-tl-bar is-big', style: `left:${dx(a)}px;width:${dx(b) - dx(a)}px` },
        h('i', { style: `width:${leaves.length ? (done / leaves.length) * 100 : 0}%` }), n.task.title);
    }
    rows.push(h('div', { class: 'tb-tl-row' }, h('div', { class: 'tb-tl-label is-big' }, n.task.title), lane(bar)));
  }
  // スプリント
  for (const sp of sps) {
    const items = tasks.filter((x) => x.sprint === sp.id && !hasChildren(x.id));
    const done = items.filter((x) => !isOpen(x)).length;
    // バーは2つの役：引きずって日付をずらす（バーをつかむ）／下の作業を落とすとそのスプリントに入る（data-drop）
    const bar = h('div', { class: 'tb-tl-bar' + (sprintState(sp) === 'now' ? ' is-now' : ''), 'data-sp': sp.id, 'data-drop': `sprint:${sp.id}`, 'data-drop-ok': true, style: `left:${dx(sp.start)}px;width:${sp.days * px}px`, title: '引きずって日付をずらす。下の作業を落とすとこのスプリントに入る' },
      h('i', { style: `width:${items.length ? (done / items.length) * 100 : 0}%` }), `${sp.name}（${items.length}件）`);
    bar.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      e.preventDefault();
      const x0 = e.clientX;
      const left0 = dx(sp.start);
      const others = tlChain ? [...bar.closest('.tb-tl').querySelectorAll('.tb-tl-bar[data-sp]')].filter((b2) => b2 !== bar && sps.findIndex((s) => s.id === b2.dataset.sp) > sps.indexOf(sp)) : [];
      const oLeft = others.map((b2) => parseFloat(b2.style.left));
      bar.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const d = Math.round((ev.clientX - x0) / px);
        bar.style.left = `${left0 + d * px}px`;
        others.forEach((b2, i) => { b2.style.left = `${oLeft[i] + d * px}px`; });
      };
      const up = (ev) => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
        const d = Math.round((ev.clientX - x0) / px);
        if (!d) { cfg.rerender(); return; }
        shiftSprints(cfg.project, sp.id, d, tlChain);
        const entry = lastHistory();
        showToast(`${sp.name}${tlChain ? '以降' : ''}を${d > 0 ? `${d}日後ろ` : `${-d}日前`}へずらしました`, { action: '元に戻す', onAction: () => undo(entry) });
        cfg.rerender();
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
    });
    rows.push(h('div', { class: 'tb-tl-row' }, h('div', { class: 'tb-tl-label' }, sp.name), lane(bar)));
  }
  const backlog = tasks.filter((x) => isOpen(x) && !hasChildren(x.id) && !(x.sprint && sps.some((sp) => sp.id === x.sprint)));
  const chain = h('input', { type: 'checkbox', onchange: (e) => { tlChain = e.target.checked; } });
  chain.checked = tlChain;
  const tlRoot = h('div', { class: 'tb-tl-root' });
  const out = [
    h('div', { class: 'tb-tl-tools' },
      h('label', { class: 'tb-tl-chain' }, chain, '後ろもまとめてずらす'),
      h('div', { class: 'tb-seg', role: 'group', 'aria-label': '表示の幅' },
        [['week', '週'], ['month', '月']].map(([v, l]) => h('button', { type: 'button', class: 'tb-seg-btn' + (tlZoom === v ? ' is-active' : ''), onclick: () => { tlZoom = v; cfg.rerender(); } }, l))),
      h('span', { class: 'tb-empty' }, '緑＝スプリント（引きずってずらせる）、青＝大項目、赤い線＝今日。濃い色は終わった割合。')),
    sps.length ? h('div', { class: 'tb-tl' }, rows) : h('p', { class: 'tb-empty' }, 'スプリントがありません（「スプリント」で作れます）'),
    h('section', { class: 'tb-sec tb-tl-drawer', 'data-drop': 'sprint:', 'data-drop-ok': true },
      sectionHead('期間の決まっていない作業（バックログ）。スプリントのバーへ引きずると入る', backlog.length),
      backlog.length ? h('div', { class: 'tb-cards tb-strip-cards is-all' }, backlog.map((x) => taskCard(x, { areaInMeta: true, memoPreview: true }))) : null),
  ];
  tlRoot.append(...out.filter(Boolean));
  enableDrag(tlRoot, { rootSel: '.tb-tl-root', onDrop: dropToGroup });
  return [tlRoot];
}

// ---- スプリント ----
// スプリントの「…」：名前を変える／期間を変える／削除（中のタスクはバックログへ）
let editingSprint = null; // 期間を直しているスプリントの id
function sprintMenu(cfg, v, tasks) {
  if (v === NONE || !cfg.project) return null;
  const n = tasks.filter((x) => x.sprint === v).length;
  return moreMenu('スプリントのメニュー', () => [
    { label: '名前・期間を変える', onSelect: () => { editingSprint = v; cfg.rerender(); } },
    {
      label: 'スプリントを削除', danger: true,
      confirm: n ? `もう一度押すと削除（${n}件はバックログへ）` : 'もう一度押すと削除',
      onSelect: () => {
        deleteSprint(cfg.project, v);
        const entry = lastHistory();
        showToast(`スプリントを削除しました${n ? `（${n}件はバックログ）` : ''}`, { action: '元に戻す', onAction: () => undo(entry) });
        cfg.rerender();
      },
    },
  ], 'tb-phase-more');
}
// 名前・始まりの日・長さを直す小さな欄（見出しのすぐ下）
function sprintEditor(cfg, sp) {
  const name = h('input', { type: 'text', class: 'tb-rename', value: sp.name, maxlength: '30', 'aria-label': 'スプリントの名前' });
  const start = h('input', { type: 'date', class: 'tag-date', value: sp.start, 'aria-label': '始まりの日' });
  const days = h('select', { class: 'tag-select', 'aria-label': '長さ' },
    SPRINT_LENGTHS.map((x) => h('option', { value: String(x.days) }, x.label)),
    SPRINT_LENGTHS.some((x) => x.days === sp.days) ? null : h('option', { value: String(sp.days) }, `${sp.days}日`));
  days.value = String(sp.days);
  const save = () => {
    updateSprint(cfg.project, sp.id, { name: name.value, start: start.value, days: Number(days.value) });
    editingSprint = null;
    const entry = lastHistory();
    showToast('スプリントを直しました', { action: '元に戻す', onAction: () => undo(entry) });
    cfg.rerender();
  };
  return h('div', { class: 'tb-sprint-edit' }, name, start, days,
    h('button', { type: 'button', class: 'primary', onclick: save }, '保存'),
    h('button', { type: 'button', class: 'tb-btn', onclick: () => { editingSprint = null; cfg.rerender(); } }, 'やめる'));
}
// 「＋ スプリントを追加」：前のスプリントの次の日から、選んだ長さで足す
let newLength = 7;
function addSprintBar(cfg) {
  if (!cfg.project) return null;
  const len = h('select', { class: 'tag-select', 'aria-label': '新しいスプリントの長さ', onchange: (e) => { newLength = Number(e.target.value); } },
    SPRINT_LENGTHS.map((x) => h('option', { value: String(x.days) }, x.label)));
  len.value = String(newLength);
  return h('div', { class: 'tb-sprint-add' },
    h('button', {
      type: 'button', class: 'tb-btn tb-addphase',
      onclick: () => {
        const sp = addSprint(cfg.project, newLength);
        const entry = lastHistory();
        showToast(`${sp.name}（${sprintDates(sp)}）を足しました`, { action: '元に戻す', onAction: () => undo(entry) });
        cfg.rerender();
      },
    }, '＋ スプリントを追加'), len);
}

// スプリントの表示：左にバックログ、右へスプリントを始まりの早い順に列で並べる。今のスプリントは緑の枠。
// 列の間を引きずって入れ替える。各列に終わった割合のバー
function sprintMode(tasks, cfg) {
  const sps = getSprints(cfg.project);
  const ids = new Set(sps.map((x) => x.id));
  cfg.setContext({ ...cfg.baseCtx });
  const col = (sp) => {
    const items = tasks.filter((x) => !hasChildren(x.id) && (sp ? x.sprint === sp.id : !(x.sprint && ids.has(x.sprint)))).sort(byManual);
    const open = items.filter(isOpen);
    const shown = sp ? items : open; // バックログは未完了だけ（スプリントは終わったものも出して進み具合を見せる）
    const done = items.length - open.length;
    const state = sp ? sprintState(sp) : '';
    const head = sectionHead(sp ? sp.name : 'バックログ', sp ? `${done}/${items.length}` : open.length);
    if (sp) head.append(sprintMenu(cfg, sp.id, tasks));
    return h('section', {
      class: 'tb-bcol tb-spcol' + (state === 'now' ? ' is-now' : '') + (state === 'past' ? ' is-past' : ''),
      'data-drop': `sprint:${sp ? sp.id : ''}`, 'data-drop-ok': true,
    },
    head,
    h('p', { class: 'tb-sp-dates' }, sp ? `${sprintDates(sp)}${state === 'now' ? '・今' : state === 'past' ? '・終了' : ''}` : '期間を決めていない'),
    sp && editingSprint === sp.id ? sprintEditor(cfg, sp) : null,
    sp ? h('div', { class: 'tb-sp-bar' }, h('i', { style: `width:${items.length ? (done / items.length) * 100 : 0}%` })) : null,
    h('div', { class: 'tb-cards' },
      shown.map((x) => taskCard(x, { hide: ['sprint'] })),
      shown.length ? null : h('p', { class: 'tb-empty' }, 'なし')));
  };
  const board = h('div', { class: 'tb-spboard' }, col(null), sps.map(col));
  enableDrag(board, { rootSel: '.tb-spboard', onDrop: dropToGroup });
  return [
    addSprintBar(cfg),
    h('p', { class: 'tb-empty tb-sp-help' }, 'スプリント＝期間の箱。カードを引きずって箱の間を動かします。期間が終わると、終わっていないものは次のスプリントへ自動で移ります。'),
    board,
  ];
}

// ---- 3列：左にグループ、右にそのグループのタスク ----
function colsMode(tasks, cfg, s) {
  const key = cfg.groupKey;
  const list = s.showDone ? tasks : tasks.filter(isOpen);
  const { g, buckets } = bucketize(key, list, s.showDone, cfg.compact, cfg);
  const values = [...buckets.keys()];
  // フェーズの行は「…」を横に並べる（ボタンの中にボタンは置けないため、行で包む）
  const colsRow = (v, btn) => {
    const menu = phaseMenu(cfg, key, v, btn.querySelector('.tb-cols-name'), tasks);
    return menu ? h('div', { class: 'tb-cols-row' }, btn, menu) : btn;
  };
  let cur = values.find((v) => idOf(key, v) === s.colPick) ?? null;
  if (cur === null) {
    // 最初はタスクのある最初のグループ
    cur = values.find((v) => buckets.get(v).length) ?? values[0] ?? null;
    s.colOpen = false;
  }
  cfg.setContext({ ...cfg.baseCtx, ...(cur !== null ? ctxFor(key, cur) : {}) });

  const nav = h('nav', { class: 'tb-cols-nav', 'aria-label': 'グループ' },
    values.map((v) => colsRow(v, h('button', {
      type: 'button',
      class: 'tb-cols-item' + (v === cur ? ' is-active' : '') + (buckets.get(v).length ? '' : ' is-empty'),
      'aria-pressed': String(v === cur),
      'data-group-value': v === NONE ? '' : v,
      // 右のタスクを左のフェーズへ引きずって移す（プロジェクトの中だけ）
      ...(key === 'phase' ? { 'data-drop': idOf(key, v), 'data-drop-ok': true } : {}),
      onclick: () => { s.colPick = idOf(key, v); s.colOpen = true; cfg.rerender(); },
    },
    key === 'area' && v !== NONE ? areaDot(v) : null,
    renamable(h('span', { class: 'tb-cols-name' }, nameOf(g, v)), cfg, key, v),
    h('span', { class: 'tb-count' }, String(buckets.get(v).length))))),
    addPhaseBtn(cfg, 'tb-cols-add'));

  const items = cur !== null ? buckets.get(cur) : [];
  if (key === 'phase') items.sort(byManual);
  const pane = h('section', { class: 'tb-cols-pane', ...(key === 'phase' && cur !== null ? { 'data-drop': idOf(key, cur), 'data-drop-ok': true } : {}) },
    h('div', { class: 'tb-cols-head' },
      h('button', { type: 'button', class: 'tb-btn tb-back tb-cols-back', onclick: () => { s.colOpen = false; cfg.rerender(); } }, '‹ 戻る'),
      h('h2', { class: 'tb-cols-title' }, cur !== null ? nameOf(g, cur) : ''),
      h('span', { class: 'tb-count' }, String(items.length))),
    items.length
      ? h('div', { class: 'tb-cards' }, items.map((x) => taskCard(x, { hide: [key] })))
      : h('p', { class: 'tb-empty' }, 'タスクはありません'));

  const cols = h('div', { class: 'tb-cols' + (s.colOpen ? ' is-open' : '') }, nav, pane);
  if (key === 'phase') {
    enableDrag(cols, { rootSel: '.tb-cols', onDrop: dropToGroup });
  }
  return [groupBar(cfg, s),
    values.length ? cols : h('p', { class: 'tb-empty' }, 'タスクはありません')];
}

// ---- カレンダー：月曜始まりの週の格子 ----
// 週の画面と同じく、行を別の日へ引きずる・同じ日の中で並べ替えられる。並び替え▼は週の画面と共通（tb.sort.week）。
// 「日付なし」の行は日の列へ引きずり出せる（日付なしへは落とせない）
function calMode(tasks, cfg, s) {
  const cmp = sorter('manual'); // 並び替えの欄は置かない（引きずって並べ替えられるため。週の画面と同じ）
  const t = todayKey();
  const days = weekDays(addDays(t, s.weekOffset * 7));
  if (s.pickedDay && !days.includes(s.pickedDay)) s.pickedDay = null;
  cfg.setContext({ ...cfg.baseCtx, ...(s.pickedDay ? { doDate: s.pickedDay } : {}) });

  const go = (n) => { s.weekOffset = n; cfg.rerender(); };
  const nav = h('div', { class: 'tb-weeknav' },
    h('button', { type: 'button', class: 'tb-btn', onclick: () => go(s.weekOffset - 1) }, '‹ 前の週'),
    h('button', { type: 'button', class: 'tb-btn' + (s.weekOffset === 0 ? ' is-active' : ''), 'aria-pressed': String(s.weekOffset === 0), onclick: () => go(0) }, '今週'),
    h('button', { type: 'button', class: 'tb-btn', onclick: () => go(s.weekOffset + 1) }, '次の週 ›'),
    h('span', { class: 'tb-weekrange' }, `${md(days[0])} 〜 ${md(days[6])}`));

  // 日付なしは週の画面と同じ帯（ボタンで開く・2行で横に流す）
  const band = noDateStrip(tasks, cmp, cfg);

  const cols = days.map((d) => {
    const planned = tasks.filter((x) => isOpen(x) && x.doDate === d).sort(cmp);
    const dueOnly = tasks.filter((x) => isOpen(x) && x.dueDate === d && x.doDate !== d).sort(cmp);
    const done = tasks.filter((x) => !isOpen(x) && x.doDate === d).sort(compareTasks);
    const picked = s.pickedDay === d;
    const wd = fromKey(d).getDay();
    const head = h('button', {
      type: 'button',
      class: 'tb-day-head' + (d === t ? ' is-today' : '') + (picked ? ' is-picked' : ''),
      'aria-pressed': String(picked),
      onclick: () => { s.pickedDay = picked ? null : d; cfg.rerender(); },
    },
    h('span', { class: 'tb-day-label' + (wd === 0 ? ' is-sun' : wd === 6 ? ' is-sat' : '') }, label(d)),
    d === t ? h('span', { class: 'tb-today-mark' }, '今日') : null,
    h('span', { class: 'tb-count' }, String(planned.length + dueOnly.length)),
    picked ? h('span', { class: 'tb-here' }, 'ここに追加') : null);
    const n = planned.length + dueOnly.length + done.length;
    return h('section', {
      class: 'tb-day' + (d === t ? ' is-today' : '') + (picked ? ' is-picked' : ''), 'data-day': d, 'data-drop': d, 'data-drop-ok': true,
      title: 'ダブルクリックでこの日に追加',
      ondblclick: (e) => {
        if (e.target.closest('.tb-card, button')) return;
        s.pickedDay = d;
        cfg.setContext({ ...cfg.baseCtx, doDate: d });
        cfg.rerender();
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

  const grid = h('div', { class: 'tb-cal' }, nav, band, h('div', { class: 'tb-days' }, cols));
  enableDrag(grid, dayDrag('.tb-cal', () => 'manual', () => cfg.rerender()));
  return [grid];
}

// ---- ボード：列は状態。カードの小さなボタンで状態を変える ----
const MOVES = {
  todo: ['doing', 'waiting'],
  doing: ['waiting', 'done'],
  waiting: ['doing', 'done'],
  done: ['back'],
};
const DONE_LIMIT = 30; // 完了の列に出す最大数（多すぎると重いので）

function moveTo(task, to, cardEl) {
  // 完了から戻す時は、チェックを外す時と同じく前の状態（無ければ未着手）へ
  if (to === 'back') to = task.prevStatus && task.prevStatus !== 'done' ? task.prevStatus : 'todo';
  const patch = to === 'done'
    ? { status: 'done', prevStatus: task.status || 'todo' }
    : { status: to, prevStatus: null };
  updateTask(task.id, patch).catch((e) => {
    console.warn('[task-board] 状態の変更に失敗', e);
    cardEl.querySelector('.tb-err')?.remove();
    const err = h('p', { class: 'tb-err', role: 'alert' }, '保存できませんでした。もう一度押してください');
    cardEl.append(err);
    setTimeout(() => err.remove(), 4000);
  });
}

// カードの下に「→進行中」などのボタンを付ける（ボードと一覧の「進捗」で使う）
export function addMoves(card, task) {
  const lab = Object.fromEntries(STATUSES.map((x) => [x.value, x.label]));
  card.append(h('div', { class: 'tb-moves' },
    MOVES[task.status || 'todo'].map((to) => h('button', {
      type: 'button',
      class: 'tb-move',
      'data-to': to,
      onclick: () => moveTo(task, to, card),
    }, to === 'back' ? '↩ 戻す' : `→${lab[to]}`))));
  return card;
}

// 完了の列：新しく終えた順に DONE_LIMIT 件まで。{ items, more } を返す
export function doneItems(list) {
  const items = [...list].sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  return { items: items.slice(0, DONE_LIMIT), more: Math.max(0, items.length - DONE_LIMIT) };
}

function boardMode(tasks, cfg) {
  cfg.setContext({ ...cfg.baseCtx });
  const cols = STATUSES.map(({ value, label: name }) => {
    let items = tasks.filter((x) => (x.status || 'todo') === value);
    let more = 0;
    if (value === 'done') ({ items, more } = doneItems(items));
    else items.sort(byManual);
    const cards = items.map((x) => addMoves(taskCard(x, { hide: ['status'] }), x));
    return h('section', { class: 'tb-bcol tb-bcol--' + value, 'data-status': value, 'data-drop': `status:${value}`, 'data-drop-ok': true },
      sectionHead(name, items.length + more),
      h('div', { class: 'tb-cards' }, cards,
        items.length ? null : h('p', { class: 'tb-empty' }, 'なし'),
        more ? h('p', { class: 'tb-empty' }, `ほか${more}件`) : null));
  });
  const board = h('div', { class: 'tb-board', role: 'region', 'aria-label': 'ボード', tabindex: '0' }, cols);
  enableDrag(board, { rootSel: '.tb-board', onDrop: dropToGroup });
  return [board];
}

export function renderModes(allTasks, cfg) {
  const s = st(cfg.scope);
  const mode = loadMode(cfg.scope);
  // 絞り込み（用途・状態）。WBS は親子の形を崩さないよう絞らない
  const fkey = `${cfg.scope}:${cfg.project || ''}`;
  const fv = mode === 'wbs' ? null : (projFilters.get(fkey) || null);
  const tasks = allTasks.filter((x) => matchFilter(x, fv));
  const pick = mode === 'wbs' ? null : filterPick({ tasks: allTasks, value: fv, kinds: ['area', 'status'], onChange: (v) => { if (v) projFilters.set(fkey, v); else projFilters.delete(fkey); cfg.rerender(); } });
  extraHide = cfg.hide || [];
  showPhase = false; // フェーズの印（F2）はスプリントに置き換えたので出さない
  const body = mode === 'wbs' ? wbsMode(tasks, cfg)
    : mode === 'sprint' ? sprintMode(tasks, cfg)
    : mode === 'timeline' ? timelineMode(tasks, cfg)
    : mode === 'cols' ? colsMode(tasks, cfg, s)
    : mode === 'cal' ? calMode(tasks, cfg, s)
      : mode === 'board' ? boardMode(tasks, cfg)
        : listMode(tasks, cfg, s);
  return h('div', { class: `tb-modes-wrap is-${mode}`, 'data-mode': mode }, modeBar(cfg.scope, mode, cfg.rerender), pick ? h('div', { class: 'tb-mode-filter' }, pick) : null, body);
}
