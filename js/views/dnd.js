// 行を引きずって動かす（週・今日・カレンダー）。担当：画面役。
// HTML5 の draggable は iPhone の指で動かないため、pointer イベントで自作している。
//   マウス：押して 5px 動いたら開始。指・ペン：約0.3秒の長押しで開始（それまでに10px動いたらスクロールとみなす）
//   落とす先：[data-drop="区分の名前"] の要素。data-drop-ok があれば落とせる（無ければ見た目で「落とせない」）
//   引きずれる行：落とす先の中の .tb-card[data-id]（完了・data-drag="no" は除く）。押す所は .tb-body（完了の丸・内容の文字からは始めない）
//   Esc・落とせない所で離す → 元に戻す（何も書き込まない）。引きずった直後の click は捨てる（内容が開かないように）
//   キーボード：行で Alt+↑/↓ → 同じ区分の中で1つ上/下、Alt+←/→ → cfg.onKey に任せる（前後の日）
//
// enableDrag(rootEl, cfg)：描画のたびに新しい根の要素に付ける。
//   cfg = { rootSel, onDrop({ id, fromKey, toKey, toZone, finalIds }), onKey?(id, fromKey, dir) }
//   引きずっている間に描き直されても、rootSel で今の根を探し直す。
import { getTasks } from '../store.js';
import { planDrop, saveWrites } from './sort.js';
import { h } from './card.js';
import { addDays } from '../dates.js';

const MOUSE_SLOP = 5;
const TOUCH_SLOP = 10;
const HOLD_MS = 300;
const EDGE = 64; // 画面の端からこの距離に入ったら自動でスクロール
const SNAP = 10; // 区分の外側でも、この距離までは「その区分」とみなす（区分の間のすき間に落ちないように）

let s = null; // 今の引きずり（1つだけ）

export function enableDrag(root, cfg) {
  root.addEventListener('pointerdown', (e) => onDown(e, root, cfg));
  root.addEventListener('keydown', (e) => onKey(e, cfg));
  // Android の長押しメニューを出さない（引きずりの待ち・最中だけ）
  root.addEventListener('contextmenu', (e) => { if (s) e.preventDefault(); });
}

const zoneOf = (el) => el.closest('[data-drop]');
const movable = (card) => card && !card.classList.contains('is-done') && card.dataset.drag !== 'no';

function onDown(e, root, cfg) {
  if (s) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const body = e.target.closest('.tb-body');
  if (!body || !root.contains(body)) return;
  const card = body.closest('.tb-card[data-id]');
  const zone = card && zoneOf(card);
  if (!zone || !movable(card)) return;
  s = {
    cfg, root, card, zone,
    id: card.dataset.id,
    fromKey: zone.dataset.drop,
    pid: e.pointerId,
    touch: e.pointerType !== 'mouse',
    x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
    active: false, timer: 0, raf: 0, target: null,
  };
  if (s.touch) s.timer = setTimeout(begin, HOLD_MS);
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onEsc, true);
  document.addEventListener('touchmove', onTouchMove, { passive: false });
}

function onMove(e) {
  if (!s || e.pointerId !== s.pid) return;
  s.x = e.clientX;
  s.y = e.clientY;
  if (!s.active) {
    const dist = Math.hypot(s.x - s.x0, s.y - s.y0);
    if (s.touch) { if (dist >= TOUCH_SLOP) finish(false); } // 長押しの前に動いた＝スクロール
    else if (dist >= MOUSE_SLOP) begin();
    return;
  }
  e.preventDefault();
  follow();
}

// 引きずっている間はスクロールさせない（指の操作）
function onTouchMove(e) {
  if (s?.active) e.preventDefault();
}

function onUp(e) {
  if (!s || e.pointerId !== s.pid) return;
  finish(s.active);
}
function onCancel(e) {
  if (!s || e.pointerId !== s.pid) return;
  finish(false);
}
function onEsc(e) {
  if (e.key !== 'Escape' || !s) return;
  e.preventDefault();
  e.stopPropagation();
  finish(false);
}

function currentRoot() {
  const r = document.querySelector(s.cfg.rootSel);
  return r || s.root;
}

