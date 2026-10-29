// タスクの編集（全項目・状態・削除）。担当：入力役（開き方は詳細役）。
// openEdit(task)：編集画面を開く。1つの <dialog> を幅で使い分ける。
// - 幅840px以上：右のパネル（show()＝非モーダル。背景は暗くしない。一覧を見たまま直せる）。
//   開いている間は body に has-detail を付け、edit.css で一覧を右に寄せない（隠さない）。
//   別のタスクを押したら中身を入れ替える。閉じるボタン・Esc で閉じる。
// - 幅840px未満：下から半分のシート（showModal()）。背景を押すと閉じる。
//   つまみを上に引く・「広げる」で全画面、下に引くと（全画面なら半分に、半分なら）閉じる。
// - 幅が途中で変わったら（iPad の回転）、開いているものの形を切り替える。
// 「保存」で変わった項目だけ updateTask。「削除」は2回押し。削除はゴミ箱へ入れ、画面の下に「元に戻す」を約6秒出す。
// 保存・削除は待たずに閉じる（Firestore はオフラインだと Promise が終わらないが、端末内には即座に入る）。
// 失敗した時は、閉じた後なので入力欄のエラー欄（.add-error）に短く出す。
// 閉じたら、開いた元のカードにフォーカスを戻す。
import { updateTask, deleteTask, restoreTask, projectNames, getPhases } from './store.js';
import { showToast } from './toast.js';
import { repeatEditor, normRepeat } from './repeat.js';
import { AREAS, PRIORITIES, STATUSES } from './constants.js';

// size（大中小）はなくした。古いタスクに値が残っていても、ここでは出さず書き換えもしない
const FIELDS = ['title', 'status', 'doDate', 'dueDate', 'area', 'project', 'phase', 'priority', 'repeat', 'memo'];
const WIDE = '(min-width: 840px)';

let dialog = null;
let wideMq = null;
let current = null; // { taskId, opener, closeBtn }
let expanded = false; // シートを全画面にしているか

function showError(text) {
  const box = document.querySelector('#add .add-error') || document.querySelector('.add-error');
  if (box) box.textContent = text;
}

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

const isWide = () => !!wideMq?.matches;
const isPanel = () => !!dialog?.open && dialog.classList.contains('is-panel');

// 開いている形（パネル／シート）を、今の幅に合わせて付け直して開く
function present() {
  const wide = isWide();
  dialog.classList.toggle('is-panel', wide);
  dialog.classList.toggle('is-sheet', !wide);
  dialog.classList.toggle('is-full', !wide && expanded);
  document.body.classList.toggle('has-detail', wide);
  if (wide) dialog.show(); else dialog.showModal();
}

function setExpanded(on) {
  expanded = on;
  dialog.classList.toggle('is-full', on && !isWide());
  const btn = dialog.querySelector('.edit-expand');
  if (btn) {
    btn.textContent = on ? '縮める' : '広げる';
    btn.setAttribute('aria-expanded', String(on));
  }
}

// 閉じる（保存・削除・閉じるボタン・Esc・背景・つまみ、すべてここを通る）
function closeEdit() {
  if (!dialog?.open) return;
  const ae = document.activeElement;
  const focusWasHere = !ae || ae === document.body || dialog.contains(ae);
  const ref = current;
  current = null;
  dialog.close();
  dialog.style.transform = '';
  dialog.style.height = '';
  document.body.classList.remove('has-detail');
  setExpanded(false);
  if (!ref || !focusWasHere) return;
  // 保存すると一覧が描き直されて元のボタンが入れ替わるので、描き直しの後に同じタスクの行を探す
  requestAnimationFrame(() => {
    const sel = `.tb-card[data-id="${CSS.escape(String(ref.taskId))}"] .tb-body`;
    const target = document.querySelector(sel) || (ref.opener?.isConnected ? ref.opener : null);
    target?.focus();
  });
}

