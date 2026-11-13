// 画面「リンク集」。担当：画面役。
// renderLinks(container, tasks, opts)：よく使うサイトを用途ごとに並べる。押すと新しいタブで開く。
//   リンクがある用途だけ出す。用途なしは一番下。用途の中は「グループ」でさらに分ける（グループなし → 各グループの小見出し）。
//   「編集」で名前・URL・用途を直す・消す（消すは2回押し。ゴミ箱には入れない）。
// mountLinkAdd(container)：リンク集の時だけ、タスクの入力欄の代わりに出す「リンクを追加」の入力欄。
//   見た目と開き方はタスクの入力欄（add.js）と同じ（1行目＝名前＋追加。押すと URL・用途の行が開く）。
import { getLinks, addLink, updateLink, deleteLink, areaNames, subscribe, reorderLinks, getLinkAreaOrder, reorderLinkAreas, lastHistory, undo } from '../store.js';
import { enableDrag } from './dnd.js';
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

// その用途にあるグループの名前。並びは名前の順（リンクの並びから決めると、引きずるたびにグループの順まで入れ替わるため）
function groupsOf(area) {
  return [...new Set(getLinks().filter((x) => (x.area || null) === (area || null) && x.group).map((x) => x.group))]
    .sort((a, b) => a.localeCompare(b, 'ja'));
}
// グループのチップ（もう一度押すと外す）＋「＋ 新しいグループ」（押すと名前の欄）。st は { area, group, newGroup }
function groupRow(st, rerender) {
  const list = groupsOf(st.area);
  if (st.group && !list.includes(st.group) && !st.newGroup) list.push(st.group);
  const chips = list.map((g) => h('button', {
    type: 'button', class: 'chip' + (st.group === g && !st.newGroup ? ' is-on' : ''), 'aria-pressed': String(st.group === g && !st.newGroup),
    onclick: () => { st.newGroup = false; st.group = st.group === g ? null : g; rerender(); },
  }, g));
  chips.push(h('button', {
    type: 'button', class: 'chip' + (st.newGroup ? ' is-on' : ''), 'aria-pressed': String(!!st.newGroup),
    onclick: () => {
      st.newGroup = !st.newGroup;
      st.group = null;
      rerender();
      if (st.newGroup) requestAnimationFrame(() => document.querySelector('input[data-newgroup]')?.focus());
    },
  }, '＋ 新しいグループ'));
  if (st.newGroup) {
    const inp = h('input', { type: 'text', class: 'tag-newproject', placeholder: 'グループの名前', 'aria-label': '新しいグループの名前', maxlength: '20', 'data-newgroup': '1' });
    inp.value = st.group || '';
    inp.addEventListener('input', () => { st.group = inp.value.trim() || null; });
    chips.push(inp);
  }
  return tagRow('グループ', h('div', { class: 'tag-chips' }, chips));
}

