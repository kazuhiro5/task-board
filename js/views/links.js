// 画面「リンク集」。担当：画面役。
// renderLinks(container, tasks, opts)：よく使うサイトを用途ごとに並べる。押すと新しいタブで開く。
//   リンクがある用途だけ出す。用途なしは一番下。
//   「編集」で名前・URL・用途を直す・消す（消すは2回押し。ゴミ箱には入れない）。
// mountLinkAdd(container)：リンク集の時だけ、タスクの入力欄の代わりに出す「リンクを追加」の入力欄。
//   見た目と開き方はタスクの入力欄（add.js）と同じ（1行目＝URL＋追加。押すと名前・用途の行が開く）。
import { getLinks, addLink, updateLink, deleteLink, areaNames, subscribe } from '../store.js';
import { h, areaDot } from './card.js';
import { showToast } from '../toast.js';

const NONE_LABEL = '用途なし';

function fail(msg) {
  return (e) => {
    console.warn('[task-board]', msg, e);
    showToast(`${msg}（${e.message || e}）`);
  };
}

// 表示名：名前が無ければアドレスの「www.」を外した部分
function host(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}
const label = (x) => x.name || host(x.url);

// 用途のチップ（もう一度押すと外す＝用途なし）
function areaChips(cur, onPick) {
  return h('div', { class: 'tag-chips' }, areaNames().map((a) => h('button', {
    type: 'button',
    class: 'chip' + (cur === a ? ' is-on' : ''),
    'aria-pressed': String(cur === a),
    onclick: () => onPick(cur === a ? null : a),
  }, a)));
}
const tagRow = (name, ...kids) => h('div', { class: 'tag-row' }, h('span', { class: 'tag-label' }, name), ...kids);

// ---- 上（スマホは下）の「リンクを追加」 ----
export function mountLinkAdd(container) {
  const st = { name: '', area: null };
  const url = h('input', {
    type: 'url', class: 'add-title', placeholder: 'リンクを追加（URL）', 'aria-label': 'URL',
    inputmode: 'url', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done',
  });
  const error = h('p', { class: 'add-error', role: 'alert' });
  const tags = h('div', { class: 'add-tags' });
  // novalidate：ブラウザの URL の確かめは「https:// の無いアドレス」を断ってしまうため。確かめは store の normUrl で行う
  const form = h('form', { class: 'add-form', autocomplete: 'off', novalidate: true },
    h('div', { class: 'add-line' }, url, h('button', { type: 'submit', class: 'primary add-submit' }, '追加')),
    error, tags);
  container.replaceChildren(form);

  function renderTags() {
    const name = h('input', {
      type: 'text', class: 'tag-newproject', placeholder: '空ならアドレスを出す', 'aria-label': '名前', maxlength: '40',
    });
    name.value = st.name;
    name.addEventListener('input', () => { st.name = name.value; });
    tags.replaceChildren(
      tagRow('名前', h('div', { class: 'tag-chips' }, name)),
      tagRow('用途', areaChips(st.area, (a) => { st.area = a; renderTags(); })));
  }
  const setOpen = (v) => container.classList.toggle('is-open', v);
  url.addEventListener('focus', () => setOpen(true));
  url.addEventListener('click', () => setOpen(true));
  url.addEventListener('input', () => { error.textContent = ''; });
  document.addEventListener('pointerdown', (e) => { if (!container.contains(e.target)) setOpen(false); });
  container.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); url.focus(); } });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let p;
    try {
      p = addLink({ url: url.value, name: st.name, area: st.area });
    } catch (err) {
      error.textContent = err.message || String(err);
      url.focus();
      return;
    }
    const shown = st.name.trim() || url.value.trim();
    p.catch((err) => { error.textContent = `「${shown}」を追加できませんでした（${err.message || err}）`; });
    url.value = '';
    st.name = '';
    st.area = null;
    error.textContent = '';
    renderTags();
    setOpen(false);
  });

  renderTags();
  // 用途が足されたら選べるものを描き直す（名前を打っている最中は描き直さない＝打った文字が消えないように）
  let sig = '';
  subscribe(() => {
    const s = areaNames().join('\u0000');
    if (s === sig) return;
    sig = s;
    if (!tags.contains(document.activeElement)) renderTags();
  });
}

