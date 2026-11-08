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
import { updateTask, deleteTask, projectNames, getSprints, sprintState, areaNames, lastHistory, undo, parentChoices } from './store.js';
import { showToast } from './toast.js';
import { todayKey, addDays, relLabel } from './dates.js';
import { repeatEditor, normRepeat } from './repeat.js';
import { PRIORITIES, STATUSES } from './constants.js';

// size（大中小）はなくした。古いタスクに値が残っていても、ここでは出さず書き換えもしない
const FIELDS = ['title', 'status', 'doDate', 'dueDate', 'area', 'project', 'parent', 'sprint', 'priority', 'repeat', 'memo'];
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
  // パネル（PC）は、パネルの外を押したら閉じる。直した所があれば保存してから（「保存」を押したのと同じ）。
  // 閉じるボタンや Esc を毎回押すのが手間なため。名前が空なら閉じずにエラーを出す（保存の処理がする）
  document.addEventListener('pointerdown', (e) => {
    if (!isPanel() || dialog.contains(e.target) || e.target.closest?.('.toast')) return;
    const form = dialog.querySelector('form');
    if (form) form.requestSubmit(); else closeEdit();
  }, true);

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
    class: 'edit-title', 'aria-label': 'タスク名', placeholder: 'タスク名',
    oninput: (e) => { v.title = e.target.value; error.textContent = ''; },
  });
  titleInput.value = v.title || '';

  // 見た目はタスクの追加（入力欄）と同じ形：上に名前と内容、その下に「見出し＋横に流すボタン」の行。
  // 編集だけの行は「進捗」（未着手・進行中・待ち・完了）
  const row = (label, children, cls = '') => el('div', { class: 'tag-row' + (cls ? ` ${cls}` : '') }, [
    el('span', { class: 'tag-label', text: label }),
    el('div', { class: 'tag-chips' }, children),
  ]);

  // 進捗（状態）
  const statusBox = el('div', { class: 'tag-chips' });
  function renderStatus() {
    statusBox.replaceChildren(...STATUSES.map((s) => chip(s.label, v.status === s.value, () => { v.status = s.value; renderStatus(); })));
  }
  const statusRow = el('div', { class: 'tag-row' }, [el('span', { class: 'tag-label', text: '進捗' }), statusBox]);

  // チップ1行（もう一度押すと解除）
  function chipRow(key, label, options) {
    const box = el('div', { class: 'tag-chips' });
    const opts = [...options];
    if (v[key] && !opts.includes(v[key])) opts.push(v[key]);
    function render() {
      box.replaceChildren(...opts.map((o) => chip(o, v[key] === o, () => { v[key] = v[key] === o ? null : o; render(); })));
    }
    render();
    return el('div', { class: 'tag-row' }, [el('span', { class: 'tag-label', text: label }), box]);
  }

  // やる日・締切：入力欄と同じ「なし／今日／明日（／明後日）／日付…」。決まった日以外は「日付…」の横に日付の欄
  function dateRow(key, label, presets) {
    const box = el('div', { class: 'tag-chips' });
    let custom = !!v[key] && !presets.some(([, d]) => d === v[key]);
    function render() {
      const chips = [
        chip('なし', !v[key] && !custom, () => { v[key] = null; custom = false; render(); }),
        ...presets.map(([l, d]) => chip(l, !custom && v[key] === d, () => { v[key] = d; custom = false; render(); })),
        chip(custom && v[key] ? relLabel(v[key]) : '日付…', custom, () => {
          custom = !custom;
          if (!custom) v[key] = null;
          render();
          if (custom) { const inp = box.querySelector('input'); inp?.focus(); try { inp?.showPicker(); } catch { /* 開けない端末では欄だけ */ } }
        }),
      ];
      if (custom) {
        const inp = el('input', { type: 'date', class: 'tag-date', 'aria-label': `${label}の日付` });
        inp.value = v[key] || '';
        inp.addEventListener('change', () => { v[key] = inp.value || null; render(); });
        chips.push(inp);
      }
      box.replaceChildren(...chips);
    }
    render();
    return el('div', { class: 'tag-row' }, [el('span', { class: 'tag-label', text: label }), box]);
  }

  // プロジェクト：入力欄と同じ「選ぶ欄」（最後に「＋ 新しいプロジェクト」）
  const NEW = '\u0000new';
  const projBox = el('div', { class: 'tag-chips' });
  let newProject = false;
  function renderProj() {
    const names = projectNames();
    const custom = v.project && !names.includes(v.project);
    const sel = el('select', {
      class: 'tag-select', 'aria-label': 'プロジェクト',
      onchange: (e) => {
        newProject = e.target.value === NEW;
        v.project = newProject || !e.target.value ? null : e.target.value;
        renderProj();
        renderPhase();
        if (newProject) projBox.querySelector('.tag-newproject')?.focus();
      },
    }, [el('option', { value: '', text: 'プロジェクトなし' }), ...names.map((n) => el('option', { value: n, text: n })), el('option', { value: NEW, text: '＋ 新しいプロジェクト' })]);
    sel.value = newProject || custom ? NEW : (v.project || '');
    const parts = [sel];
    if (newProject || custom) {
      const inp = el('input', {
        type: 'text', class: 'tag-newproject', placeholder: 'プロジェクト名', 'aria-label': '新しいプロジェクト名',
        oninput: (e) => { v.project = e.target.value.trim() || null; renderPhase(); },
      });
      inp.value = custom ? v.project : '';
      parts.push(inp);
    }
    projBox.replaceChildren(...parts);
  }
  const projRow = el('div', { class: 'tag-row' }, [el('span', { class: 'tag-label', text: 'プロジェクト' }), projBox]);

  // スプリント：プロジェクトが付いている時だけ（バックログ＋そのプロジェクトのスプリント）。プロジェクトを変えたら外す
  const phaseChips = el('div', { class: 'tag-chips' });
  const phaseField = el('div', { class: 'tag-row' }, [el('span', { class: 'tag-label', text: 'スプリント' }), phaseChips]);
  let sprintOf = v.project;
  // WBSの親：同じプロジェクトの2段目までのタスク（自分と自分の下は選べない）
  const parentSel = el('select', { class: 'tag-select', 'aria-label': '親', onchange: (e) => { v.parent = e.target.value || null; } });
  const parentField = el('div', { class: 'tag-row' }, [el('span', { class: 'tag-label', text: '親' }), el('div', { class: 'tag-chips' }, [parentSel])]);
  function renderParent() {
    const list = v.project ? parentChoices(v.project, task.id) : [];
    parentField.style.display = list.length ? '' : 'none';
    if (v.parent && !list.some((x) => x.id === v.parent)) v.parent = null;
    parentSel.replaceChildren(el('option', { value: '', text: 'いちばん上の段' }), ...list.map((x) => el('option', { value: x.id, text: `${'　'.repeat(x.level - 1)}${x.level > 1 ? '└ ' : ''}${x.title}` })));
    parentSel.value = v.parent || '';
  }
  function renderPhase() {
    if (v.project !== sprintOf) { v.sprint = null; v.parent = null; sprintOf = v.project; }
    renderParent();
    phaseField.style.display = v.project ? '' : 'none';
    if (!v.project) { phaseChips.replaceChildren(); return; }
    const list = getSprints(v.project);
    phaseChips.replaceChildren(
      chip('バックログ', !v.sprint, () => { v.sprint = null; renderPhase(); }),
      ...list.map((sp) => chip(`${sp.name}${sprintState(sp) === 'now' ? '（今）' : sprintState(sp) === 'past' ? '（終了）' : ''}`, v.sprint === sp.id, () => { v.sprint = sp.id; renderPhase(); })),
    );
  }

  const memoBox = el('textarea', {
    class: 'tag-memo', rows: '3', placeholder: '内容', 'aria-label': '内容',
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
    const entry = lastHistory();
    showToast('削除しました', { action: '元に戻す', onAction: () => undo(entry) });
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
  const today = todayKey();

  // 上（見出し・閉じる）／中（項目。ここだけ流れる）／下（保存。いつも見える）
  form.append(
    el('div', { class: 'edit-head' }, [
      el('h2', { class: 'edit-heading', text: '編集' }),
      el('div', { class: 'edit-head-btns' }, [expandBtn, closeBtn]),
    ]),
    el('div', { class: 'edit-body edit-like-add' }, [
      // 並びはタスクの追加と同じ：名前 → 内容 → 進捗（編集だけ）→ 優先度 → 用途 → やる日 → 締切 → 繰り返し → プロジェクト → 親 → スプリント
      titleInput,
      memoBox,
      statusRow,
      chipRow('priority', '優先度', PRIORITIES),
      chipRow('area', '用途', areaNames()),
      dateRow('doDate', 'やる日', [['今日', today], ['明日', addDays(today, 1)], ['明後日', addDays(today, 2)]]),
      dateRow('dueDate', '締切', [['今日', today], ['明日', addDays(today, 1)]]),
      row('繰り返し', [repeatEditor({ value: v.repeat, base: () => v.doDate, onChange: (r) => { v.repeat = r; } })]),
      projRow,
      parentField,
      phaseField,
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
