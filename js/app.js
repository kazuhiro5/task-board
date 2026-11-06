// 画面全体のまとめ役：ログインの出し分け・画面（今日／週／一覧／プロジェクト）の切り替え・再描画・明るさ。
// 各画面の中身は js/views/*.js、入力欄は js/add.js、編集は js/edit.js が持つ。
//
// 画面の切り替えは navigate(view, params) に集める。
//   view：'today' | 'week' | 'list' | 'projects'
//   params：画面に渡す絞り込み。左の一覧の「用途」→ navigate('list', { area: '就活' })、
//           「プロジェクト」→ navigate('projects', { project: 'X' })、タブ → navigate(view, {})
//   画面は render(container, tasks, opts) の opts.params で受け取る（params は保存しない。再読み込みで {} に戻る）
import * as store from './store.js';
import { mountAdd } from './add.js';
import { inlineAdder } from './views/card.js';
import { renderManageAreas, renderManageProjects } from './views/manage.js';
import { renderToday } from './views/today.js';
import { renderWeek } from './views/week.js';
import { renderList } from './views/list.js';
import { renderProjects } from './views/projects.js';
import { renderTrash } from './views/trash.js';
import { renderSearch, focusSearch } from './views/search.js';
import { showToast } from './toast.js';
import { renderLinks, mountLinkAdd } from './views/links.js';
import { writeBackup, lastBackupLabel } from './backup.js';

// アイコン（24×24、線のみ。外部読み込みなし）
const ICONS = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  week: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  projects: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  project: '<path d="M4 6h16M4 12h10M4 18h7"/>',
  sideClose: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M16 10l-2 2 2 2"/>',
  sideOpen: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M14 10l2 2-2 2"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  links: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

const VIEWS = {
  today: { label: '今日', render: renderToday },
  week: { label: '週', render: renderWeek },
  projects: { label: 'プロジェクト', render: renderProjects },
  list: { label: '一覧', render: renderList },
  links: { label: 'リンク集', render: renderLinks },
};
// タブ・左の一覧に出さない画面（⋯メニューから開く）。開いた画面としては保存しない
const ALL_VIEWS = { ...VIEWS, trash: { label: 'ゴミ箱', render: renderTrash }, search: { label: '検索', render: renderSearch }, manageAreas: { label: '用途管理', render: renderManageAreas }, manageProjects: { label: 'プロジェクト管理', render: renderManageProjects } };

// 用途の一覧と色は store の areaNames()／areaColor()（Firestore の meta/areas。足した用途も含む）
const SIDE_PROJECTS = 8; // 左の一覧に出すプロジェクトの数（最近触った順）

// 画面の状態。ctx は画面から入力欄へ渡す「今開いている分類」（初期値に使う）
const savedView = loadPref('view', 'today');
const state = {
  view: VIEWS[savedView] ? savedView : 'today',
  params: {},
  group: loadPref('group', 'area'),
  ctx: {},
};

function loadPref(k, d) {
  try { return localStorage.getItem(`tb.${k}`) || d; } catch { return d; }
}
function savePref(k, v) {
  try { localStorage.setItem(`tb.${k}`, v); } catch { /* 保存できなくても動く */ }
}
function removePref(k) {
  try { localStorage.removeItem(`tb.${k}`); } catch { /* 保存できなくても動く */ }
}

const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, html) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  if (html) e.insertAdjacentHTML('afterbegin', html);
  return e;
}

const isEmpty = (o) => !o || Object.keys(o).length === 0;

let addBox = null; // mountAdd の戻り値（{ contextChanged }）

// 画面を切り替える（タブ・左の一覧・画面の中から呼ぶ）
function navigate(view, params = {}) {
  if (!ALL_VIEWS[view]) return;
  const changed = view !== state.view || JSON.stringify(params) !== JSON.stringify(state.params);
  state.view = view;
  state.params = { ...params };
  // 入力欄の初期値：絞り込んだ用途・プロジェクトで入る（画面が setContext で上書きしてよい）
  state.ctx = {};
  if (params.area) state.ctx.area = params.area;
  if (params.project) state.ctx.project = params.project;
  if (VIEWS[view]) savePref('view', view);
  render();
  // 描画の後（画面が setContext した後）に、入力欄のタグ表示を今の文脈に合わせる
  if (addBox) addBox.contextChanged();
  ctxSig = JSON.stringify(state.ctx);
  if (changed) window.scrollTo(0, 0);
}

