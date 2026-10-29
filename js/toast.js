// 画面の下に数秒だけ出す短いお知らせ（例：「削除しました・元に戻す」）。alert の代わり。
// showToast(text, { action, onAction, ms })：action があれば押せるボタンを付ける。
// 同時に出すのは1つだけ（新しいものが来たら前のものは消す）。押したら・時間がたったら消える。
let box = null;
let timer = 0;

function hide() {
  clearTimeout(timer);
  if (box) box.hidden = true;
}

export function showToast(text, { action, onAction, ms = 6000 } = {}) {
  if (!box) {
    box = document.createElement('div');
    box.className = 'toast';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  clearTimeout(timer);
  const msg = document.createElement('span');
  msg.className = 'toast-text';
  msg.textContent = text;
  box.replaceChildren(msg);
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-btn';
    btn.textContent = action;
    btn.addEventListener('click', () => { hide(); if (onAction) onAction(); });
    box.appendChild(btn);
  }
  box.hidden = false;
  timer = setTimeout(hide, ms);
}
