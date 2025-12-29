const CACHE_NAME = 'livelist-v2';
const ASSETS = [
    '/',
    '/index.html',
    '/list.html',
    '/login.html',
    '/style.css',
    '/script.js',
    '/icon.png',
    '/manifest.json'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('fetch', (e) => {
    // Simple cache-first strategy for static assets, network-only for API
    if (e.request.method !== 'GET') return;

    if (e.request.url.includes('/api/')) {
        return; // Don't cache API
    }

    e.respondWith(
        caches.match(e.request).then((response) => {
            return response || fetch(e.request);
        })
    );
});
