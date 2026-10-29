// 入力欄（タスク名＋タグのボタン）。担当：入力役。
// mountAdd(container, getContext)：getContext() は今開いている分類（例 { area: '就活' }）を返す。初期値に使う。
//
// タグは行ごとに1つだけ選べる（もう一度押すと解除）。何も選ばなければ受信箱に入る（store側）。
// 初期値は getContext() から作る。手で触っていない行は、フォーカスした時・追加する瞬間に読み直す
// （画面の見出しを押してから追加しても、その見出しの分類で入るように）。手で触った行はその選択を優先する。
// フェーズの行は、プロジェクトの中にいる時（getContext() に project がある時）だけ出す。初期値は getContext().phase。
// 追加は待たない（Firestore はオフラインだと Promise が終わらないが、端末内には即座に入る）。失敗だけ画面に出す。
import { addTask, projectNames, getPhases, areaNames, subscribe } from './store.js';
import { PRIORITIES, STATUSES } from './constants.js';
import { todayKey, addDays, relLabel } from './dates.js';
import { repeatEditor } from './repeat.js';

const KEYS = ['doDate', 'dueDate', 'area', 'project', 'phase', 'priority'];
const MAX_PROJECTS = 6;

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

export function mountAdd(container, getContext) {
  // 選択中のタグ。null＝未選択
  let sel = {};
  let memo = '';
  let repeat = null; // 繰り返し（js/repeat.js の形）
  let touched = new Set(); // 前回の初期化の後に、手で触った行（KEYS のどれか）
  let lastAdd = 0; // 連打で空の追加になった時、エラーを出さないため
  let open = false; // 「もっと」を開いているか
  let newProject = false; // プロジェクト「＋新規」の入力欄を出しているか
  const customDate = { doDate: false, dueDate: false }; // 「日付…」の入力欄を出しているか

  container.innerHTML = '';
  const form = el('form', { class: 'add-form', autocomplete: 'off' });
  const title = el('input', {
    name: 'title', class: 'add-title', placeholder: 'タスクを追加', 'aria-label': 'タスク名', enterkeyhint: 'done',
  });
  const submit = el('button', { type: 'submit', class: 'primary add-submit', text: '追加' });
  form.append(el('div', { class: 'add-line' }, [title, submit]));

  const error = el('p', { class: 'add-error', role: 'alert' });
  const tags = el('div', { class: 'add-tags' });
  const more = el('div', { class: 'add-more' });
  const moreBtn = el('button', {
    type: 'button', class: 'add-more-btn', 'aria-expanded': 'false',
    onclick: () => { open = !open; syncContext(); renderTags(); },
  });
  form.append(error, tags, moreBtn, more);
  container.appendChild(form);

  function readContext() {
    return (typeof getContext === 'function' && getContext()) || {};
  }

  // 手で触っていない行だけ、今の getContext() で上書きする
  function syncContext() {
    const ctx = readContext();
    for (const k of KEYS) {
      if (touched.has(k)) continue;
      sel[k] = ctx[k] || null;
      // 手で追加する時、やる日は選ばなければ今日（締切は別に付けられるため。2026-10-29 オーナー）。
      // 日付なしタブなど、画面が noDate を渡した時だけ空のまま
      if (k === 'doDate' && !sel.doDate && !ctx.noDate) sel.doDate = todayKey();
      if (k === 'project') newProject = false;
      if (k in customDate) customDate[k] = false;
    }
    return ctx;
  }

  // 追加の後：全行を「触っていない」に戻して初期値に
  function resetFromContext() {
    touched = new Set();
    memo = '';
    repeat = null;
    syncContext();
    renderTags();
  }

  function pick(key, value) {
    sel[key] = sel[key] === value ? null : value;
    touched.add(key);
    renderTags();
  }

  function row(label, chips, extra) {
    return el('div', { class: 'tag-row' }, [
      el('span', { class: 'tag-label', text: label }),
      el('div', { class: 'tag-chips' }, [...chips, ...(extra ? [extra] : [])]),
    ]);
  }

  // やる日・締切の行。presets は [ [ラベル, 日付], … ]
  // withNone：先頭に「なし」（選ぶと空。もう一度押しても空のまま）
  function dateRow(key, label, presets, withNone = false) {
    const presetValues = presets.map((p) => p[1]);
    const isCustom = customDate[key] || (sel[key] && !presetValues.includes(sel[key]));
    const chips = presets.map(([l, v]) => chip(l, sel[key] === v && !customDate[key], () => {
      customDate[key] = false;
      pick(key, v);
    }));
    if (withNone) {
      chips.unshift(chip('なし', !sel[key] && !customDate[key], () => {
        customDate[key] = false;
        sel[key] = null;
        touched.add(key);
        renderTags();
      }));
    }
    const customLabel = isCustom && sel[key] ? relLabel(sel[key]) : '日付…';
    chips.push(chip(customLabel, isCustom, () => {
      if (isCustom) {
        customDate[key] = false;
        sel[key] = null;
      } else {
        customDate[key] = true;
      }
      touched.add(key);
      renderTags();
      if (customDate[key]) {
        const input = tags.querySelector(`input[data-date="${key}"]`) || more.querySelector(`input[data-date="${key}"]`);
        if (input) {
          input.focus();
          try { input.showPicker(); } catch { /* 開けない端末では入力欄だけ */ }
        }
      }
    }));
    let extra = null;
    if (isCustom) {
      extra = el('input', {
        type: 'date', class: 'tag-date', 'data-date': key, 'aria-label': `${label}の日付`,
        value: sel[key] || '',
        onchange: (e) => { sel[key] = e.target.value || null; customDate[key] = true; touched.add(key); renderTags(); },
      });
    }
    return row(label, chips, extra);
  }

  function simpleRow(key, label, options) {
    const opts = [...options];
    if (sel[key] && !opts.includes(sel[key])) opts.push(sel[key]);
    return row(label, opts.map((v) => chip(v, sel[key] === v, () => pick(key, v))));
  }

  // フェーズ（1…N）。N はそのプロジェクトのフェーズの数
  function phaseRow(project) {
    const n = Math.max(getPhases(project), sel.phase || 0);
    const opts = Array.from({ length: n }, (_, i) => i + 1);
    return row('フェーズ', opts.map((v) => chip(String(v), sel.phase === v, () => pick('phase', v))));
  }

  function projectRow() {
    const names = projectNames().slice(0, MAX_PROJECTS);
    if (sel.project && !names.includes(sel.project)) names.unshift(sel.project);
    const chips = names.map((v) => chip(v, sel.project === v && !newProject, () => { newProject = false; pick('project', v); }));
    chips.push(chip('＋新規', newProject, () => {
      newProject = !newProject;
      if (!newProject) sel.project = null;
      touched.add('project');
      renderTags();
      if (newProject) more.querySelector('.tag-newproject')?.focus();
    }));
    let extra = null;
    if (newProject) {
      extra = el('input', {
        type: 'text', class: 'tag-newproject', placeholder: 'プロジェクト名', 'aria-label': '新しいプロジェクト名',
        value: names.includes(sel.project) ? '' : (sel.project || ''),
        oninput: (e) => { sel.project = e.target.value.trim() || null; touched.add('project'); },
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); } },
      });
    }
    return row('プロジェクト', chips, extra);
  }

  function renderTags() {
    const t = todayKey();
    tags.replaceChildren(
      dateRow('doDate', 'やる日', [['今日', t], ['明日', addDays(t, 1)], ['明後日', addDays(t, 2)]], true),
      simpleRow('area', '用途', areaNames()),
    );
    const ctxProject = readContext().project;
    if (ctxProject) tags.append(phaseRow(ctxProject));

    // 閉じていても、選択中のものがあれば分かるように件数を出す
    const hidden = ['dueDate', 'project', 'priority'].filter((k) => sel[k]).length + (memo ? 1 : 0) + (repeat ? 1 : 0);
    moreBtn.textContent = open ? 'たたむ ▴' : `もっと ▾${hidden ? `（${hidden}）` : ''}`;
    moreBtn.setAttribute('aria-expanded', String(open));
    more.hidden = !open;
    if (!open) { more.replaceChildren(); return; }

    const memoBox = el('textarea', {
      class: 'tag-memo', rows: '2', placeholder: '内容', 'aria-label': '内容',
      oninput: (e) => { memo = e.target.value; },
    });
    memoBox.value = memo;
    more.replaceChildren(
      dateRow('dueDate', '締切', [['今日', t], ['明日', addDays(t, 1)]], true),
      projectRow(),
      simpleRow('priority', '優先度', PRIORITIES),
      el('div', { class: 'tag-row' }, [
        el('span', { class: 'tag-label', text: '繰り返し' }),
        repeatEditor({ value: repeat, base: () => sel.doDate, onChange: (r) => { repeat = r; } }),
      ]),
      row('内容', [memoBox]),
    );
  }

  // 開閉（スマホ・PC共通。PCは上のまま下に開く）：
  // 入力欄にフォーカス・タップで開き、入力欄の外を押す／追加した後／Esc で畳む（1行目だけ残る）
  let quiet = false; // true の間はフォーカスしても開かない（Esc で戻した時）
  function setOpen(v) { container.classList.toggle('is-open', v); }
  title.addEventListener('click', () => setOpen(true));
  // タグを押すと描き直されてフォーカスが body に落ちることがあるので、document で拾う
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !container.classList.contains('is-open')) return;
    const ae = document.activeElement;
    if (ae && ae !== document.body && !container.contains(ae)) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    // タグから Esc した時は入力欄へ戻す（戻した時のフォーカスでは開かない）
    if (document.activeElement !== title) { quiet = true; title.focus(); quiet = false; }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!container.contains(e.target)) setOpen(false);
  });

  title.addEventListener('focus', () => {
    // 画面が変わると初期値も変わる。手で選んだ行は消さない
    syncContext();
    renderTags();
    if (!quiet) setOpen(true);
  });
  title.addEventListener('input', () => { error.textContent = ''; });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = title.value.trim();
    if (!name) {
      if (Date.now() - lastAdd > 800) error.textContent = 'タスク名を入れてください';
      title.focus();
      return;
    }
    // 追加する瞬間の分類を使う（手で触っていない行だけ）
    const ctx = syncContext();
    const data = { title: name };
    for (const k of KEYS) if (sel[k]) data[k] = sel[k];
    // フェーズはプロジェクトの中で、プロジェクトが付いている時だけ
    if (!ctx.project || !data.project) delete data.phase;
    if (memo.trim()) data.memo = memo.trim();
    if (repeat) data.repeat = repeat;
    if (STATUSES.some((st) => st.value === ctx.status)) data.status = ctx.status;

    // 待たずに空にする（連打しても同じ名前が2回入らない・オフラインでも続けて入れられる）
    title.value = '';
    error.textContent = '';
    lastAdd = Date.now();
    resetFromContext();
    title.focus();
    setOpen(false); // 続けて入れられるようにフォーカスは残し、タグだけ畳む（もう一度押すと開く）
    addTask(data).catch((err) => {
      error.textContent = `「${name}」を追加できませんでした（${err.message || err}）`;
    });
  });

  resetFromContext();
  followKeyboard();

  // 用途・プロジェクトが足されたら描き直す（入力欄の中で打っている時は描き直さない＝打った文字が消えないように）
  let listSig = '';
  subscribe(() => {
    const sig = `${areaNames().join('')}${projectNames().slice(0, MAX_PROJECTS).join('')}`;
    if (sig === listSig) return;
    const first = !listSig;
    listSig = sig;
    const ae = document.activeElement;
    if (first || (ae && container.contains(ae) && ae !== title && ae.tagName !== 'BUTTON')) return;
    renderTags();
  });

  // app.js から呼ぶ：画面を移って文脈（getContext()）が変わった。
  // 手で触っていない行だけ今の文脈に合わせて、タグの表示を描き直す（触った行はそのまま）
  return {
    contextChanged() {
      syncContext();
      renderTags();
    },
  };
}

// スマホ：キーボードが出た時、下に固定した入力欄をキーボードのすぐ上に合わせる。
// 見えている範囲（visualViewport）と画面全体の差を --kb に入れ、CSS が使う
function followKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const sync = () => {
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    root.style.setProperty('--kb', `${kb}px`);
    root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    root.classList.toggle('kb-open', kb > 80);
  };
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  sync();
}