// ---- 一覧 ----
// 直しているリンク。入力中の文字は描き直しても消えないように覚えておく（Firestore の更新で描き直されるため）
const ed = { id: null, name: '', url: '', area: null, err: '', armed: false, focus: false };
let armTimer = 0;
const closeEdit = () => Object.assign(ed, { id: null, name: '', url: '', area: null, err: '', armed: false });

function editForm(x, rerender) {
  const had = ed.focus;
  ed.focus = false;
  const name = h('input', { type: 'text', class: 'tb-adder-input', placeholder: '名前（空ならアドレス）', 'aria-label': '名前', maxlength: '40' });
  const url = h('input', {
    type: 'url', class: 'tb-adder-input', placeholder: 'https://…', 'aria-label': 'URL', inputmode: 'url', autocapitalize: 'off', spellcheck: 'false',
  });
  name.value = ed.name;
  url.value = ed.url;
  name.addEventListener('input', () => { ed.name = name.value; });
  url.addEventListener('input', () => { ed.url = url.value; });
  const cancel = () => { closeEdit(); rerender(); };
  for (const i of [name, url]) i.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } });
  const submit = (e) => {
    e.preventDefault();
    try {
      updateLink(x.id, { name: ed.name, url: ed.url, area: ed.area }).catch(fail('保存できませんでした'));
      closeEdit();
    } catch (err) {
      ed.err = err.message || String(err);
      ed.focus = true;
    }
    rerender();
  };
  const del = h('button', {
    type: 'button',
    class: 'tb-btn tb-danger tb-link-del' + (ed.armed ? ' is-armed' : ''),
    onclick: () => {
      clearTimeout(armTimer);
      if (!ed.armed) {
        ed.armed = true;
        armTimer = setTimeout(() => { ed.armed = false; rerender(); }, 4000);
        rerender();
        return;
      }
      closeEdit();
      deleteLink(x.id).catch(fail('消せませんでした'));
      rerender();
    },
  }, ed.armed ? 'もう一度押すと消す' : '消す');
  // novalidate：上の入力欄と同じ理由
  const f = h('form', { class: 'tb-adder tb-link-form', autocomplete: 'off', novalidate: true, onsubmit: submit },
    name,
    url,
    tagRow('用途', areaChips(ed.area, (a) => { ed.area = a; rerender(); })),
    h('div', { class: 'tb-adder-line' },
      h('button', { type: 'submit', class: 'tb-adder-ok' }, '保存'),
      h('button', { type: 'button', class: 'tb-btn', onclick: cancel }, 'やめる'),
      del),
    ed.err ? h('p', { class: 'tb-adder-err', role: 'alert' }, ed.err) : null);
  if (had) requestAnimationFrame(() => { if (name.isConnected) (ed.err ? url : name).focus(); });
  return f;
}

function linkRow(x, rerender) {
  if (ed.id === x.id) return h('li', { class: 'tb-link-item is-editing' }, editForm(x, rerender));
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
        closeEdit();
        Object.assign(ed, { id: x.id, name: x.name || '', url: x.url, area: x.area || null, focus: true });
        rerender();
      },
    }, '編集'));
}

export function renderLinks(container, _tasks, opts) {
  opts.setContext({});
  const rerender = opts.rerender;
  const all = getLinks();
  if (ed.id && !all.some((x) => x.id === ed.id)) closeEdit();

  // 用途の順（areaNames）→ 一覧に無い用途（消した用途のリンク）→ 用途なし。リンクの無い用途は出さない
  const names = areaNames();
  const unknown = [...new Set(all.map((x) => x.area).filter((a) => a && !names.includes(a)))];
  const sections = [...names, ...unknown, null]
    .map((area) => [area, all.filter((x) => (x.area || null) === area)])
    .filter(([, items]) => items.length)
    .map(([area, items]) => h('section', { class: 'tb-sec tb-link-sec' },
      h('h2', { class: 'tb-link-head' },
        area ? areaDot(area) : null, h('span', {}, area || NONE_LABEL),
        h('span', { class: 'tb-link-count', 'aria-label': `${items.length}件` }, String(items.length))),
      h('ul', { class: 'tb-link-list' }, items.map((x) => linkRow(x, rerender)))));

  container.replaceChildren(h('div', { class: 'tb-links' },
    sections.length
      ? [h('p', { class: 'tb-empty' }, '押すと新しいタブで開きます'), h('div', { class: 'tb-groups' }, sections)]
      : h('p', { class: 'tb-empty tb-guide' }, 'リンクはまだありません。「リンクを追加」から足せます')));
}
