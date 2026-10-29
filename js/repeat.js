// 繰り返し（毎日／毎週◯曜（複数可）／毎月◯日 の3つだけ。status.md 2026-10-29）。
// タスクの repeat：{ type: 'daily' } ／ { type: 'weekly', days: [1, 4] }（月=1 … 日=7）／ { type: 'monthly', day: 15 } ／ null
// 完了にした時に次の回を作るのは store.js（updateTask）。ここは日付の計算と、入力欄・詳細の「繰り返し」の行。
import { addDays, fromKey, todayKey } from './dates.js';

export const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日']; // days の 1…7

// 'YYYY-MM-DD' の曜日（月=1 … 日=7）
export const isoDay = (key) => ((fromKey(key).getDay() + 6) % 7) + 1;

// 形をそろえる。おかしなものは null（繰り返しなし）
export function normRepeat(r) {
  if (!r || typeof r !== 'object') return null;
  if (r.type === 'daily') return { type: 'daily' };
  if (r.type === 'weekly') {
    const days = [...new Set((Array.isArray(r.days) ? r.days : []).map(Number))]
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7).sort((a, b) => a - b);
    return days.length ? { type: 'weekly', days } : null;
  }
  if (r.type === 'monthly') {
    const d = Number(r.day);
    return Number.isInteger(d) && d >= 1 && d <= 31 ? { type: 'monthly', day: d } : null;
  }
  return null;
}

const lastDay = (y, m) => new Date(y, m + 1, 0).getDate(); // m は 0 始まり

function monthKey(y, m, day) {
  const d = Math.min(day, lastDay(y, m)); // その月に無い日（31日など）は月末
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// base（今の回のやる日。無ければ今日）より後の、次の回の日
export function nextDate(repeat, base) {
  const r = normRepeat(repeat);
  if (!r) return null;
  const b = base || todayKey();
  if (r.type === 'daily') return addDays(b, 1);
  if (r.type === 'weekly') {
    for (let i = 1; i <= 7; i++) {
      const k = addDays(b, i);
      if (r.days.includes(isoDay(k))) return k;
    }
    return null;
  }
  // monthly：base より後で最初の「その日」（ふつうは翌月のその日）
  const d = fromKey(b);
  const same = monthKey(d.getFullYear(), d.getMonth(), r.day);
  if (same > b) return same;
  const nm = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return monthKey(nm.getFullYear(), nm.getMonth(), r.day);
}

// 2つの日付の差（日）
export function daysBetween(a, b) {
  return Math.round((fromKey(b) - fromKey(a)) / 86400000);
}

// 行に出す短い言葉。例：'毎日' '毎週月木' '毎月15日'
export function repeatLabel(repeat) {
  const r = normRepeat(repeat);
  if (!r) return '';
  if (r.type === 'daily') return '毎日';
  if (r.type === 'weekly') return `毎週${r.days.map((n) => WEEKDAYS[n - 1]).join('')}`;
  return `毎月${r.day}日`;
}

function chip(label, on, onclick, data = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip' + (on ? ' is-on' : '');
  b.setAttribute('aria-pressed', String(!!on));
  b.textContent = label;
  for (const [k, v] of Object.entries(data)) b.dataset[k] = v;
  b.addEventListener('click', onclick);
  return b;
}

// 入力欄（もっと）と詳細の「繰り返し」の中身。
// value：今の repeat。base()：今のやる日（初めて毎週・毎月を選んだ時の曜日・日に使う）。onChange(repeat)
export function repeatEditor({ value, base, onChange }) {
  let v = normRepeat(value);
  const box = document.createElement('div');
  box.className = 'rep-box';
  const set = (nv) => { v = nv; onChange(v); render(); };

  function render() {
    const b = (typeof base === 'function' ? base() : base) || todayKey();
    const types = document.createElement('div');
    types.className = 'tag-chips';
    types.append(
      chip('なし', !v, () => set(null), { rep: 'none' }),
      chip('毎日', v?.type === 'daily', () => set({ type: 'daily' }), { rep: 'daily' }),
      chip('毎週', v?.type === 'weekly', () => set(v?.type === 'weekly' ? v : { type: 'weekly', days: [isoDay(b)] }), { rep: 'weekly' }),
      chip('毎月', v?.type === 'monthly', () => set(v?.type === 'monthly' ? v : { type: 'monthly', day: fromKey(b).getDate() }), { rep: 'monthly' }),
    );
    const rows = [types];
    if (v?.type === 'weekly') {
      const days = document.createElement('div');
      days.className = 'tag-chips rep-days';
      days.setAttribute('role', 'group');
      days.setAttribute('aria-label', '繰り返す曜日');
      WEEKDAYS.forEach((w, i) => {
        const n = i + 1;
        const on = v.days.includes(n);
        days.append(chip(w, on, () => {
          const next = on ? v.days.filter((x) => x !== n) : [...v.days, n];
          if (next.length) set({ type: 'weekly', days: next }); // 最後の1つは外さない
        }, { wd: String(n) }));
      });
      rows.push(days);
    }
    if (v?.type === 'monthly') {
      const line = document.createElement('label');
      line.className = 'rep-month';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.max = '31';
      input.inputMode = 'numeric';
      input.className = 'tag-date rep-day';
      input.setAttribute('aria-label', '毎月の日');
      input.value = String(v.day);
      // 打っている途中で描き直さない（入力が消えないように）
      input.addEventListener('change', () => {
        const d = Math.min(31, Math.max(1, Math.round(Number(input.value)) || 1));
        input.value = String(d);
        v = { type: 'monthly', day: d };
        onChange(v);
      });
      const pre = document.createElement('span');
      pre.textContent = '毎月';
      const post = document.createElement('span');
      post.textContent = '日（無い月は月末）';
      line.append(pre, input, post);
      rows.push(line);
    }
    box.replaceChildren(...rows);
  }
  render();
  return box;
}