function begin() {
  if (!s || s.active) return;
  clearTimeout(s.timer);
  if (!s.card.isConnected) { finish(false); return; }
  s.active = true;
  const r = s.card.getBoundingClientRect();
  s.dx = s.x - r.left;
  s.dy = s.y - r.top;
  const ghost = s.card.cloneNode(true);
  for (const el of [ghost, ...ghost.querySelectorAll('[id]')]) el.removeAttribute('id');
  ghost.classList.add('tb-ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.width = `${r.width}px`;
  ghost.style.fontSize = getComputedStyle(s.card).fontSize; // 週の7列は小さい文字
  const area = s.card.querySelector('.tb-area');
  if (area && getComputedStyle(area).fontSize === '0px') ghost.querySelector('.tb-area').style.cssText = 'font-size:0;gap:0'; // 7列では用途名を隠している
  s.ghost = ghost;
  s.line = h('div', { class: 'tb-drop-line', 'aria-hidden': 'true' });
  document.body.append(ghost, s.line);
  s.card.classList.add('is-drag-src');
  document.documentElement.classList.add('tb-dragging');
  try { navigator.vibrate?.(12); } catch { /* 無くてよい */ }
  follow();
  s.raf = requestAnimationFrame(autoScroll);
}

function follow() {
  s.ghost.style.transform = `translate(${s.x - s.dx}px, ${s.y - s.dy}px) scale(1.03)`;
  findTarget();
}

// 区分に「落とせる／落とせない」の印を付ける（描き直されたら付け直す）
function markZones(root) {
  for (const z of root.querySelectorAll('[data-drop]')) {
    z.classList.toggle('is-drop-ok', z.hasAttribute('data-drop-ok'));
    z.classList.toggle('is-drop-no', !z.hasAttribute('data-drop-ok'));
  }
  for (const c of root.querySelectorAll(`.tb-card[data-id="${CSS.escape(s.id)}"]`)) c.classList.add('is-drag-src');
  s.marked = root;
}

function findTarget() {
  const root = currentRoot();
  if (s.marked !== root) markZones(root);
  const zones = [...root.querySelectorAll('[data-drop]')];
  let hit = null;
  let best = Infinity;
  for (const z of zones) {
    const r = z.getBoundingClientRect();
    if (!r.height || s.x < r.left || s.x > r.right) continue;
    const d = s.y < r.top ? r.top - s.y : s.y > r.bottom ? s.y - r.bottom : 0;
    if (d <= SNAP && d < best) { hit = z; best = d; }
  }
  for (const z of zones) z.classList.toggle('is-drop-over', z === hit);
  if (!hit || !hit.hasAttribute('data-drop-ok')) {
    s.target = null;
    s.line.hidden = true;
    return;
  }
  const cards = [...hit.querySelectorAll('.tb-card[data-id]')]
    .filter((c) => c.dataset.id !== s.id && movable(c) && zoneOf(c) === hit);
  let index = cards.length;
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    if (s.y < r.top + r.height / 2) { index = i; break; }
  }
  const ids = cards.map((c) => c.dataset.id);
  s.target = { key: hit.dataset.drop, zone: hit, finalIds: [...ids.slice(0, index), s.id, ...ids.slice(index)] };
  // 挿入位置の線
  const box = (hit.querySelector('.tb-cards') || hit).getBoundingClientRect();
  let y;
  if (cards.length === 0) {
    const head = hit.querySelector('.tb-sec-head, .tb-day-head');
    y = head ? head.getBoundingClientRect().bottom + 2 : box.top + 4;
  } else if (index < cards.length) y = cards[index].getBoundingClientRect().top - 2;
  else y = cards[cards.length - 1].getBoundingClientRect().bottom + 2;
  s.line.hidden = false;
  s.line.style.transform = `translate(${box.left}px, ${y - 1.5}px)`;
  s.line.style.width = `${box.width}px`;
}

// 画面の上端・下端に近づいたら自動でスクロール（スマホは下の入力欄・タブのぶん上で反応させる）
function autoScroll() {
  if (!s?.active) return;
  const top = (document.querySelector('.top')?.getBoundingClientRect().bottom || 0) + EDGE;
  const bottomBars = window.innerWidth < 840 ? 120 : 0;
  const bottom = window.innerHeight - bottomBars - EDGE;
  let v = 0;
  if (s.y < top) v = -Math.min(18, Math.ceil((top - s.y) / 4));
  else if (s.y > bottom) v = Math.min(18, Math.ceil((s.y - bottom) / 4));
  if (v) {
    const before = window.scrollY;
    window.scrollBy(0, v);
    if (window.scrollY !== before) findTarget();
  }
  s.raf = requestAnimationFrame(autoScroll);
}

