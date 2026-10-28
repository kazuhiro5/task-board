// service worker（オフライン用）。担当：PWA役。
// - 自分のファイル：端末の控えをすぐ返し、裏で新しいものを取りに行く（stale-while-revalidate）
// - Firebase の部品（gstatic、版固定）：控えがあればそれを使う（キャッシュ優先）
// - それ以外（Firestore・ログインの通信など）：横取りしない
// ファイルを足した・中身を変えた時は VERSION を上げる。上げると全部まとめて入れ替わる（JSの版ずれを防ぐ）。

const VERSION = 'v9';
const CACHE = `task-board-${VERSION}`;
const FIREBASE_PREFIX = 'https://www.gstatic.com/firebasejs/11.0.2/';

// ビルドなしのため、控えるファイルはここに手で書く（sw.js からの相対パス）
const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './css/add.css',
  './css/views.css',
  './css/edit.css',
  './js/app.js',
  './js/firebase.js',
  './js/store.js',
  './js/add.js',
  './js/edit.js',
  './js/dates.js',
  './js/constants.js',
  './js/views/today.js',
  './js/views/week.js',
  './js/views/list.js',
  './js/views/card.js',
  './js/views/projects.js',
  './js/views/modes.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];
const FIREBASE_FILES = [
  'firebase-app.js',
  'firebase-auth.js',
  'firebase-firestore.js',
].map((f) => FIREBASE_PREFIX + f);

const SCOPE = new URL(self.registration.scope);
const INDEX_URL = new URL('./index.html', SCOPE).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 1件ずつ入れ、取れなかったものは飛ばす（cache.addAll は1件の失敗で全部失敗するため）。
    // 飛ばしたものは、開いた時にネットから取って控えに足す（staleWhileRevalidate / cacheFirst）
    // cache: 'reload' でブラウザのHTTPキャッシュを通さず、必ず最新を取る
    const appReqs = APP_FILES.map((u) => new Request(u, { cache: 'reload' }));
    // Firebase の部品は module script と同じく CORS で取る
    const fbReqs = FIREBASE_FILES.map((u) => new Request(u, { mode: 'cors', credentials: 'omit' }));
    await Promise.all([...appReqs, ...fbReqs].map(async (r) => {
      try {
        const res = await fetch(r);
        if (res.ok) await cache.put(r.url, res);
      } catch { /* 取れなかったものは飛ばす */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('task-board-') && k !== CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Firebase の部品（版固定）：キャッシュ優先
  if (req.url.startsWith(FIREBASE_PREFIX)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // 自分の範囲（同じ場所・scope の中）だけを扱う。ほかは横取りしない
  if (url.origin !== SCOPE.origin || !url.href.startsWith(SCOPE.href)) return;

  // ページを開く：範囲の直下（/task-board/）か index.html の時だけ、控えの index.html を返す
  // （?demo=1 などの付いたURLも同じ）。それ以外のURLをページとして開いた時は横取りしない
  if (req.mode === 'navigate') {
    if (url.pathname === SCOPE.pathname || url.href.split(/[?#]/)[0] === INDEX_URL) {
      event.respondWith(staleWhileRevalidate(event, INDEX_URL, req));
    }
    return;
  }

  event.respondWith(staleWhileRevalidate(event, stripSearch(url), req));
});

function stripSearch(url) {
  return url.origin + url.pathname;
}

// 控えがあればすぐ返し、裏でネットから取り直して控えを新しくする
async function staleWhileRevalidate(event, key, req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(key);
  const network = fetch(req.mode === 'navigate' ? key : req, { cache: 'no-cache' })
    .then(async (res) => {
      if (res && res.ok && res.type === 'basic') await cache.put(key, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const res = await network;
  if (res) return res;
  // 控えもネットもない：ページを開く時だけ index.html を最後の手段にする
  if (req.mode === 'navigate') {
    const fallback = await cache.match(INDEX_URL);
    if (fallback) return fallback;
  }
  return Response.error();
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req.url);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) await cache.put(req.url, res.clone());
    return res;
  } catch {
    return Response.error();
  }
}
