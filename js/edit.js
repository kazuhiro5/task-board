// タスクの編集（全項目・状態・削除）。担当：入力役。
// openEdit(task)：編集画面を開く。<dialog> を画面の上に重ねる（スマホは下からのシート、PCは中央）。
// 「保存」で変わった項目だけ updateTask。「削除」は2回押し。閉じる・Esc・背景クリックで閉じる。
import { updateTask, deleteTask, projectNames } from './store.js';
import { AREAS, SIZES, PRIORITIES, STATUSES } from './constants.js';

const FIELDS = ['title', 'status', 'doDate', 'dueDate', 'area', 'project', 'size', 'priority', 'memo'];

let dialog = null;

function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) e.appendChild(c);
  return e;
}

function chip(label, selected, onClick) {
  return el('button', {
    type: 'button',
    class: 'chip' + (selected ? ' is-on' : ''),
    'aria-pressed': String(!!selected),
    text: label,
    onclick: onClick,
  });
}

function field(label, children) {
  return el('div', { class: 'edit-field' }, [
    el('span', { class: 'edit-label', text: label }),
    el('div', { class: 'edit-control' }, children),
  ]);
}

function getDialog() {
  if (dialog) return dialog;
  dialog = el('dialog', { class: 'edit-dialog', 'aria-label': 'タスクの編集' });
  // 背景（dialog 自身）をクリックしたら閉じる。中身は .edit-sheet が覆う
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  document.body.appendChild(dialog);
  return dialog;
}

export function openEdit(task) {
  if (!task) return;
  const dlg = getDialog();
  const orig = {};
  for (const k of FIELDS) orig[k] = task[k] ?? (k === 'memo' ? '' : null);
  if (!orig.status) orig.status = 'todo';
  const v = { ...orig };
  let armed = false; // 削除を1回押したか

  const form = el('form', { class: 'edit-sheet', autocomplete: 'off' });
  const error = el('p', { class: 'add-error', role: 'alert' });

  const titleInput = el('input', {
    class: 'edit-title', 'aria-label': 'タスク名',
    oninput: (e) => { v.title = e.target.value; error.textContent = ''; },
  });
  titleInput.value = v.title || '';

  // 状態
  const statusBox = el('div', { class: 'edit-seg' });
  function renderStatus() {
    statusBox.replaceChildren(...STATUSES.map((s) => chip(s.label, v.status === s.value, () => { v.status = s.value; renderStatus(); })));
  }

  // 日付（date入力＋なし）
  function dateControl(key, label) {
    const input = el('input', { type: 'date', class: 'tag-date', 'aria-label': label });
    input.value = v[key] || '';
    const none = chip('なし', !v[key], () => { v[key] = null; input.value = ''; sync(); });
    function sync() { none.classList.toggle('is-on', !v[key]); none.setAttribute('aria-pressed', String(!v[key])); }
    input.addEventListener('change', () => { v[key] = input.value || null; sync(); });
    return [input, none];
  }

  // チップ1行（もう一度押すと解除）
  function chipControl(key, options) {
    const box = el('div', { class: 'tag-chips' });
    const opts = [...options];
    if (v[key] && !opts.includes(v[key])) opts.push(v[key]);
    function render() {
      box.replaceChildren(...opts.map((o) => chip(o, v[key] === o, () => { v[key] = v[key] === o ? null : o; render(); })));
    }
    render();
    return box;
  }

  // プロジェクト：既存から選ぶ＋自由入力
  const projInput = el('input', {
    class: 'tag-newproject', placeholder: 'プロジェクト名（なしは空）', 'aria-label': 'プロジェクト',
    oninput: (e) => { v.project = e.target.value.trim() || null; renderProj(); },
  });
  projInput.value = v.project || '';
  const projChips = el('div', { class: 'tag-chips' });
  const projList = projectNames().slice(0, 6);
  function renderProj() {
    projChips.replaceChildren(...projList.map((p) => chip(p, v.project === p, () => {
      v.project = v.project === p ? null : p;
      projInput.value = v.project || '';
      renderProj();
    })));
  }

  const memoBox = el('textarea', {
    class: 'tag-memo', rows: '4', 'aria-label': 'メモ',
    oninput: (e) => { v.memo = e.target.value; },
  });
  memoBox.value = v.memo || '';

  const delBtn = el('button', { type: 'button', class: 'edit-delete', text: '削除' });
  delBtn.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      delBtn.textContent = 'もう一度押すと削除';
      delBtn.classList.add('is-armed');
      return;
    }
    delBtn.disabled = true;
    try {
      await deleteTask(task.id);
      dlg.close();
    } catch (err) {
      error.textContent = `削除できませんでした（${err.message || err}）`;
      delBtn.disabled = false;
    }
  });
  const closeBtn = el('button', { type: 'button', class: 'edit-close', text: '閉じる', onclick: () => dlg.close() });
  const saveBtn = el('button', { type: 'submit', class: 'primary', text: '保存' });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    v.title = (v.title || '').trim();
    if (!v.title) { error.textContent = 'タスク名を入れてください'; titleInput.focus(); return; }
    const patch = {};
    for (const k of FIELDS) if ((v[k] ?? null) !== (orig[k] ?? null)) patch[k] = v[k];
    if (!Object.keys(patch).length) { dlg.close(); return; }
    saveBtn.disabled = true;
    try {
      await updateTask(task.id, patch);
      dlg.close();
    } catch (err) {
      error.textContent = `保存できませんでした（${err.message || err}）`;
      saveBtn.disabled = false;
    }
  });

  renderStatus();
  renderProj();
  const [doIn, doNone] = dateControl('doDate', 'やる日');
  const [dueIn, dueNone] = dateControl('dueDate', '締切');

  form.append(
    el('div', { class: 'edit-head' }, [el('h2', { class: 'edit-heading', text: '編集' }), closeBtn]),
    field('タスク名', [titleInput]),
    field('状態', [statusBox]),
    field('やる日', [el('div', { class: 'edit-date' }, [doIn, doNone])]),
    field('締切', [el('div', { class: 'edit-date' }, [dueIn, dueNone])]),
    field('用途', [chipControl('area', AREAS)]),
    field('プロジェクト', [projInput, projChips]),
    field('大中小', [chipControl('size', SIZES)]),
    field('優先度', [chipControl('priority', PRIORITIES)]),
    field('メモ', [memoBox]),
    error,
    el('div', { class: 'edit-actions' }, [delBtn, saveBtn]),
  );

  if (dlg.open) dlg.close();
  dlg.replaceChildren(form);
  dlg.showModal(); // 最初のボタン（閉じる）にフォーカスが行く。スマホでいきなりキーボードを出さないため
}