// ---- 上（スマホは下）の「リンクを追加」 ----
export function mountLinkAdd(container) {
  const st = { url: '', area: null, group: null, newGroup: false };
  const name = h('input', {
    type: 'text', class: 'add-title', placeholder: 'リンクを追加（名前）', 'aria-label': '名前', maxlength: '40', enterkeyhint: 'next',
  });
  const error = h('p', { class: 'add-error', role: 'alert' });
  const tags = h('div', { class: 'add-tags' });
  // novalidate：ブラウザの URL の確かめは「https:// の無いアドレス」を断ってしまうため。確かめは store の normUrl で行う
  const form = h('form', { class: 'add-form', autocomplete: 'off', novalidate: true },
    h('div', { class: 'add-line' }, name, h('button', { type: 'submit', class: 'primary add-submit' }, '追加')),
    error, tags);
  container.replaceChildren(form);
  const urlInput = () => tags.querySelector('input[aria-label="URL"]');

  function renderTags() {
    const url = h('input', {
      type: 'url', class: 'tag-newproject', placeholder: 'https://…', 'aria-label': 'URL',
      inputmode: 'url', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done',
    });
    url.value = st.url;
    url.addEventListener('input', () => { st.url = url.value; error.textContent = ''; });
    tags.replaceChildren(
      tagRow('URL', h('div', { class: 'tag-chips' }, url)),
      tagRow('用途', areaChips(st.area, (a) => { st.area = a; st.group = null; st.newGroup = false; renderTags(); })),
      groupRow(st, renderTags));
  }
  const setOpen = (v) => container.classList.toggle('is-open', v);
  name.addEventListener('focus', () => setOpen(true));
  name.addEventListener('click', () => setOpen(true));
  name.addEventListener('input', () => { error.textContent = ''; });
  // 名前で Enter を押した時、URL がまだ空なら追加せずに URL の欄へ進む（名前の次に URL を入れる順のため）
  name.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || st.url.trim()) return;
    e.preventDefault();
    setOpen(true);
    urlInput()?.focus();
  });
  document.addEventListener('pointerdown', (e) => { if (!container.contains(e.target)) setOpen(false); });
  container.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); name.focus(); } });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let p;
    try {
      p = addLink({ url: st.url, name: name.value, area: st.area, group: st.group });
    } catch (err) {
      error.textContent = err.message || String(err);
      setOpen(true);
      urlInput()?.focus();
      return;
    }
    const shown = name.value.trim() || st.url.trim();
    p.catch((err) => { error.textContent = `「${shown}」を追加できませんでした（${err.message || err}）`; });
    name.value = '';
    st.url = '';
    st.area = null;
    st.group = null;
    st.newGroup = false;
    error.textContent = '';
    renderTags();
    setOpen(false);
  });

  renderTags();
  // 用途が足されたら選べるものを描き直す（URL を打っている最中は描き直さない＝打った文字が消えないように）
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
const ed = { id: null, name: '', url: '', area: null, group: null, newGroup: false, err: '', armed: false, focus: false };
let armTimer = 0;
const closeEdit = () => Object.assign(ed, { id: null, name: '', url: '', area: null, group: null, newGroup: false, err: '', armed: false });

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
      updateLink(x.id, { name: ed.name, url: ed.url, area: ed.area, group: ed.group }).catch(fail('保存できませんでした'));
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
    tagRow('用途', areaChips(ed.area, (a) => { ed.area = a; ed.group = null; ed.newGroup = false; rerender(); })),
    groupRow(ed, rerender),
    h('div', { class: 'tb-adder-line' },
      h('button', { type: 'submit', class: 'tb-adder-ok' }, '保存'),
      h('button', { type: 'button', class: 'tb-btn', onclick: cancel }, 'やめる'),
      del),
    ed.err ? h('p', { class: 'tb-adder-err', role: 'alert' }, ed.err) : null);
  if (had) requestAnimationFrame(() => { if (name.isConnected) (ed.err ? url : name).focus(); });
  return f;
}

// 用途の塊（見出し）を引きずって並べ替える。見出しはPCのマウス向けに標準の draggable を使う
// （行の中のリンクの引きずりは dnd.js。塊ごと動かすのは見出しをつかんだ時だけ）
function sortGroups(root) {
  const box = root.querySelector('.tb-groups');
  if (!box) return;
  const secs = () => [...box.querySelectorAll(':scope > .tb-link-sec')];
  let cur = null;
  const before = secs().map((s) => s.dataset.area).join('|');
  for (const sec of secs()) {
    const head = sec.querySelector('.tb-link-head');
    head.addEventListener('dragstart', (e) => { cur = sec; sec.classList.add('is-dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', sec.dataset.area); });
    head.addEventListener('dragend', () => {
      sec.classList.remove('is-dragging');
      cur = null;
      const keys = secs().map((s) => s.dataset.area);
      if (keys.join('|') !== before) {
        reorderLinkAreas(keys).catch(fail('並べ替えを保存できませんでした'));
        const entry = lastHistory();
        showToast('並べ替えました', { action: '元に戻す', onAction: () => undo(entry) });
      }
    });
  }
  box.addEventListener('dragover', (e) => {
    if (!cur) return;
    e.preventDefault();
    const after = secs().find((s) => s !== cur && e.clientY < s.getBoundingClientRect().top + s.offsetHeight / 2);
    if (after) after.before(cur); else box.append(cur);
  });
  box.addEventListener('drop', (e) => { if (cur) e.preventDefault(); });
}

// 編集ボタンのペンのアイコン
function PEN_SVG() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
  return s;
}

