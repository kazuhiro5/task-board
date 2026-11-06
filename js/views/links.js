// 画面「リンク集」。担当：画面役。
// renderLinks(container, tasks, opts)：よく使うサイトを用途ごとに並べる。押すと新しいタブで開く。
// 用途ごとに「＋ リンクを追加」（名前とURL。名前が空ならサイトのアドレスを出す）。
// 「編集」で名前・URLを直す・消す（消すは2回押し。ゴミ箱には入れない）。
import { getLinks, addLink, updateLink, deleteLink, areaNames } from '../store.js';
import { h, areaDot } from './card.js';
import { showToast } from '../toast.js';

// 開いている入力欄。adding：足している用途、editing：直しているリンクの id。
// 入力中の文字は描き直しても消えないように覚えておく（Firestore の更新で描き直されるため）
const st = { adding: null, editing: null, name: '', url: '', err: '', armed: false, focus: false };
let armTimer = 0;

function fail(msg) {
  return (e) => {
    console.warn('[task-board]', msg, e);
    showToast(`${msg}（${e.message || e}）`);
  };
}

function closeForm() {
  Object.assign(st, { adding: null, editing: null, name: '', url: '', err: '', armed: false });
}

// 表示名：名前が無ければアドレスの「www.」を外した部分
function label(x) {
  if (x.name) return x.name;
  try { return new URL(x.url).hostname.replace(/^www\./, ''); } catch { return x.url; }
}
function host(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// 名前とURLの入力欄（足す時・直す時で共通）
function form({ onSave, saveLabel, extra, rerender }) {
  const had = st.focus;
  st.focus = false;
  const name = h('input', {
    type: 'text', class: 'tb-adder-input', placeholder: '名前（空ならアドレス）', 'aria-label': '名前', maxlength: '40',
  });
  const url = h('input', {
    type: 'url', class: 'tb-adder-input', placeholder: 'https://…', 'aria-label': 'URL', inputmode: 'url',
    autocapitalize: 'off', spellcheck: 'false',
  });
  name.value = st.name;
  url.value = st.url;
  name.addEventListener('input', () => { st.name = name.value; });
  url.addEventListener('input', () => { st.url = url.value; });
  const cancel = () => { closeForm(); rerender(); };
  for (const i of [name, url]) i.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } });
  const submit = (e) => {
    e.preventDefault();
    try {
      const p = onSave({ name: st.name, url: st.url });
      if (p && p.catch) p.catch(fail('保存できませんでした'));
      closeForm();
    } catch (err) {
      st.err = err.message || String(err);
      st.focus = true;
    }
    rerender();
  };
  // novalidate：ブラウザの URL の確かめは「https:// の無いアドレス」を断ってしまうため。確かめは store の normUrl で行う
  const f = h('form', { class: 'tb-adder tb-link-form', autocomplete: 'off', novalidate: true, onsubmit: submit },
    name,
    url,
    h('div', { class: 'tb-adder-line' },
      h('button', { type: 'submit', class: 'tb-adder-ok' }, saveLabel),
      h('button', { type: 'button', class: 'tb-btn', onclick: cancel }, 'やめる'),
      extra),
    st.err ? h('p', { class: 'tb-adder-err', role: 'alert' }, st.err) : null);
  if (had) requestAnimationFrame(() => { if (name.isConnected) (st.err && st.url ? url : name).focus(); });
  return f;
}

function linkRow(x, rerender) {
  if (st.editing === x.id) {
    const del = h('button', {
      type: 'button',
      class: 'tb-btn tb-danger tb-link-del' + (st.armed ? ' is-armed' : ''),
      onclick: () => {
        clearTimeout(armTimer);
        if (!st.armed) {
          st.armed = true;
          armTimer = setTimeout(() => { st.armed = false; rerender(); }, 4000);
          rerender();
          return;
        }
        closeForm();
        deleteLink(x.id).catch(fail('消せませんでした'));
        rerender();
      },
    }, st.armed ? 'もう一度押すと消す' : '消す');
    return h('li', { class: 'tb-link-item is-editing' },
      form({ onSave: (v) => updateLink(x.id, { ...v, area: x.area }), saveLabel: '保存', extra: del, rerender }));
  }
  return h('li', { class: 'tb-link-item' },
    h('a', { class: 'tb-link', href: x.url, target: '_blank', rel: 'noopener noreferrer' },
      h('span', { class: 'tb-link-name' }, label(x)),
      x.name ? h('span', { class: 'tb-link-host' }, host(x.url)) : null,
      h('span', { class: 'tb-link-out', 'aria-hidden': 'true' }, '↗')),
    h('button', {
      type: 'button',
      class: 'tb-btn tb-link-edit',
      'aria-label': `${label(x)}を編集`,
      onclick: () => {
        closeForm();
        Object.assign(st, { editing: x.id, name: x.name || '', url: x.url, focus: true });
        rerender();
      },
    }, '編集'));
}

export function renderLinks(container, _tasks, opts) {
  opts.setContext({});
  const rerender = opts.rerender;
  const all = getLinks();
  if (st.editing && !all.some((x) => x.id === st.editing)) closeForm();

  // 用途の順（areaNames）→ 一覧に無い用途（消した用途のリンク）
  const names = areaNames();
  const unknown = [...new Set(all.map((x) => x.area).filter((a) => a && !names.includes(a)))];
  const sections = [...names, ...unknown].map((area) => {
    const items = all.filter((x) => x.area === area);
    const adder = st.adding === area
      ? form({ onSave: (v) => addLink({ ...v, area }), saveLabel: '追加', rerender })
      : h('button', {
        type: 'button',
        class: 'tb-adder-btn',
        onclick: () => { closeForm(); Object.assign(st, { adding: area, focus: true }); rerender(); },
      }, '＋ リンクを追加');
    return h('section', { class: 'tb-sec tb-link-sec' },
      h('h2', { class: 'tb-link-head' }, areaDot(area), h('span', {}, area),
        h('span', { class: 'tb-link-count', 'aria-label': `${items.length}件` }, String(items.length))),
      items.length ? h('ul', { class: 'tb-link-list' }, items.map((x) => linkRow(x, rerender))) : null,
      adder);
  });

  container.replaceChildren(h('div', { class: 'tb-links' },
    h('p', { class: 'tb-empty' }, '押すと新しいタブで開きます'),
    h('div', { class: 'tb-groups' }, sections)));
}
