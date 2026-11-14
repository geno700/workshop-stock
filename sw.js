// Service worker: makes the app installable and keeps a copy of its files.
// - The app's own files are always fetched fresh when online (so updates show at once),
//   and served from the saved copy when offline.
// - Libraries from the CDN have fixed versions, so the saved copy is used first.
// - Everything else (the database, sign-in, the speech model) goes straight to the network.
const CACHE = 'workshop-stock-v1';
const CDN = 'https://cdn.jsdelivr.net/';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

async function save(request, response) {
  if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

async function freshFirst(request) {
  try {
    return await save(request, await fetch(request, { cache: 'no-cache' }));
  } catch (err) {
    const saved = await caches.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (saved) return saved;
    throw err;
  }
}

async function savedFirst(request) {
  return (await caches.match(request)) ?? save(request, await fetch(request));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.url.startsWith(self.location.origin + '/')) {
    if (request.url.startsWith(self.registration.scope)) event.respondWith(freshFirst(request));
  } else if (request.url.startsWith(CDN)) {
    event.respondWith(savedFirst(request));
  }
});
