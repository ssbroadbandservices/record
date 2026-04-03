const CACHE_NAME = 'hybrid-portal-v6'; // Bumped version to clear old cache!
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json'
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(ASSETS).catch(err => {
                    console.warn('Some assets failed to cache', err);
                });
            })
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.map(key => {
                if (key !== CACHE_NAME) return caches.delete(key);
            })
        ))
    );
    return self.clients.claim(); // Take over immediately
});

self.addEventListener('fetch', e => {
    // Only intercept requests for our same-origin assets
    if (!e.request.url.startsWith(self.location.origin)) {
        return; // Let external requests (QR codes, logos) bypass Service Worker to avoid html2canvas CORS crashes
    }

    e.respondWith(
        fetch(e.request).then(networkResponse => {
            return caches.open(CACHE_NAME).then(cache => {
                cache.put(e.request, networkResponse.clone());
                return networkResponse;
            });
        }).catch(() => caches.match(e.request))
    );
});
