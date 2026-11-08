// 見本データ（?demo=1）。人に見せる・試してもらうための架空のデータで、本人のデータは入れない（このリポジトリは公開のため）。
// 大学の課題・大学のリンクは入れない（実在の授業や学内のページを人に見せないため）。
// 日付は開いた日から数えて作る（ファイルに日付を固定すると、日がたつと全部が期限切れや過去になり見本にならないため）。
// 実際に動いているプロジェクトに見えるよう、WBS（3段）・スプリント（済み／今／次）・内容のメモまで入れる。
import { addDays, weekStart } from './dates.js';

export function demoData(t) {
  const mon = weekStart(t); // 今週の月曜
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  let n = 0;
  const tasks = [];
  const add = (o) => {
    const id = `demo${++n}`;
    tasks.push({
      title: '', memo: '', area: null, project: null, parent: null, sprint: null, doDate: null, dueDate: null,
      status: 'todo', priority: null, size: null, repeat: null, completedAt: null,
      createdAt: now - 30 * day + n * 1000, updatedAt: now, order: n * 1000, ...o, id,
    });
    return id;
  };
  const DONE = { status: 'done', completedAt: now - 3 * day };
  // WBS を木の形で足す：[名前, { 項目 }, [子…]]。子のある行は見出し（スプリントは子に付ける）
  const tree = (base, nodes, parent = null) => {
    for (const [title, o = {}, kids] of nodes) {
      const id = add({ ...base, parent, title, ...o });
      if (kids) tree(base, kids, id);
    }
  };

  // ---- 日々のタスク（プロジェクトなし） ----
  add({ title: '面接の逆質問を3つ考える', area: '就活', doDate: t, priority: '高', memo: '・入社1年目に任される仕事\n・活躍している人の共通点\n・評価のされ方' });
  add({ title: 'シフトを出す', area: 'バイト', doDate: t, dueDate: t, memo: '来月分。土日は午後だけ入れる' });
  add({ title: '洗濯', area: '家事', doDate: t, repeat: { type: 'weekly', days: [1, 4] } });
  add({ title: 'ITパスポートの過去問 1回分', area: '勉強', doDate: t, memo: '間違えた問題はノートにまとめる。目標 7割' });
  add({ title: 'Firebaseの料金を確かめる', area: 'AI開発', doDate: t, memo: '無料枠でどこまで使えるか。Firestore の読み取り回数を見る' });
  add({ title: '銀行で住所変更', area: '家事', doDate: t, ...DONE });
  add({ title: '説明会のお礼メール（ミライ工業）', area: '就活', dueDate: addDays(t, -1), priority: '高', memo: '期限切れの見本。当日中に送るのが目安' });
  add({ title: '模擬試験の見直し', area: '勉強', doDate: addDays(t, -2), memo: '持ち越しの見本（やる日を過ぎた未完了）' });
  add({ title: 'OB訪問の日程を返す', area: '就活', doDate: addDays(t, 1), memo: '候補：火曜の夕方・木曜の午後' });
  add({ title: '月末の家計の見直し', area: '家事', doDate: addDays(t, 3), repeat: { type: 'monthly', day: 28 } });
  add({ title: 'ITパスポートの申し込み', area: '勉強', dueDate: addDays(t, 6), memo: '試験日の3日前まで。会場は家から近い所' });
  add({ title: '部屋の片付け', area: '家事', doDate: addDays(t, 5), priority: '低' });
  add({ title: '店長の返事待ち（年末のシフト）', area: 'バイト', status: 'waiting' });
  add({ title: '読みたい本を探す', area: '勉強', memo: '・チームの作り方\n・仕事の進め方' });
  add({ title: '思いついたこと（まだ整理していない）' });

  // ---- プロジェクト1：task-board（このアプリを作るプロジェクト。1週間のスプリント×5：先々週から） ----
  const P1 = 'task-board';
  const sp1 = ['土台', '今日と週の画面', 'プロジェクトの画面', '使いやすさ', '運用']
    .map((name, i) => ({ id: `demoA${i}`, name: `スプリント${i + 1}（${name}）`, start: addDays(mon, (i - 2) * 7), days: 7 }));
  const [A1, A2, A3, A4, A5] = sp1.map((s) => s.id);
  tree({ area: 'AI開発', project: P1 }, [
    ['要件定義', {}, [
      ['困っていることを書き出す', { sprint: A1, ...DONE, memo: '・タスクがメモ・カレンダー・頭の中に散らばる\n・プロジェクトの作業と日々の用事が混ざる' }],
      ['似たアプリを3つ比べる', { sprint: A1, ...DONE, memo: 'Todoist・Notion・Trello。良い所と合わない所を表に' }],
      ['要件定義書を書く', { sprint: A1, ...DONE, memo: '必ず要るもの／あるとよいもの／作らないもの、に分けた' }],
    ]],
    ['土台', {}, [
      ['Firebaseの準備', {}, [
        ['プロジェクトを作る', { sprint: A1, ...DONE }],
        ['Googleでログイン', { sprint: A1, ...DONE }],
        ['Firestoreのルール（本人だけ読める）', { sprint: A1, ...DONE, memo: '他の人のデータが読めないことをテストで確かめた' }],
      ]],
      ['オフラインでも開けるようにする', { sprint: A1, ...DONE, memo: 'Service Worker で画面のファイルを端末に置く' }],
      ['GitHub Pagesで公開', { sprint: A1, ...DONE }],
    ]],
    ['画面', {}, [
      ['今日の画面', { sprint: A2, ...DONE, memo: '期限切れ・持ち越し・今日 の3つに分けて出す' }],
      ['週の画面', {}, [
        ['引きずってやる日を変える', { sprint: A2, ...DONE }],
        ['日付なしの帯', { sprint: A2, ...DONE, memo: 'ふだんは閉じておき、押すと横に流して出す' }],
      ]],
      ['プロジェクトの画面', {}, [
        ['WBS（親子の3段）', { sprint: A3, ...DONE, memo: '番号（1・2.1・2.1.1）を名前の前に出す' }],
        ['スプリントのボード', { sprint: A3, status: 'doing', memo: 'バックログを左に固定。横に流しても見失わないように' }],
        ['タイムライン', { sprint: A3, priority: '高', memo: '大項目とスプリントの期間を横のバーで。今日の線を引く' }],
      ]],
      ['ホーム', { sprint: A3, memo: '今日のタスクとプロジェクトの今を1画面で' }],
    ]],
    ['使いやすさ', {}, [
      ['元に戻す・やり直す', { sprint: A4, memo: 'Ctrl+Z／Ctrl+Shift+Z。消した時も戻せるように' }],
      ['検索', { sprint: A4 }],
      ['スマホで押しやすくする', { sprint: A4, memo: 'ボタンは指の幅（44px）以上' }],
      ['暗い画面（ダークモード）', { sprint: A4, priority: '低' }],
    ]],
    ['運用', {}, [
      ['バックアップを書き出す・読み込む', { sprint: A5, priority: '高', memo: 'JSONで端末に保存。読み込みは足し合わせ（消さない）' }],
      ['Googleカレンダーをつなぐ', { sprint: A5 }],
      ['1週間使って振り返る', { sprint: A5, memo: '使わなかった画面・迷った所を書き出す' }],
      ['AIでタスクを細かく分ける', { memo: 'バックログ（まだスプリントに入れていない）の見本' }],
    ]],
  ]);

  // ---- プロジェクト2：就職活動（用途の「就活」と名前を分ける。2週間のスプリント×6：4週前から） ----
  const P2 = '就職活動';
  const sp2 = ['自己分析', '業界・企業研究', '応募書類', '選考の準備', '面接', '内定後']
    .map((name, i) => ({ id: `demoB${i}`, name: `スプリント${i + 1}（${name}）`, start: addDays(mon, (i - 2) * 14), days: 14 }));
  const [B1, B2, B3, B4, B5, B6] = sp2.map((s) => s.id);
  tree({ area: '就活', project: P2 }, [
    ['自己分析', {}, [
      ['これまでの経験を書き出す', { sprint: B1, ...DONE, memo: '小学校から今まで。頑張ったこと・楽しかったこと・つらかったこと' }],
      ['強み・弱みを3つずつ', { sprint: B1, ...DONE, memo: '友人3人にも聞いて、自分の考えと比べる' }],
      ['就活の軸を決める', { sprint: B1, ...DONE, memo: '①人の成長に関われる ②チームで進める ③若いうちから任される' }],
    ]],
    ['業界・企業研究', {}, [
      ['3つの業界に絞る', { sprint: B2, ...DONE, memo: '人材・コンサル・IT。業界地図で仕事の流れを確かめた' }],
      ['説明会', {}, [
        ['5社の説明会を予約', { sprint: B2, ...DONE }],
        ['参加して気づきをメモ', { sprint: B2, ...DONE, memo: '社員の話し方・質問への答え方も見る' }],
      ]],
      ['企業の比べ表を作る', { sprint: B2, ...DONE, memo: '事業・働き方・評価・勤務地・初任給' }],
    ]],
    ['応募書類', {}, [
      ['ガクチカ', { sprint: B3, ...DONE, memo: 'アルバイトで新人の教え方を変えた話。数字（辞める人が半分に）を入れる' }],
      ['自己PR', { sprint: B3, status: 'doing', memo: '強み1つ＋それが出た場面＋仕事でどう生かすか' }],
      ['志望動機（サンプル商事）', { sprint: B3, priority: '高', memo: 'なぜこの業界か → なぜこの会社か → 入って何をしたいか' }],
      ['ESを出す（サンプル商事）', { sprint: B3, dueDate: addDays(mon, 11), priority: '高' }],
    ]],
    ['選考', {}, [
      ['Webテスト対策', { sprint: B4, memo: '問題集を1冊、2周する' }],
      ['一次面接', {}, [
        ['よく聞かれる質問20問に答えを作る', { sprint: B4 }],
        ['友人と模擬面接', { sprint: B4, memo: '録画して、話す速さと目線を確かめる' }],
        ['逆質問を用意する', { sprint: B4 }],
      ]],
      ['二次面接', { sprint: B5 }],
      ['最終面接', { sprint: B5, memo: '役員の面接。入社の意思をはっきり伝える' }],
    ]],
    ['内定後', {}, [
      ['条件を確かめる', { sprint: B6, memo: '給与・勤務地・配属の決め方' }],
      ['承諾するか決める', { sprint: B6 }],
    ]],
  ]);

  // ---- プロジェクト3：引っ越し準備（スプリントなし・小さいプロジェクト） ----
  const a3 = { area: '家事', project: '引っ越し準備' };
  add({ ...a3, title: '不動産屋に連絡', ...DONE });
  add({ ...a3, title: '段ボールをもらう', doDate: addDays(t, 2) });
  add({ ...a3, title: '電気・ガス・水道の手続き', dueDate: addDays(t, 10), memo: '引っ越しの1週間前までに' });

  // ---- ゴミ箱：3日前に消したもの（残る）と、31日前に消したもの（開いた時に完全に消える） ----
  add({ title: '3日前に消したタスク', area: '家事', deletedAt: now - 3 * day });
  add({ title: '31日前に消したタスク', area: '家事', deletedAt: now - 31 * day });

  let k = 0;
  const link = (area, name, url) => ({ id: `demoL${++k}`, area, name, url, createdAt: k });
  return {
    tasks,
    projects: [
      { name: P1, sprints: sp1 },
      { name: P2, sprints: sp2 },
      { name: '引っ越し準備', sprints: [] },
    ],
    links: [
      link('AI開発', 'GitHub', 'https://github.com/'),
      link('AI開発', 'Firebase コンソール', 'https://console.firebase.google.com/'),
      link('AI開発', 'MDN（Webの仕様）', 'https://developer.mozilla.org/ja/'),
      link('就活', 'マイナビ', 'https://job.mynavi.jp/'),
      link('就活', 'リクナビ', 'https://job.rikunabi.com/'),
      link('就活', 'OfferBox', 'https://offerbox.jp/'),
      link('勉強', 'ITパスポート試験', 'https://www3.jitec.ipa.go.jp/JitesCbt/'),
      link('家事', 'Googleカレンダー', 'https://calendar.google.com/'),
    ],
  };
}
