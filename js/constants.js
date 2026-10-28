// 分類の選択肢。表示の順番もこの並び。
export const AREAS = ['大学', 'AI開発', '就活', 'バイト', '家事', '勉強'];
export const PRIORITIES = ['高', '中', '低'];
export const STATUSES = [
  { value: 'todo', label: '未着手' },
  { value: 'doing', label: '進行中' },
  { value: 'waiting', label: '待ち' },
  { value: 'done', label: '完了' },
];
export const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.value, s.label]));
