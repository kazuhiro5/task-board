// 繰り返しの予定：未完了の繰り返しタスク（今の回）から、先の回を計算して画面にだけ出す。
// withRepeats(tasks, from, to)：tasks に、from〜to（YYYY-MM-DD）の予定の回を足して返す。
//   予定の回は { ...今の回, id: '根_日付', doDate, virtual: true, headId }。保存はしていない（store の checkOccurrence で保存する）。
//   出すのは今日以降で、今の回のやる日より後の日だけ（過ぎた日の予定は出さない＝やらなかった回は溜まらない）。
//   その日の文書が既にある（チェックした・消した）日は出さない。
import { takenIds, repeatRoot } from '../store.js';
import { normRepeat, nextDate } from '../repeat.js';
import { todayKey, addDays } from '../dates.js';
import { isOpen } from './card.js';

const LIMIT = 400; // 1つの繰り返しから作る回の上限（毎日でも1年分を超えない。決まりが壊れていても止まるように）

export function withRepeats(tasks, from, to) {
  const t = todayKey();
  const start = from < t ? t : from;
  if (start > to) return tasks;
  const taken = takenIds();
  const out = [];
  for (const head of tasks) {
    const rep = normRepeat(head.repeat);
    if (!rep || !isOpen(head) || head.virtual) continue;
    const root = repeatRoot(head.id);
    const shift = head.doDate && head.dueDate ? Math.round((new Date(head.dueDate) - new Date(head.doDate)) / 86400000) : null;
    let cur = head.doDate && head.doDate >= addDays(start, -1) ? head.doDate : addDays(start, -1);
    for (let i = 0; i < LIMIT; i++) {
      const d = nextDate(rep, cur);
      if (!d || d > to || d <= cur) break;
      cur = d;
      if (d < start || (head.doDate && d <= head.doDate)) continue;
      const id = `${root}_${d}`;
      if (taken.has(id)) continue;
      out.push({
        ...head, id, doDate: d, dueDate: shift == null ? null : addDays(d, shift),
        status: 'todo', virtual: true, headId: head.id, order: head.order,
      });
    }
  }
  return out.length ? [...tasks, ...out] : tasks;
}
