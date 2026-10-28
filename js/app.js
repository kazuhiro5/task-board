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
import { AREAS } from './constants.js';
import { renderToday } from './views/today.js';
import { renderWeek } from './views/week.js';
import { renderList } from './views/list.js';
import { renderProjects } from './views/projects.js';

// アイコン（24×24、線のみ。外部読み込みなし）
const ICONS = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  week: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  projects: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  project: '<path d="M4 6h16M4 12h10M4 18h7"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

const VIEWS = {
  today: { label: '今日', render: renderToday },
  week: { label: '週', render: renderWeek },
  projects: { label: 'プロジェクト', render: renderProjects },
  list: { label: '一覧', render: renderList },
};

// 用途 → 色の変数（css/style.css）。CSS変数に日本語を使わないため英字にしている。
// 使い方：style="--cat: var(--cat-job)"、または class="cat-dot cat-job"（--cat-job の「--」を除いた名前）
export const AREA_VAR = {
  大学: '--cat-univ', AI開発: '--cat-ai', 就活: '--cat-job', バイト: '--cat-work', 勉強: '--cat-study', 家事: '--cat-home',
};
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
  if (!VIEWS[view]) return;
  const changed = view !== state.view || JSON.stringify(params) !== JSON.stringify(state.params);
  state.view = view;
  state.params = { ...params };
  // 入力欄の初期値：絞り込んだ用途・プロジェクトで入る（画面が setContext で上書きしてよい）
  state.ctx = {};
  if (params.area) state.ctx.area = params.area;
  if (params.project) state.ctx.project = params.project;
  savePref('view', view);
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

function sideItem({ active, onclick, html, label }) {
  const b = el('button', {
    type: 'button', class: 'side-item' + (active ? ' is-active' : ''), 'aria-current': active ? 'page' : null, onclick,
  }, html);
  b.appendChild(el('span', { class: 'side-name', text: label }));
  return b;
}

function renderSide() {
  const p = state.params;
  const views = el('div', { class: 'side-sec' });
  for (const [key, v] of Object.entries(VIEWS)) {
    views.appendChild(sideItem({
      active: state.view === key && isEmpty(p), onclick: () => navigate(key, {}), html: icon(key), label: v.label,
    }));
  }

  const areas = el('div', { class: 'side-sec' });
  areas.appendChild(el('div', { class: 'side-label', text: '用途' }));
  for (const a of AREAS) {
    const cls = (AREA_VAR[a] || '').replace('--', '');
    areas.appendChild(sideItem({
      active: state.view === 'list' && p.area === a,
      onclick: () => navigate('list', { area: a }),
      html: `<span class="cat-dot ${cls}" aria-hidden="true"></span>`,
      label: a,
    }));
  }

  const projs = el('div', { class: 'side-sec' });
  projs.appendChild(el('div', { class: 'side-label', text: 'プロジェクト' }));
  const names = store.projectNames().slice(0, SIDE_PROJECTS);
  if (!names.length) projs.appendChild(el('div', { class: 'side-empty', text: 'まだありません' }));
  for (const name of names) {
    projs.appendChild(sideItem({
      active: state.view === 'projects' && p.project === name,
      onclick: () => navigate('projects', { project: name }),
      html: icon('project'),
      label: name,
    }));
  }

  $('#side').replaceChildren(el('div', { class: 'side-brand', text: 'task-board' }), views, areas, projs);
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
  renderTabbar();
  renderSide();
  const p = state.params;
  $('#topTitle').textContent = p.project || p.area || VIEWS[state.view].label;
  VIEWS[state.view].render($('#view'), store.getTasks(), {
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

function showApp(signedIn) {
  $('#login').hidden = signedIn;
  $('#appRoot').hidden = !signedIn;
}

async function boot() {
  renderThemeOpts();
  addBox = mountAdd($('#add'), () => state.ctx);
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
  navigator.serviceWorker.register('./sw.js').catch(() => { /* なくても動く */ });
}