function renderTabbar() {
  $('#tabbar').replaceChildren(...Object.entries(VIEWS).map(([key, v]) => {
    const on = state.view === key;
    const b = el('button', {
      type: 'button', class: 'tabbar-btn' + (on ? ' is-active' : ''), 'aria-current': on ? 'page' : null,
      onclick: () => navigate(key, {}),
    }, icon(key));
    b.appendChild(el('span', { text: v.label }));
    return b;
  }));
}

// 用途・プロジェクトの行（並べ替えはこの行ごと）。削除はここに置かない（押し間違えると影響が大きいため、⋯メニューの「用途管理」「プロジェクト管理」から）
function sideRow(name, item) {
  const row = el('div', { class: 'side-row' });
  row.dataset.name = name;
  row.append(item);
  return row;
}

function sideItem({ active, onclick, html, label, count }) {
  const b = el('button', {
    type: 'button', class: 'side-item' + (active ? ' is-active' : ''), 'aria-current': active ? 'page' : null, onclick,
    title: label, // たたんだ時は文字が隠れるので、マウスを載せると名前が出るように
  }, html);
  b.appendChild(el('span', { class: 'side-name', text: label }));
  // 件数（未完了の数）。読み上げでは「3件」と読む
  if (count != null) b.appendChild(el('span', { class: 'side-count', 'aria-label': `${count}件`, text: String(count) }));
  return b;
}

function renderSide() {
  if (sideDragging) return;
  const p = state.params;
  const views = el('div', { class: 'side-sec' });
  for (const [key, v] of Object.entries(VIEWS)) {
    views.appendChild(sideItem({
      active: state.view === key && isEmpty(p), onclick: () => navigate(key, {}), html: icon(key), label: v.label,
    }));
  }

  const areas = el('div', { class: 'side-sec' });
  areas.appendChild(el('div', { class: 'side-label', text: '用途' }));
  // 用途ごとの未完了の件数（完了は数えない。一覧の用途タブの初期表示と同じ）
  const counts = new Map();
  const pcounts = new Map(); // プロジェクトごとの未完了の件数（用途と同じ数え方）
  for (const t of store.getTasks()) {
    if (t.status === 'done') continue;
    if (t.area) counts.set(t.area, (counts.get(t.area) || 0) + 1);
    if (t.project) pcounts.set(t.project, (pcounts.get(t.project) || 0) + 1);
  }
  for (const a of store.areaNames()) {
    const item = sideItem({
      active: state.view === 'list' && p.area === a,
      onclick: () => navigate('list', { area: a }),
      html: '<span class="cat-dot" aria-hidden="true"></span>',
      label: a,
      count: counts.get(a) || 0,
    });
    const c = store.areaColor(a);
    if (c) item.querySelector('.cat-dot').style.background = c;
    areas.appendChild(sideRow(a, item));
  }
  areas.appendChild(inlineAdder('side-area', {
    label: '＋ 用途を追加', placeholder: '用途の名前', onAdd: store.addArea, rerender: render,
  }));

  const projs = el('div', { class: 'side-sec' });
  projs.appendChild(el('div', { class: 'side-label', text: 'プロジェクト' }));
  const names = store.projectNames().slice(0, SIDE_PROJECTS);
  if (!names.length) projs.appendChild(el('div', { class: 'side-empty', text: 'まだありません' }));
  for (const name of names) {
    const item = sideItem({
      active: state.view === 'projects' && p.project === name,
      onclick: () => navigate('projects', { project: name }),
      html: icon('project'),
      label: name,
      count: pcounts.get(name) || 0,
    });
    projs.appendChild(sideRow(name, item));
  }
  projs.appendChild(inlineAdder('side-project', {
    label: '＋ プロジェクトを追加', placeholder: 'プロジェクトの名前', onAdd: store.addProject, rerender: render,
  }));

  const mini = document.documentElement.classList.contains('side-mini');
  const toggle = el('button', {
    type: 'button', class: 'side-toggle', 'aria-expanded': String(!mini),
    'aria-label': mini ? '左の一覧をひらく' : '左の一覧をたたむ', title: mini ? 'ひらく' : 'たたむ',
    onclick: () => {
      const next = !document.documentElement.classList.contains('side-mini');
      document.documentElement.classList.toggle('side-mini', next);
      if (next) savePref('side', 'mini'); else removePref('side');
      renderSide();
    },
  }, icon(mini ? 'sideOpen' : 'sideClose'));
  const brand = el('div', { class: 'side-brand' });
  brand.append(el('span', { class: 'side-brand-name', text: 'task-board' }), toggle);
  $('#side').replaceChildren(brand, views, areas, projs);
  sortable(areas, (names) => store.reorderAreas(names));
  sortable(projs, (names) => {
    // 左に出していない（9件目以降の）プロジェクトは、並べ替えた分の後ろに今の順のまま付ける
    const rest = store.projectNames().filter((n) => !names.includes(n));
    store.reorderProjects([...names, ...rest]);
  });
}