// シートの時は Tab を中で回す（最後→最初、最初→最後）
function trapTab(e) {
  if (e.key !== 'Tab' || !dialog.classList.contains('is-sheet')) return;
  const items = [...dialog.querySelectorAll('button, input, textarea, select, [tabindex]:not([tabindex="-1"])')]
    .filter((x) => !x.disabled && x.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// つまみ：上に引くと全画面、下に引くと（全画面→半分、半分→閉じる）。動かさずに押したら切り替え
function makeGrip() {
  const grip = el('div', { class: 'edit-grip', 'aria-hidden': 'true' });
  let startY = null;
  let dy = 0;
  grip.addEventListener('pointerdown', (e) => {
    startY = e.clientY; dy = 0;
    grip.setPointerCapture(e.pointerId);
    dialog.classList.add('is-dragging');
  });
  grip.addEventListener('pointermove', (e) => {
    if (startY === null) return;
    dy = e.clientY - startY;
    if (dy > 0) { dialog.style.transform = `translateY(${dy}px)`; dialog.style.height = ''; }
    else if (!expanded) { dialog.style.transform = ''; dialog.style.height = `calc(50dvh + ${-dy}px)`; }
  });
  const end = () => {
    if (startY === null) return;
    startY = null;
    dialog.classList.remove('is-dragging');
    dialog.style.transform = '';
    dialog.style.height = '';
    if (dy < -50) setExpanded(true);
    else if (dy > 80) { if (expanded) setExpanded(false); else closeEdit(); }
    else if (Math.abs(dy) < 5) setExpanded(!expanded);
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
  return grip;
}

function getDialog() {
  if (dialog) return dialog;
  dialog = el('dialog', { class: 'edit-dialog', 'aria-label': 'タスクの編集' });
  // 背景（シートの外）を押したら閉じる。dialog 自身が押された時だけ＝中身の外
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog || !dialog.classList.contains('is-sheet')) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) closeEdit();
  });
  // モーダル（シート）の Esc：自分の閉じ方に通す
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); closeEdit(); });
  dialog.addEventListener('keydown', trapTab);
  // パネル（非モーダル）は Esc で閉じない作りなので、自分で拾う。
  // 入力欄（追加）に打っている最中の Esc では閉じない
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isPanel()) return;
    const ae = document.activeElement;
    if (ae && ae !== document.body && !dialog.contains(ae) && !ae.closest('.tb-card')) return;
    e.preventDefault();
    closeEdit();
  });
  // 幅が変わったら（iPad の回転など）形を切り替える
  wideMq = window.matchMedia(WIDE);
  wideMq.addEventListener('change', () => {
    if (!dialog.open) { document.body.classList.remove('has-detail'); return; }
    const ae = document.activeElement;
    const keep = dialog.contains(ae) ? ae : null;
    dialog.close();
    present();
    (keep || current?.closeBtn)?.focus();
  });
  document.body.appendChild(dialog);
  return dialog;
}

