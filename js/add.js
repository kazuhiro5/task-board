// 入力欄（タスク名＋タグのボタン）。担当：入力役。
// mountAdd(container, getContext)：getContext() は今開いている分類（例 { area: '就活' }）を返す。初期値に使う。
//
// タグは行ごとに1つだけ選べる（もう一度押すと解除）。何も選ばなければ受信箱に入る（store側）。
// 初期値は getContext() から作る。手で触っていない行は、フォーカスした時・追加する瞬間に読み直す
// （画面の見出しを押してから追加しても、その見出しの分類で入るように）。手で触った行はその選択を優先する。
// スプリントの行は、プロジェクトを選んでいる時だけ出す（終わっていないスプリントとバックログ）。初期値は getContext().sprint。
// 追加は待たない（Firestore はオフラインだと Promise が終わらないが、端末内には即座に入る）。失敗だけ画面に出す。
import { addTask, projectNames, getSprints, sprintState, areaNames, subscribe } from './store.js';
import { PRIORITIES, STATUSES } from './constants.js';
import { todayKey, addDays, relLabel } from './dates.js';
import { repeatEditor } from './repeat.js';

const KEYS = ['doDate', 'dueDate', 'area', 'project', 'sprint', 'priority'];
const NEW = '\u0000new'; // プロジェクトの選択肢の「＋ 新しいプロジェクト」（ふつうの名前とぶつからない値）

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
  let newProject = false; // プロジェクト「＋新規」の入力欄を出しているか
  const customDate = { doDate: false, dueDate: false }; // 「日付…」の入力欄を出しているか

  container.innerHTML = '';
  const form = el('form', { class: 'add-form', autocomplete: 'off' });
  const title = el('input', {
    name: 'title', class: 'add-title', placeholder: 'タスクを追加', 'aria-label': 'タスク名', enterkeyhint: 'done',
  });
  const submit = el('button', { type: 'submit', class: 'primary add-submit', text: '追加' });
  // PCの右のパネルの見出し（スマホでは CSS で隠す）
  const head = el('div', { class: 'add-head' }, [
    el('span', { class: 'add-heading', text: 'タスクを追加' }),
    el('button', { type: 'button', class: 'add-close', text: '閉じる', onclick: () => setOpen(false) }),
  ]);
  // 内容はタスク名のすぐ隣に置く（タグを全部出しても、名前と内容がスクロールなしで一緒に見えるように）。
  // タグの描き直しで消えないよう、タグとは別に持つ
  const memoBox = el('textarea', {
    class: 'tag-memo add-memo', rows: '2', placeholder: '内容', 'aria-label': '内容',
    oninput: (e) => { memo = e.target.value; },
  });
  // 優先度は内容のすぐ下に置く（オーナーが決めた位置。ほかのタグとは別の場所）
  const prioBox = el('div', { class: 'add-prio' });
  form.append(head, el('div', { class: 'add-line' }, [title, submit]), memoBox, prioBox);

  const error = el('p', { class: 'add-error', role: 'alert' });
  const tags = el('div', { class: 'add-tags' });
  form.append(error, tags);
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
    memoBox.value = '';
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
        const input = tags.querySelector(`input[data-date="${key}"]`);
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
  function sprintRow(project) {
    const list = getSprints(project).filter((sp) => sprintState(sp) !== 'past');
    if (sel.sprint && !list.some((sp) => sp.id === sel.sprint)) sel.sprint = null;
    return row('スプリント', [
      chip('バックログ', !sel.sprint, () => { sel.sprint = null; touched.add('sprint'); renderTags(); }),
      ...list.map((sp) => chip(`${sp.name}${sprintState(sp) === 'now' ? '（今）' : ''}`, sel.sprint === sp.id, () => pick('sprint', sp.id))),
    ]);
  }


  // プロジェクトは数が増えるので、ボタンを並べず「選ぶ」欄にする（最後に「＋ 新しいプロジェクト」）
  function projectRow() {
    const names = projectNames();
    const custom = sel.project && !names.includes(sel.project);
    const select = el('select', {
      class: 'tag-select', 'aria-label': 'プロジェクト',
      onchange: (e) => {
        const v = e.target.value;
        newProject = v === NEW;
        sel.project = newProject || !v ? null : v;
        sel.sprint = null; // スプリントはプロジェクトごとに違うので選び直す
        touched.add('project');
        touched.add('sprint');
        renderTags();
        if (newProject) tags.querySelector('.tag-newproject')?.focus();
      },
    }, [
      el('option', { value: '', text: 'プロジェクトを選択' }),
      ...names.map((v) => el('option', { value: v, text: v })),
      el('option', { value: NEW, text: '＋ 新しいプロジェクト' }),
    ]);
    select.value = newProject || custom ? NEW : (sel.project || '');
    let extra = null;
    if (newProject || custom) {
      extra = el('input', {
        type: 'text', class: 'tag-newproject', placeholder: 'プロジェクト名', 'aria-label': '新しいプロジェクト名',
        value: custom ? sel.project : '',
        oninput: (e) => { sel.project = e.target.value.trim() || null; touched.add('project'); },
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); } },
      });
    }
    return row('プロジェクト', [select], extra);
  }

  function renderTags() {
    const t = todayKey();
    // 並びはオーナーが決めた順。1種類を1行にして横に流し、縦の幅を取らない
    tags.replaceChildren(
      simpleRow('area', '用途', areaNames()),
      dateRow('doDate', 'やる日', [['今日', t], ['明日', addDays(t, 1)], ['明後日', addDays(t, 2)]], true),
      dateRow('dueDate', '締切', [['今日', t], ['明日', addDays(t, 1)]], true),
      el('div', { class: 'tag-row' }, [
        el('span', { class: 'tag-label', text: '繰り返し' }),
        repeatEditor({ value: repeat, base: () => sel.doDate, onChange: (r) => { repeat = r; } }),
      ]),
      projectRow(),
    );
    if (sel.project && projectNames().includes(sel.project)) tags.append(sprintRow(sel.project));
    prioBox.replaceChildren(simpleRow('priority', '優先度', PRIORITIES));
    for (const c of form.querySelectorAll('.tag-chips')) if (!c.dataset.wheel) { c.dataset.wheel = '1'; wheelSideways(c); }
  }

  // 開閉：入力欄にフォーカス・タップで開き、入力欄の外を押す／追加した後／Esc／「閉じる」で畳む（1行目だけ残る）。
  // PC（840px以上）は右のパネルとして開く。タスク名の欄ごとパネルへ移るので、元の場所の高さを残して本文が跳ねないようにする
  let quiet = false; // true の間はフォーカスしても開かない（Esc で戻した時）
  const wide = window.matchMedia('(min-width: 840px)');
  function setOpen(v) {
    if (v === container.classList.contains('is-open')) return;
    if (v && wide.matches) container.style.minHeight = `${container.offsetHeight}px`;
    if (!v) container.style.minHeight = '';
    container.classList.toggle('is-open', v);
    document.body.classList.toggle('has-add', v && wide.matches);
  }
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
    if (!data.project) delete data.sprint;
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
    const sig = `${areaNames().join('')}${projectNames().join('')}`;
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
    // 画面から開く（週・カレンダーで日をダブルクリックした時）。その時の文脈（やる日）を初期値にして名前の欄へ
    open() {
      touched = new Set();
      syncContext();
      renderTags();
      title.focus();
      setOpen(true);
    },
  };
}

// マウスのホイール（縦）で、横に流したタグを動かす。PCのマウスには横に動かす操作がほぼ無いため
function wheelSideways(box) {
  box.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || box.scrollWidth <= box.clientWidth) return;
    e.preventDefault();
    box.scrollLeft += e.deltaY;
  }, { passive: false });
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
