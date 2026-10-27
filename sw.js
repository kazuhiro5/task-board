// service worker（オフライン用）。担当：PWA役。今は何もしない。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