export function openEdit(task) {
  if (!task) return;
  const dlg = getDialog();
  const orig = {};
  for (const k of FIELDS) orig[k] = task[k] ?? (k === 'memo' ? '' : null);
  if (!orig.status) orig.status = 'todo';
  orig.repeat = normRepeat(orig.repeat);
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
    oninput: (e) => { v.project = e.target.value.trim() || null; renderProj(); renderPhase(); },
  });
  projInput.value = v.project || '';
  const projChips = el('div', { class: 'tag-chips' });
  const projList = projectNames().slice(0, 6);
  function renderProj() {
    projChips.replaceChildren(...projList.map((p) => chip(p, v.project === p, () => {
      v.project = v.project === p ? null : p;
      projInput.value = v.project || '';
      renderProj();
      renderPhase();
    })));
  }

  // フェーズ：プロジェクトが付いている時だけ（1…N＋なし）。プロジェクトを外したら phase も null
  const phaseChips = el('div', { class: 'tag-chips' });
  const phaseField = field('フェーズ', [phaseChips]);
  function renderPhase() {
    if (!v.project) v.phase = null;
    phaseField.style.display = v.project ? '' : 'none'; // .edit-field は display 指定があり hidden が効かないため
    if (!v.project) { phaseChips.replaceChildren(); return; }
    const n = Math.max(getPhases(v.project), v.phase || 0);
    const opts = Array.from({ length: n }, (_, i) => i + 1);
    phaseChips.replaceChildren(
      ...opts.map((o) => chip(String(o), v.phase === o, () => { v.phase = v.phase === o ? null : o; renderPhase(); })),
      chip('なし', !v.phase, () => { v.phase = null; renderPhase(); }),
    );
  }

  const memoBox = el('textarea', {
    class: 'tag-memo', rows: '4', placeholder: 'タスクの内容', 'aria-label': '内容',
    oninput: (e) => { v.memo = e.target.value; },
  });
  memoBox.value = v.memo || '';

  const delBtn = el('button', { type: 'button', class: 'edit-delete', text: '削除' });
  delBtn.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      delBtn.textContent = 'もう一度押すと削除';
      delBtn.classList.add('is-armed');
      return;
    }
    closeEdit();
    deleteTask(task.id).catch((err) => {
      showError(`「${orig.title}」を削除できませんでした（${err.message || err}）`);
    });
    showToast('削除しました', {
      action: '元に戻す',
      onAction: () => restoreTask(task.id).catch((err) => showError(`戻せませんでした（${err.message || err}）`)),
    });
  });
  const closeBtn = el('button', { type: 'button', class: 'edit-close', text: '閉じる', onclick: () => closeEdit() });
  const expandBtn = el('button', {
    type: 'button', class: 'edit-expand', 'aria-expanded': String(expanded),
    text: expanded ? '縮める' : '広げる', onclick: () => setExpanded(!expanded),
  });
  const saveBtn = el('button', { type: 'submit', class: 'primary', text: '保存' });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    v.title = (v.title || '').trim();
    if (!v.title) { error.textContent = 'タスク名を入れてください'; titleInput.focus(); return; }
    const patch = {};
    for (const k of FIELDS) {
      const same = k === 'repeat' ? JSON.stringify(v[k] ?? null) === JSON.stringify(orig[k] ?? null) : (v[k] ?? null) === (orig[k] ?? null);
      if (!same) patch[k] = v[k];
    }
    closeEdit();
    if (!Object.keys(patch).length) return;
    updateTask(task.id, patch).catch((err) => {
      showError(`「${v.title}」を保存できませんでした（${err.message || err}）`);
    });
  });

  renderStatus();
  renderProj();
  renderPhase();
  const [doIn, doNone] = dateControl('doDate', 'やる日');
  const [dueIn, dueNone] = dateControl('dueDate', '締切');

  // 上（見出し・閉じる）／中（項目。ここだけ流れる）／下（保存。いつも見える）
  form.append(
    el('div', { class: 'edit-head' }, [
      el('h2', { class: 'edit-heading', text: '編集' }),
      el('div', { class: 'edit-head-btns' }, [expandBtn, closeBtn]),
    ]),
    el('div', { class: 'edit-body' }, [
      field('タスク名', [titleInput]),
      field('状態', [statusBox]),
      field('やる日', [el('div', { class: 'edit-date' }, [doIn, doNone])]),
      field('締切', [el('div', { class: 'edit-date' }, [dueIn, dueNone])]),
      field('用途', [chipControl('area', AREAS)]),
      field('プロジェクト', [projInput, projChips]),
      phaseField,
      field('優先度', [chipControl('priority', PRIORITIES)]),
      field('繰り返し', [repeatEditor({ value: v.repeat, base: () => v.doDate, onChange: (r) => { v.repeat = r; } })]),
      field('内容', [memoBox]),
    ]),
    el('div', { class: 'edit-foot' }, [
      error,
      el('div', { class: 'edit-actions' }, [delBtn, saveBtn]),
    ]),
  );

  // 開いた元（カードの行）。パネルで別のタスクを押した時は、新しく押した方に差し替える
  const ae = document.activeElement;
  const opener = ae && ae !== document.body && !dlg.contains(ae) ? ae : current?.opener || null;
  current = { taskId: task.id, opener, closeBtn };

  dlg.replaceChildren(makeGrip(), form);
  if (!dlg.open) present();
  closeBtn.focus(); // 最初は「閉じる」に。スマホでいきなりキーボードを出さないため
}
