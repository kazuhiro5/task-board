// Googleカレンダーの予定を読む。Google Apps Script のウェブアプリ（task-board/gas/calendar.gs）が
// 今日の予定と、その月の予定のある日を JSON で返すので、それを読むだけ。
// 直接 Calendar API を読まないのは、ブラウザでは許可が1時間で切れ、取り直しの手間が大きいため。
// つなぎ先（URL と合言葉）は store の getCalendarConf()（本人の場所にだけ保存。公開リポジトリには書かない）。
// 読んだ結果は月ごとに5分だけ覚え、同じ画面の描き直しで何度も読みに行かない。
import { getCalendarConf } from './store.js';

const cache = new Map(); // 'YYYY-MM|YYYY-MM-DD' → { at, data } または { at, error }
const TTL = 5 * 60 * 1000;
let pending = new Map();

// 今の値を返す（まだ無ければ null）。読み終わったら onLoad を呼ぶ（画面の描き直し用）
export function calendarFor(month, day, onLoad) {
  const conf = getCalendarConf();
  if (!conf) return { state: 'none' };
  const k = `${month}|${day}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.error ? { state: 'error', error: hit.error } : { state: 'ok', ...hit.data };
  if (!pending.has(k)) {
    const url = `${conf.url}${conf.url.includes('?') ? '&' : '?'}key=${encodeURIComponent(conf.key)}&month=${month}&day=${day}`;
    pending.set(k, fetch(url, { redirect: 'follow' })
      .then((r) => r.json())
      .then((d) => {
        if (!d || d.ok !== true) throw new Error(d?.error || '読めませんでした');
        cache.set(k, { at: Date.now(), data: { today: d.today || [], days: new Set(d.days || []) } });
      })
      .catch((e) => { cache.set(k, { at: Date.now(), error: e.message || String(e) }); })
      .finally(() => { pending.delete(k); onLoad?.(); }));
  }
  return hit ? (hit.error ? { state: 'error', error: hit.error } : { state: 'ok', ...hit.data }) : { state: 'loading' };
}
export function clearCalendarCache() { cache.clear(); }
