// 画面「検索」（上の虫めがね・「/」キーで開く。下のタブ・左の一覧には出さない）。
// タスク名・内容・プロジェクト・用途から探す。空白で区切ると、すべての言葉を含むものだけ。
// 全角・半角、大文字・小文字の違いは無視する（NFKC＋小文字にそろえて比べる）。
// 打つたびに結果だけを描き直す（画面ごと描き直すと、入力欄の文字の位置・変換中の文字が消えるため）。
import { h, isOpen, taskCard, compareTasks } from './card.js';

let query = '';
let input = null; // 描き直しても同じ入力欄を使う
const DONE_MAX = 30; // 完了は新しい順にここまで（古いものまで出すと探しにくい）

const norm = (s) => String(s || '').normalize('NFKC').toLowerCase();

function results(tasks) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const hit = tasks.filter((x) => {
    const text = norm([x.title, x.memo, x.project, x.area].join(' '));
    return words.every((w) => text.includes(w));
  });
  const open = hit.filter(isOpen).sort(compareTasks);
  const done = hit.filter((x) => !isOpen(x)).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  return { open, done };
}

function resultBox(tasks) {
  const r = results(tasks);
  if (!r) return h('p', { class: 'tb-empty tb-guide' }, 'タスク名・内容・プロジェクト・用途から探します。空白で区切ると、全部を含むものだけ出ます');
  if (!r.open.length && !r.done.length) return h('p', { class: 'tb-empty' }, `「${query.trim()}」は見つかりませんでした`);
  return h('div', {},
    h('section', { class: 'tb-sec' },
      h('h2', { class: 'tb-sec-head' }, h('span', { class: 'tb-sec-title' }, '未完了'), h('span', { class: 'tb-count' }, String(r.open.length))),
      r.open.length ? h('div', { class: 'tb-cards' }, r.open.map((x) => taskCard(x))) : null),
    r.done.length
      ? h('section', { class: 'tb-sec' },
        h('h2', { class: 'tb-sec-head' }, h('span', { class: 'tb-sec-title' }, '完了'), h('span', { class: 'tb-count' }, String(r.done.length))),
        h('div', { class: 'tb-cards' }, r.done.slice(0, DONE_MAX).map((x) => taskCard(x))),
        r.done.length > DONE_MAX ? h('p', { class: 'tb-empty' }, `ほか${r.done.length - DONE_MAX}件（言葉を足して絞ってください）`) : null)
      : null);
}

export function renderSearch(container, tasks, opts) {
  opts.setContext({});
  if (!input) {
    input = h('input', {
      type: 'search', class: 'tb-search', placeholder: 'タスクを探す', 'aria-label': 'タスクを探す', enterkeyhint: 'search', autocomplete: 'off',
    });
  }
  input.value = query;
  const box = h('div', { class: 'tb-search-results' }, resultBox(tasks));
  input.oninput = () => { query = input.value; box.replaceChildren(resultBox(tasks)); };
  const hadFocus = document.activeElement === input;
  const [s, e] = [input.selectionStart, input.selectionEnd];
  container.replaceChildren(h('div', { class: 'tb-search-view' }, input, box));
  if (hadFocus) { input.focus(); try { input.setSelectionRange(s, e); } catch { /* 選べない時はそのまま */ } }
}

// 開いた直後に入力欄へ
export function focusSearch() {
  requestAnimationFrame(() => { input?.focus(); input?.select(); });
}
