// 入力欄（タスク名＋タグのボタン）。担当：入力役。
// mountAdd(container, getContext)：getContext() は今開いている分類（例 { area: '就活' }）を返す。初期値に使う。
import { addTask } from './store.js';

export function mountAdd(container, getContext) {
  container.innerHTML = '<form class="add-form"><input name="title" placeholder="タスクを追加" autocomplete="off"><button class="primary">追加</button></form>';
  const form = container.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = form.title.value.trim();
    if (!title) return;
    await addTask({ title, ...getContext() });
    form.reset();
  });
}