// 左の一覧の用途・プロジェクトを引きずって並べ替える。左の一覧はPC・iPad（マウス・トラックパッド）だけなので、
// 標準の draggable で足りる（スマホの指には効かないが、スマホに左の一覧は無い）
let sideDragging = false; // 引きずっている間は左の一覧を描き直さない（つかんだ要素が消えるため）
function sortable(sec, onDone) {
  const items = () => [...sec.querySelectorAll('.side-row[data-name]')];
  const before = items().map((x) => x.dataset.name).join('|');
  for (const it of items()) {
    it.draggable = true;
    it.addEventListener('dragstart', (e) => {
      sideDragging = true;
      it.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', it.dataset.name);
    });
    it.addEventListener('dragend', () => {
      it.classList.remove('is-dragging');
      sideDragging = false;
      const names = items().map((x) => x.dataset.name);
      if (names.join('|') !== before) onDone(names);
      else renderSide();
    });
  }
  sec.addEventListener('dragover', (e) => {
    const cur = sec.querySelector('.side-item.is-dragging');
    if (!cur) return; // 別の区分（用途↔プロジェクト）からは受けない
    e.preventDefault();
    const after = items().find((x) => x !== cur && e.clientY < x.getBoundingClientRect().top + x.offsetHeight / 2);
    if (after) after.before(cur);
    else items().filter((x) => x !== cur).at(-1)?.after(cur);
  });
  sec.addEventListener('drop', (e) => e.preventDefault());
}

// 画面から呼ぶ：今開いている分類を入力欄の初期値にする（例：{ area: '就活' }）
// 入力欄のタグの表示も今の文脈に合わせる（手で触った行はそのまま。add.js の contextChanged）。
// 描画中に何度も呼ばれてもよいように、描画の後にまとめて1回だけ。前と同じ文脈なら何もしない
let ctxSig = '';
let ctxQueued = false;
function setContext(ctx) {
  state.ctx = ctx || {};
  if (ctxQueued) return;
  ctxQueued = true;
  queueMicrotask(() => {
    ctxQueued = false;
    const sig = JSON.stringify(state.ctx);
    if (sig === ctxSig) return;
    ctxSig = sig;
    if (addBox) addBox.contextChanged();
  });
}

// 画面から呼ぶ：一覧のグループ分けを変える
function setGroup(g) {
  state.group = g;
  savePref('group', g);
  render();
}

function render() {
  // リンク集の時だけ、タスクの入力欄の代わりにリンクの入力欄を出す
  const onLinks = state.view === 'links';
  $('#add').hidden = onLinks;
  $('#linkAdd').hidden = !onLinks;
  renderTabbar();
  renderSide();
  const p = state.params;
  $('#topTitle').textContent = p.project || p.area || ALL_VIEWS[state.view].label;
  ALL_VIEWS[state.view].render($('#view'), store.getTasks(), {
    group: state.group,
    setGroup,
    setContext,
    rerender: render,
    params: { ...state.params },
    navigate,
  });
}

// ---- 明るさ（端末に合わせる／ライト／ダーク）。保存は localStorage の tb.theme（端末に合わせる＝消す）
// 読み込み直後の反映は index.html の head の小さな script が受け持つ（ちらつき防止）
const THEMES = [
  { value: 'system', label: '端末に合わせる' },
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
];

function currentTheme() {
  const t = loadPref('theme', 'system');
  return t === 'light' || t === 'dark' ? t : 'system';
}

function applyTheme(t) {
  if (t === 'light' || t === 'dark') {
    document.documentElement.setAttribute('data-theme', t);
    savePref('theme', t);
  } else {
    document.documentElement.removeAttribute('data-theme');
    removePref('theme');
  }
  renderThemeOpts();
}