// 引きずった後の click を1回だけ捨てる（押しただけの時は捨てない）
function swallowClick() {
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, true), 400);
}

function finish(drop) {
  const cur = s;
  s = null;
  clearTimeout(cur.timer);
  cancelAnimationFrame(cur.raf);
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onCancel);
  window.removeEventListener('keydown', onEsc, true);
  document.removeEventListener('touchmove', onTouchMove);
  if (!cur.active) return;
  cur.ghost.remove();
  cur.line.remove();
  document.documentElement.classList.remove('tb-dragging');
  for (const el of document.querySelectorAll('.is-drop-ok, .is-drop-no, .is-drop-over, .is-drag-src')) {
    el.classList.remove('is-drop-ok', 'is-drop-no', 'is-drop-over', 'is-drag-src');
  }
  swallowClick();
  if (drop && cur.target) {
    cur.cfg.onDrop({ id: cur.id, fromKey: cur.fromKey, toKey: cur.target.key, toZone: cur.target.zone, finalIds: cur.target.finalIds });
  }
}

// ---- キーボード：Alt+↑/↓ で順番、Alt+←/→ で前後の日 ----
let refocusId = null;
function onKey(e, cfg) {
  if (!e.altKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const card = e.target.closest('.tb-card[data-id]');
  const zone = card && zoneOf(card);
  if (!zone || !movable(card)) return;
  e.preventDefault();
  const id = card.dataset.id;
  refocusId = id;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    cfg.onKey?.(id, zone.dataset.drop, e.key === 'ArrowLeft' ? -1 : 1);
  } else {
    if (!zone.hasAttribute('data-drop-ok')) return;
    const ids = [...zone.querySelectorAll('.tb-card[data-id]')].filter((c) => movable(c) && zoneOf(c) === zone).map((c) => c.dataset.id);
    const i = ids.indexOf(id);
    const j = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    cfg.onDrop({ id, fromKey: zone.dataset.drop, toKey: zone.dataset.drop, toZone: zone, finalIds: ids });
  }
  // 描き直された後も、同じ行にフォーカスを戻す
  setTimeout(() => {
    const el = document.querySelector(`.tb-card[data-id="${CSS.escape(refocusId)}"] .tb-body`);
    el?.focus();
  }, 60);
}

// ---- 日付の区分へ落とした時の共通の処理（週・今日・カレンダー） ----
// opts = { mode, sameZoneSetsDate, dateOf(key) → 'YYYY-MM-DD'|null, setManual(), root }
//   sameZoneSetsDate：同じ区分の中でも、やる日が違えばその日にする（週の「〆だけ」の行）
export function dropToDay(ev, opts) {
  const byId = new Map(getTasks().map((x) => [x.id, x]));
  const task = byId.get(ev.id);
  if (!task) return;
  const sameZone = ev.fromKey === ev.toKey;
  const day = opts.dateOf(ev.toKey);
  if (!day) return;
  const datePatch = (!sameZone || opts.sameZoneSetsDate) && task.doDate !== day ? { doDate: day } : {};
  const writes = planDrop({ id: ev.id, finalIds: ev.finalIds, byId, datePatch, sameZone, mode: opts.mode });
  if (sameZone && opts.mode !== 'manual') opts.setManual();
  if (!writes.length) return;
  saveWrites(writes, () => showDropError());
}

function showDropError() {
  const root = document.querySelector('#view') || document.body;
  root.querySelector('.tb-drop-err')?.remove();
  const err = h('p', { class: 'tb-err tb-drop-err', role: 'alert' }, '保存できませんでした。もう一度動かしてください');
  root.prepend(err);
  setTimeout(() => err.remove(), 4000);
}

// 週の形（週・カレンダー）で使う引きずりの設定。区分の名前＝日付
export function dayDrag(rootSel, getMode, setManual) {
  return {
    rootSel,
    onDrop: (ev) => dropToDay(ev, { mode: getMode(), sameZoneSetsDate: true, dateOf: (k) => k, setManual }),
    // Alt+←/→：前後の日へ（順番の値はそのまま）
    onKey: (id, key, dir) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
      const day = addDays(key, dir);
      dropToDay({ id, fromKey: key, toKey: day, finalIds: [id] }, { mode: getMode(), sameZoneSetsDate: true, dateOf: (k) => k, setManual });
    },
  };
}
