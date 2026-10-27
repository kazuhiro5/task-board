// 日付は端末の時刻（日本時間）で 'YYYY-MM-DD' の文字列として扱う。
// 文字列のまま大小比較できる。

export function toKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey() {
  return toKey(new Date());
}

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

// 週の始まりは月曜（2026-10-28 オーナー）
export function weekStart(key) {
  const d = fromKey(key);
  const offset = (d.getDay() + 6) % 7; // 月曜=0 … 日曜=6
  d.setDate(d.getDate() - offset);
  return toKey(d);
}

export function weekDays(key) {
  const start = weekStart(key);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];

// 例：'10/28(水)'
export function label(key) {
  const d = fromKey(key);
  return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
}

// 今日からの近さで言い換える。例：'今日' '明日' '昨日' それ以外は label
export function relLabel(key) {
  const t = todayKey();
  if (key === t) return '今日';
  if (key === addDays(t, 1)) return '明日';
  if (key === addDays(t, 2)) return '明後日';
  if (key === addDays(t, -1)) return '昨日';
  return label(key);
}
