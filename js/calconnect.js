// ⋯メニューの「Googleカレンダーをつなぐ」：Apps Script のウェブアプリのURLと合言葉を入れる小さな画面。
// 入れた値は Firestore の本人の場所（meta/areas の calendar）にだけ置く（公開リポジトリに書くと誰でも予定を読めるため）。
// つなぎ方の手順は task-board/gas/Googleカレンダーのつなぎ方.md
import { getCalendarConf, setCalendarConf } from './store.js';
import { clearCalendarCache } from './gcal.js';
import { showToast } from './toast.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function openCalendarConnect() {
  const now = getCalendarConf();
  const dlg = el('dialog', 'tb-confirm tb-calconn');
  dlg.setAttribute('aria-labelledby', 'tbCalTitle');
  const title = el('h2', 'tb-confirm-title', 'Googleカレンダーをつなぐ');
  title.id = 'tbCalTitle';
  const help = el('p', 'tb-calconn-help', 'Apps Script で公開したウェブアプリのURLと、スクリプトのプロパティ KEY に入れた合言葉を貼り付けます。ホームの右側に今日の予定が出ます。');
  const field = (label, value, type) => {
    const lab = el('label', 'tb-calconn-field');
    const inp = document.createElement('input');
    inp.type = type;
    inp.value = value;
    inp.autocomplete = 'off';
    lab.append(el('span', null, label), inp);
    return [lab, inp];
  };
  const [urlLab, urlIn] = field('ウェブアプリのURL', now?.url || '', 'url');
  urlIn.placeholder = 'https://script.google.com/macros/s/…/exec';
  const [keyLab, keyIn] = field('合言葉', now?.key || '', 'password');
  const err = el('p', 'tb-confirm-warn');
  err.hidden = true;
  const btns = el('div', 'tb-confirm-btns');
  const cancel = el('button', 'tb-btn', 'キャンセル');
  cancel.type = 'button';
  const off = now ? el('button', 'tb-btn', 'つなぐのをやめる') : null;
  if (off) off.type = 'button';
  const ok = el('button', 'primary', '保存');
  ok.type = 'button';
  btns.append(...[off, cancel, ok].filter(Boolean));
  dlg.append(title, help, urlLab, keyLab, err, btns);
  document.body.append(dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  const save = async (conf, msg) => {
    try {
      await setCalendarConf(conf);
      clearCalendarCache();
      close();
      showToast(msg);
    } catch (e) {
      console.warn('[task-board] カレンダーのつなぎ先を保存できない', e);
      err.textContent = '保存できませんでした。もう一度押してください';
      err.hidden = false;
    }
  };
  cancel.addEventListener('click', close);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  off?.addEventListener('click', () => save(null, 'Googleカレンダーとのつなぎを外しました'));
  ok.addEventListener('click', () => {
    const url = urlIn.value.trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) {
      err.textContent = 'URLは https://script.google.com/ で始まるものを貼ってください';
      err.hidden = false;
      return;
    }
    if (!keyIn.value.trim()) { err.textContent = '合言葉を入れてください'; err.hidden = false; return; }
    save({ url, key: keyIn.value }, 'Googleカレンダーをつなぎました');
  });
  dlg.showModal();
  urlIn.focus();
}