function renderThemeOpts() {
  const now = currentTheme();
  $('#themeOpts').replaceChildren(...THEMES.map((t) => el('button', {
    type: 'button', class: 'theme-opt' + (now === t.value ? ' is-on' : ''), 'aria-pressed': String(now === t.value),
    text: t.label, onclick: () => applyTheme(t.value),
  })));
}

// メニュー（⋯）の外を押したら閉じる
document.addEventListener('pointerdown', (e) => {
  const d = document.querySelector('details.user[open]');
  if (d && !d.contains(e.target)) d.open = false;
});

// ⋯メニューの「バックアップを書き出す」
function showBackupLast() { $('#backupLast').textContent = lastBackupLabel(); }
showBackupLast();
$('#backupBtn').addEventListener('click', async () => {
  const d = document.querySelector('details.user');
  if (d) d.open = false;
  await writeBackup();
  showBackupLast();
});

// 右上の「元に戻す」と Ctrl+Z（⌘Z）：変えた順に1つずつ戻す（store の履歴。保存ボタンは置かない）
function doUndo() {
  if (store.undo()) showToast('1つ前に戻しました');
  else showToast('戻せる操作はありません');
}
$('#undoBtn').insertAdjacentHTML('afterbegin', icon('undo'));
$('#undoBtn').addEventListener('click', doUndo);
const syncUndo = () => { $('#undoBtn').disabled = !store.canUndo(); };
store.onHistory(syncUndo);
syncUndo();
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
  const t = e.target;
  // 文字を打っている所では、ブラウザの文字の取り消しを優先する
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if ($('#appRoot').hidden) return;
  e.preventDefault();
  doUndo();
});

// 上の虫めがね・「/」キー（打っている途中でない時）で検索を開く
function openSearch() { navigate('search', {}); focusSearch(); }
$('#searchBtn').insertAdjacentHTML('afterbegin', icon('search'));
$('#searchBtn').addEventListener('click', openSearch);
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if ($('#appRoot').hidden) return;
  e.preventDefault();
  openSearch();
});

// ⋯メニューの「用途管理」「プロジェクト管理」（削除はここからだけ）
for (const [id, view] of [['manageAreasBtn', 'manageAreas'], ['manageProjectsBtn', 'manageProjects']]) {
  $(`#${id}`).addEventListener('click', () => {
    const d = document.querySelector('details.user');
    if (d) d.open = false;
    navigate(view, {});
  });
}

// ⋯メニューの「ゴミ箱」
$('#trashBtn').addEventListener('click', () => {
  const d = document.querySelector('details.user');
  if (d) d.open = false;
  navigate('trash', {});
});

function showApp(signedIn) {
  $('#login').hidden = signedIn;
  $('#appRoot').hidden = !signedIn;
}

async function boot() {
  renderThemeOpts();
  addBox = mountAdd($('#add'), () => state.ctx);
  mountLinkAdd($('#linkAdd'));
  store.subscribe(() => { if (!$('#appRoot').hidden) render(); });

  if (store.demo) {
    $('#loading').hidden = true;
    showApp(true);
    $('#userBox').textContent = '見本データ（demo）';
    await store.start('demo');
    render();
    return;
  }

  const fb = await import('./firebase.js');
  $('#signInBtn').addEventListener('click', async () => {
    $('#loginError').textContent = '';
    try { await fb.signIn(); } catch (e) { $('#loginError').textContent = `ログインできませんでした（${e.code || e.message}）`; }
  });
  $('#signOutBtn').addEventListener('click', () => fb.signOut());

  fb.watchUser(async (user) => {
    $('#loading').hidden = true;
    if (user) {
      showApp(true);
      $('#userBox').textContent = user.email || '';
      await store.start(user.uid);
      render();
    } else {
      store.stop();
      showApp(false);
    }
  });
}

boot();

// 端末内の保存（Firestoreの控え）を、容量不足などで勝手に消されにくくする
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted().then((ok) => { if (!ok) navigator.storage.persist(); }).catch(() => {});
}

if ('serviceWorker' in navigator && !store.demo) {
  // 新しい版が入ったら読み込み直す（控えをすぐ返す作りのため、そのままだと1つ前の版が見え続ける）。
  // 初めて入った時（それまで控えが無かった時）は読み込み直さない
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js').catch(() => { /* なくても動く */ });
}