function linkRow(x, rerender) {
  if (ed.id === x.id) return h('li', { class: 'tb-link-item is-editing' }, editForm(x, rerender));
  // tb-card・tb-body は引きずり（dnd.js）が「動かせる行」「つかむ所」を見分ける印。つかむのは左の ⠿ だけ（リンクを押すと開くため）
  return h('li', { class: 'tb-link-item tb-card', 'data-id': x.id },
    h('button', { type: 'button', class: 'tb-body tb-link-grip', 'aria-label': `${label(x)}を並べ替え（引きずる）`, title: '引きずって並べ替え' }, '⠿'),
    h('a', { class: 'tb-link', href: x.url, target: '_blank', rel: 'noopener noreferrer' },
      x.area ? areaDot(x.area) : null,
      h('span', { class: 'tb-link-name' }, label(x)),
      x.name ? h('span', { class: 'tb-link-host' }, host(x.url)) : null,
),
    h('button', {
      type: 'button',
      class: 'tb-btn tb-link-edit',
      'aria-label': `${label(x)}を編集`,
      onclick: () => {
        closeEdit();
        Object.assign(ed, { id: x.id, name: x.name || '', url: x.url, area: x.area || null, group: x.group || null, newGroup: false, focus: true });
        rerender();
      },
    }, PEN_SVG()));
}

const dropKey = (area, group) => `link:${JSON.stringify([area || null, group || null])}`;

export function renderLinks(container, _tasks, opts) {
  opts.setContext({});
  const rerender = opts.rerender;
  const all = getLinks();
  if (ed.id && !all.some((x) => x.id === ed.id)) closeEdit();

  // 用途の順（areaNames）→ 一覧に無い用途（消した用途のリンク）→ 用途なし。リンクの無い用途は出さない
  const names = areaNames();
  const unknown = [...new Set(all.map((x) => x.area).filter((a) => a && !names.includes(a)))];
  // 塊の順：リンク集で引きずって決めた順 → 残りは用途の順（左の一覧とは別に持つ）
  const base = [...names, ...unknown, null];
  const saved = getLinkAreaOrder().map((k) => k || null).filter((a) => base.includes(a));
  const sections = [...saved, ...base.filter((a) => !saved.includes(a))]
    .map((area) => [area, all.filter((x) => (x.area || null) === area)])
    .filter(([, items]) => items.length)
    .map(([area, items]) => h('section', { class: 'tb-sec tb-link-sec', 'data-area': area || '' },
      h('h2', { class: 'tb-link-head', draggable: 'true', title: '引きずって塊の順を変える' },
        area ? areaDot(area) : null, h('span', {}, area || NONE_LABEL),
        h('span', { class: 'tb-link-count', 'aria-label': `${items.length}件` }, String(items.length))),
      // 引きずって並べ替える（別の塊へ落とすと用途・グループも変わる）。落とす先の名前＝'link:' ＋ [用途, グループ] の JSON
      // （用途やグループの名前にどんな記号が入っても区切りを取り違えないため）
      h('ul', { class: 'tb-link-list', 'data-drop': dropKey(area, null), 'data-drop-ok': true }, items.filter((x) => !x.group).map((x) => linkRow(x, rerender))),
      groupsOf(area).map((g) => h('div', { class: 'tb-link-group' },
        h('h3', { class: 'tb-link-ghead' }, h('span', {}, g), h('span', { class: 'tb-link-count' }, String(items.filter((x) => x.group === g).length))),
        h('ul', { class: 'tb-link-list', 'data-drop': dropKey(area, g), 'data-drop-ok': true }, items.filter((x) => x.group === g).map((x) => linkRow(x, rerender)))))));

  const root = h('div', { class: 'tb-links' },
    sections.length
      ? [h('p', { class: 'tb-empty' }, '押すと新しいタブで開きます。左の ⠿ を引きずると並べ替えられます'), h('div', { class: 'tb-groups' }, sections)]
      : h('p', { class: 'tb-empty tb-guide' }, 'リンクはまだありません。「リンクを追加」から足せます'));
  sortGroups(root);
  enableDrag(root, {
    rootSel: '.tb-links',
    onDrop: ({ toKey, finalIds }) => {
      const [area, group] = JSON.parse(toKey.slice('link:'.length));
      reorderLinks(area, finalIds, group).catch(fail('並べ替えを保存できませんでした'));
      const entry = lastHistory();
      if (entry) showToast('並べ替えました', { action: '元に戻す', onAction: () => undo(entry) });
    },
  });
  container.replaceChildren(root);
}
