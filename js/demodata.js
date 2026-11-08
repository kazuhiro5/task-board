// 見本データ（?demo=1）。人に見せる・試してもらうための架空のデータで、本人のデータは入れない（このリポジトリは公開のため）。
// 日付は開いた日から数えて作る（ファイルに日付を固定すると、日がたつと全部が期限切れや過去になり見本にならないため）。
// 全部の画面に何かが出るように作る：ホーム（今日のタスク・プロジェクト）・今日（期限切れ・持ち越し）・週・一覧・
// プロジェクト（WBS3段・今／過去／次のスプリント・バックログ）・リンク集・ゴミ箱。
import { addDays, weekStart } from './dates.js';

export function demoData(t) {
  const mon = weekStart(t); // 今週の月曜
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  let n = 0;
  const tasks = [];
  const add = (o) => {
    const id = o.id || `demo${++n}`;
    tasks.push({
      title: '', memo: '', area: null, project: null, parent: null, sprint: null, doDate: null, dueDate: null,
      status: 'todo', priority: null, size: null, repeat: null, completedAt: null,
      createdAt: now - 20 * day + n * 1000, updatedAt: now, order: n * 1000, ...o, id,
    });
    return id;
  };
  const done = { status: 'done', completedAt: now - 2 * day };

  // ---- 日々のタスク（プロジェクトなし） ----
  add({ title: '経営学のレポートを書く', area: '大学', doDate: t, dueDate: addDays(t, 2), priority: '高', memo: '2000字。参考文献を3つ以上' });
  add({ title: 'ゼミの資料を読む', area: '大学', doDate: t, memo: '第3章まで' });
  add({ title: '面接の逆質問を3つ考える', area: '就活', doDate: t });
  add({ title: 'シフトを出す', area: 'バイト', doDate: t, dueDate: t });
  add({ title: '洗濯', area: '家事', doDate: t, repeat: { type: 'weekly', days: [1, 4] } });
  add({ title: 'ESを出す（サンプル商事）', area: '就活', dueDate: addDays(t, -1), priority: '高', memo: '期限切れの見本' });
  add({ title: '統計の小テストの復習', area: '勉強', doDate: addDays(t, -2), memo: '持ち越しの見本' });
  add({ title: '説明会の予約', area: '就活', doDate: addDays(t, 1) });
  add({ title: '英語の単語テスト', area: '勉強', doDate: addDays(t, 3), dueDate: addDays(t, 3) });
  add({ title: '部屋の片付け', area: '家事', doDate: addDays(t, 5), priority: '低' });
  add({ title: '先生の返信待ち（課題の再提出）', area: '大学', status: 'waiting' });
  add({ title: '読みたい本を探す', area: '勉強' });
  add({ title: '思いついたこと（まだ整理していない）' });
  add({ title: '銀行で住所変更', area: '家事', doDate: addDays(t, -1), ...done });
  add({ title: '朝の授業の出席', area: '大学', doDate: t, ...done });

  // ---- プロジェクト1：家計簿アプリ（WBS3段・1週間のスプリント×4。先週・今週・来週…） ----
  const P1 = '家計簿アプリ';
  const s1 = [0, 1, 2, 3].map((i) => ({ id: `demoS1${i}`, name: ['スプリント1（下調べ）', 'スプリント2（入力画面）', 'スプリント3（集計）', 'スプリント4（仕上げ）'][i], start: addDays(mon, (i - 1) * 7), days: 7 }));
  const a1 = { area: 'AI開発', project: P1 };
  const w1 = add({ ...a1, title: '要件を決める' });
  add({ ...a1, parent: w1, sprint: 'demoS10', title: '似たアプリを3つ触る', memo: '良い所・困る所を書き出す', ...done });
  add({ ...a1, parent: w1, sprint: 'demoS10', title: '入れる項目を決める', ...done });
  add({ ...a1, parent: w1, sprint: 'demoS10', title: '画面の下書き', ...done });
  const w2 = add({ ...a1, title: '入力画面' });
  const w21 = add({ ...a1, parent: w2, title: '支出の入力' });
  add({ ...a1, parent: w21, sprint: 'demoS11', title: '金額と日付の欄', ...done });
  add({ ...a1, parent: w21, sprint: 'demoS11', title: '分類を選ぶボタン', status: 'doing' });
  add({ ...a1, parent: w21, sprint: 'demoS11', title: 'レシートの写真から読む', priority: '高', memo: '読み取りの精度を試す' });
  add({ ...a1, parent: w2, sprint: 'demoS11', title: '収入の入力' });
  add({ ...a1, parent: w2, sprint: 'demoS11', title: 'スマホで押しやすくする' });
  const w3 = add({ ...a1, title: '集計' });
  add({ ...a1, parent: w3, sprint: 'demoS12', title: '月ごとの合計' });
  add({ ...a1, parent: w3, sprint: 'demoS12', title: '分類ごとの円グラフ' });
  add({ ...a1, parent: w3, sprint: 'demoS12', title: '先月との比べ' });
  const w4 = add({ ...a1, title: '公開' });
  add({ ...a1, parent: w4, sprint: 'demoS13', title: '友だち3人に試してもらう' });
  add({ ...a1, parent: w4, sprint: 'demoS13', title: '直しを入れる' });
  add({ ...a1, parent: w4, title: 'アイコンを作る', memo: 'バックログ（まだスプリントに入れていない）の見本' });

  // ---- プロジェクト2：ゼミ発表（2週間のスプリント×3） ----
  const P2 = 'ゼミ発表';
  const s2 = [0, 1, 2].map((i) => ({ id: `demoS2${i}`, name: ['スプリント1（テーマ）', 'スプリント2（分析）', 'スプリント3（資料）'][i], start: addDays(mon, i * 14), days: 14 }));
  const a2 = { area: '大学', project: P2 };
  const z1 = add({ ...a2, title: 'テーマ決め' });
  add({ ...a2, parent: z1, sprint: 'demoS20', title: '先行研究を5本読む', status: 'doing' });
  add({ ...a2, parent: z1, sprint: 'demoS20', title: '先生に相談', dueDate: addDays(t, 4) });
  const z2 = add({ ...a2, title: 'データ分析' });
  add({ ...a2, parent: z2, sprint: 'demoS21', title: 'アンケートを作る' });
  add({ ...a2, parent: z2, sprint: 'demoS21', title: '集計とグラフ' });
  const z3 = add({ ...a2, title: '発表資料' });
  add({ ...a2, parent: z3, sprint: 'demoS22', title: 'スライド10枚' });
  add({ ...a2, parent: z3, sprint: 'demoS22', title: '発表の練習', dueDate: addDays(mon, 41) });

  // ---- プロジェクト3：引っ越し準備（スプリントなし・小さいプロジェクト） ----
  const a3 = { area: '家事', project: '引っ越し準備' };
  add({ ...a3, title: '不動産屋に連絡', ...done });
  add({ ...a3, title: '段ボールをもらう', doDate: addDays(t, 2) });
  add({ ...a3, title: '電気・ガスの手続き', dueDate: addDays(t, 10) });

  // ---- ゴミ箱：3日前に消したもの（残る）と、31日前に消したもの（開いた時に完全に消える） ----
  add({ title: '3日前に消したタスク', area: '家事', deletedAt: now - 3 * day });
  add({ title: '31日前に消したタスク', area: '家事', deletedAt: now - 31 * day });

  return {
    tasks,
    projects: [
      { name: P1, sprints: s1 },
      { name: P2, sprints: s2 },
      { name: '引っ越し準備', sprints: [] },
    ],
    links: [
      { id: 'demoL1', area: '大学', name: '大学のポータル（見本）', url: 'https://example.com/portal', createdAt: 1 },
      { id: 'demoL2', area: '大学', name: '', url: 'https://example.com/class', createdAt: 2 },
      { id: 'demoL3', area: '就活', name: '就活サイト（見本）', url: 'https://example.com/job', createdAt: 3 },
      { id: 'demoL4', area: 'AI開発', name: 'GitHub', url: 'https://github.com/', createdAt: 4 },
    ],
  };
}
