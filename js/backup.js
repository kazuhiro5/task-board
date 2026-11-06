// バックアップ：今のデータ（タスク・プロジェクト・用途・リンク）を1つのJSONファイルにして端末に保存する。
// ファイル名は task-board_YYYY-MM-DD_HHMM.json。最後に書き出した日時は localStorage の tb.lastBackup に残す（端末ごと）。
// 中身は人が読める形（字下げ付き）にする。Firestore が止まっても、ファイルだけで中身を確かめられるように。

import { exportData, getTasks, getTrash, checkBackup, importData } from './store.js';
import { showToast } from './toast.js';

const KEY = 'tb.lastBackup';

function pad(n) { return String(n).padStart(2, '0'); }

function fileName(d) {
  return `task-board_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

export function lastBackupLabel() {
  let iso = null;
  try { iso = localStorage.getItem(KEY); } catch { /* 読めなくても動く */ }
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `前回：${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function writeBackup() {
  try {
    const data = exportData();
    const now = new Date(data.exportedAt);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName(now);
    document.body.appendChild(a);
    a.click();
    a.remove();
    // すぐ消すと保存が始まる前に切れる端末があるので少し待つ
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    try { localStorage.setItem(KEY, data.exportedAt); } catch { /* 保存できなくても動く */ }
    const n = getTasks().length;
    const t = getTrash().length;
    showToast(`バックアップを書き出しました（タスク${n}件${t ? `・ゴミ箱${t}件` : ''}）`);
  } catch (e) {
    console.error(e);
    showToast('バックアップを書き出せませんでした');
  }
}

// バックアップを読み込む：ファイルを選ぶ → 画面の真ん中に件数と注意を出し、「読み込む」を押した時だけ書く。
// 確認には confirm() を使わず、このアプリの中の小さな画面（dialog）を出す（confirm は使わない決まり）。
// 同じ id は上書き、ファイルに無いものは消さない
export function readBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    let data;
    let info;
    try {
      data = JSON.parse(await file.text());
      info = checkBackup(data);
    } catch (e) {
      showToast(`読み込めませんでした（${e.message || e}）`);
      return;
    }
    askImport(info, () => {
      try {
        const r = importData(data);
        r.done.catch((e) => showToast(`一部を保存できませんでした（${e.message || e}）`));
        showToast(`読み込みました（タスク${r.tasks}件・リンク${r.links}件）`);
      } catch (e) {
        showToast(`読み込めませんでした（${e.message || e}）`);
      }
    });
  });
  input.click();
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function askImport(info, onOk) {
  const d = new Date(info.exportedAt);
  const when = isNaN(d) ? '日時不明' : `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const dlg = el('dialog', 'tb-confirm');
  dlg.setAttribute('aria-labelledby', 'tbConfirmTitle');
  const title = el('h2', 'tb-confirm-title', 'バックアップを読み込みますか');
  title.id = 'tbConfirmTitle';
  const counts = el('ul', 'tb-confirm-counts');
  for (const [k, v] of [
    ['バックアップの日時', when],
    ['タスク', `${info.tasks}件${info.trash ? `（うちゴミ箱${info.trash}件）` : ''}`],
    ['リンク', `${info.links}件`],
    ['プロジェクト', `${info.projects}件`],
  ]) {
    const li = el('li');
    li.append(el('span', 'tb-confirm-k', k), el('span', 'tb-confirm-v', v));
    counts.append(li);
  }
  const warn = el('p', 'tb-confirm-warn', '同じタスクはバックアップの中身で上書きし、後から直した所は消えます。読み込んだ後は「元に戻す」で戻せません。');
  const cancel = el('button', 'tb-btn', 'キャンセル');
  cancel.type = 'button';
  const ok = el('button', 'primary', `${info.tasks}件を読み込む`);
  ok.type = 'button';
  const btns = el('div', 'tb-confirm-btns');
  btns.append(cancel, ok);
  dlg.append(title, counts, warn, btns);
  document.body.append(dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  cancel.addEventListener('click', close);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  ok.addEventListener('click', () => { close(); onOk(); });
  dlg.showModal();
  cancel.focus(); // 誤って Enter で読み込まないよう、最初はキャンセルに置く
}
