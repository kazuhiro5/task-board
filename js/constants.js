// 分類の選択肢。表示の順番もこの並び。
// 用途は Firestore の users/{uid}/meta/areas に持つ（足せる）。文書が無い時はこの6つ（store.js の getAreas）。
// 画面は AREAS を直接使わず、store.js の areaNames()／areaColor() を使う。
export const AREAS = ['大学', 'AI開発', '就活', 'バイト', '家事', '勉強'];
// 決まった6つの色は css/style.css の --cat-*（ライト／ダークで切り替わる）。英字の名前で引く
export const AREA_KEYS = { 大学: 'univ', AI開発: 'ai', 就活: 'job', バイト: 'work', 勉強: 'study', 家事: 'home' };
// 決まった6つの色（ライトの値。Firestore に書く時だけ使う。表示は --cat-*）
export const AREA_HEX = { 大学: '#0072B2', AI開発: '#A8558A', 就活: '#D55E00', バイト: '#B07800', 勉強: '#009E73', 家事: '#6E7781' };
// 足した用途の色（この順に使う）。ライト・ダークどちらの背景でも見分けられる濃さ。点＋用途名で出すので色だけに頼らない
export const SPARE_COLORS = ['#7B61FF', '#00838F', '#C2185B', '#8D6E63', '#2E7D32', '#E65100', '#5C6BC0', '#AD1457'];
export const PRIORITIES = ['高', '中', '低'];
export const STATUSES = [
  { value: 'todo', label: '未着手' },
  { value: 'doing', label: '進行中' },
  { value: 'waiting', label: '待ち' },
  { value: 'done', label: '完了' },
];
export const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.value, s.label]));
