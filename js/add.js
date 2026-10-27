// 入力欄（タスク名＋タグのボタン）。担当：入力役。
// mountAdd(container, getContext)：getContext() は今開いている分類（例 { area: '就活' }）を返す。初期値に使う。
//
// タグは行ごとに1つだけ選べる（もう一度押すと解除）。何も選ばなければ受信箱に入る（store側）。
// 初期値は getContext() から作り、入力欄にフォーカスした時（まだタグを触っていなければ）と追加した後に読み直す。
import { addTask, projectNames } from './store.js';
import { AREAS, SIZES, PRIORITIES } from './constants.js';
import { todayKey, addDays, relLabel } from './dates.js';

const KEYS = ['doDate', 'dueDate', 'area', 'project', 'size', 'priority'];
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
  let touched = false; // 前回の初期化の後に、タグを手で触ったか
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
    onclick: () => { open = !open; renderTags(); },
  });
  form.append(error, tags, moreBtn, more);
  container.appendChild(form);

  function resetFromContext() {
    const ctx = (typeof getContext === 'function' && getContext()) || {};
    sel = {};
    for (const k of KEYS) sel[k] = ctx[k] || null;
    memo = '';
    touched = false;
    newProject = false;
    customDate.doDate = false;
    customDate.dueDate = false;
    renderTags();
  }

  function pick(key, value) {
    sel[key] = sel[key] === value ? null : value;
    touched = true;
    renderTags();
  }

  function row(label, chips, extra) {
    return el('div', { class: 'tag-row' }, [
      el('span', { class: 'tag-label', text: label }),
      el('div', { class: 'tag-chips' }, [...chips, ...(extra ? [extra] : [])]),
    ]);
  }

  // やる日・締切の行。presets は [ [ラベル, 日付], … ]
  function dateRow(key, label, presets) {
    const presetValues = presets.map((p) => p[1]);
    const isCustom = customDate[key] || (sel[key] && !presetValues.includes(sel[key]));
    const chips = presets.map(([l, v]) => chip(l, sel[key] === v && !customDate[key], () => {
      customDate[key] = false;
      pick(key, v);
    }));
    const customLabel = isCustom && sel[key] ? relLabel(sel[key]) : '日付…';
    chips.push(chip(customLabel, isCustom, () => {
      if (isCustom) {
        customDate[key] = false;
        sel[key] = null;
      } else {
        customDate[key] = true;
      }
      touched = true;
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
        onchange: (e) => { sel[key] = e.target.value || null; customDate[key] = true; touched = true; renderTags(); },
      });
    }
    return row(label, chips, extra);
  }

  function simpleRow(key, label, options) {
    const opts = [...options];
    if (sel[key] && !opts.includes(sel[key])) opts.push(sel[key]);
    return row(label, opts.map((v) => chip(v, sel[key] === v, () => pick(key, v))));
  }

  function projectRow() {
    const names = projectNames().slice(0, MAX_PROJECTS);
    if (sel.project && !names.includes(sel.project)) names.unshift(sel.project);
    const chips = names.map((v) => chip(v, sel.project === v && !newProject, () => { newProject = false; pick('project', v); }));
    chips.push(chip('＋新規', newProject, () => {
      newProject = !newProject;
      if (!newProject) sel.project = null;
      touched = true;
      renderTags();
      if (newProject) more.querySelector('.tag-newproject')?.focus();
    }));
    let extra = null;
    if (newProject) {
      extra = el('input', {
        type: 'text', class: 'tag-newproject', placeholder: 'プロジェクト名', 'aria-label': '新しいプロジェクト名',
        value: names.includes(sel.project) ? '' : (sel.project || ''),
        oninput: (e) => { sel.project = e.target.value.trim() || null; touched = true; },
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); } },
      });
    }
    return row('プロジェクト', chips, extra);
  }

  function renderTags() {
    const t = todayKey();
    tags.replaceChildren(
      dateRow('doDate', 'やる日', [['今日', t], ['明日', addDays(t, 1)], ['明後日', addDays(t, 2)]]),
      simpleRow('area', '用途', AREAS),
    );

    // 閉じていても、選択中のものがあれば分かるように件数を出す
    const hidden = ['dueDate', 'project', 'size', 'priority'].filter((k) => sel[k]).length + (memo ? 1 : 0);
    moreBtn.textContent = open ? 'たたむ ▴' : `もっと ▾${hidden ? `（${hidden}）` : ''}`;
    moreBtn.setAttribute('aria-expanded', String(open));
    more.hidden = !open;
    if (!open) { more.replaceChildren(); return; }

    const memoBox = el('textarea', {
      class: 'tag-memo', rows: '2', placeholder: 'メモ', 'aria-label': 'メモ',
      oninput: (e) => { memo = e.target.value; },
    });
    memoBox.value = memo;
    more.replaceChildren(
      dateRow('dueDate', '締切', [['今日', t], ['明日', addDays(t, 1)]]),
      projectRow(),
      simpleRow('size', '大中小', SIZES),
      simpleRow('priority', '優先度', PRIORITIES),
      row('メモ', [memoBox]),
    );
  }

  title.addEventListener('focus', () => {
    // 画面が変わると初期値も変わる。手で選んだタグは消さない
    if (!touched) resetFromContext();
  });
  title.addEventListener('input', () => { error.textContent = ''; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = title.value.trim();
    if (!name) {
      error.textContent = 'タスク名を入れてください';
      title.focus();
      return;
    }
    const data = { title: name };
    for (const k of KEYS) if (sel[k]) data[k] = sel[k];
    if (memo.trim()) data.memo = memo.trim();
    submit.disabled = true;
    error.textContent = '';
    try {
      await addTask(data);
      title.value = '';
      resetFromContext();
    } catch (err) {
      error.textContent = `追加できませんでした（${err.message || err}）`;
    } finally {
      submit.disabled = false;
      title.focus();
    }
  });

  resetFromContext();
}
