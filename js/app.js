// 画面全体のまとめ役：ログインの出し分け・画面（今日／週／一覧）の切り替え・再描画。
// 各画面の中身は js/views/*.js、入力欄は js/add.js、編集は js/edit.js が持つ。
import * as store from './store.js';
import { mountAdd } from './add.js';
import { renderToday } from './views/today.js';
import { renderWeek } from './views/week.js';
import { renderList } from './views/list.js';

const VIEWS = {
  today: { label: '今日', render: renderToday },
  week: { label: '週', render: renderWeek },
  list: { label: '一覧', render: renderList },
};

// 画面の状態。ctx は画面から入力欄へ渡す「今開いている分類」（初期値に使う）
const state = {
  view: loadPref('view', 'today'),
  group: loadPref('group', 'area'),
  ctx: {},
};

function loadPref(k, d) {
  try { return localStorage.getItem(`tb.${k}`) || d; } catch { return d; }
}
function savePref(k, v) {
  try { localStorage.setItem(`tb.${k}`, v); } catch { /* 保存できなくても動く */ }
}

const $ = (sel) => document.querySelector(sel);

function renderTabs() {
  const nav = $('#tabs');
  nav.innerHTML = '';
  for (const [key, v] of Object.entries(VIEWS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = v.label;
    b.className = 'tab' + (state.view === key ? ' is-active' : '');
    b.setAttribute('aria-pressed', String(state.view === key));
    b.addEventListener('click', () => { state.view = key; state.ctx = {}; savePref('view', key); render(); });
    nav.appendChild(b);
  }
}

// 画面から呼ぶ：今開いている分類を入力欄の初期値にする（例：{ area: '就活' }）
function setContext(ctx) {
  state.ctx = ctx || {};
}

// 画面から呼ぶ：一覧のグループ分けを変える
function setGroup(g) {
  state.group = g;
  savePref('group', g);
  render();
}

function render() {
  renderTabs();
  const main = $('#view');
  VIEWS[state.view].render(main, store.getTasks(), {
    group: state.group,
    setGroup,
    setContext,
    rerender: render,
  });
}

function showApp(signedIn) {
  $('#login').hidden = signedIn;
  $('#appRoot').hidden = !signedIn;
}

async function boot() {
  mountAdd($('#add'), () => state.ctx);
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

if ('serviceWorker' in navigator && !store.demo) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* なくても動く */ });
}
