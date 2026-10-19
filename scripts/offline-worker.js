const entries = __ENTRIES__;
const version = '__VERSION__';
const base = new URL('./', self.location.href);
const prefix = `binaural-offline:${encodeURIComponent(base.pathname)}:`;
const name = prefix + version;
const urls = new Set(entries.map(entry => new URL(entry.path, base).href));
const index = new URL('index.html', base).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const retained = await caches.has(name);
    try {
      const cache = await caches.open(name);
      await cache.addAll(entries.map(entry => new Request(new URL(entry.path, base), {
        cache: 'reload', credentials: 'same-origin', integrity: entry.integrity,
      })));
    } catch (error) {
      if (!retained) await caches.delete(name);
      throw error;
    }
  })());
});

self.addEventListener('activate', event => {
  // Retain earlier versions for lazy imports in other open tabs.
  event.waitUntil(self.clients.claim());
});

async function inspectClients() {
  const clients = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(client => {
    const url = new URL(client.url);
    return url.origin === base.origin && [base.pathname, new URL(index).pathname].includes(url.pathname);
  });
  return Promise.all(clients.map(client => new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve({ safe: false }); }, 3000);
    channel.port1.onmessage = reply => {
      clearTimeout(timer); channel.port1.close(); resolve(reply.data ?? { safe: false });
    };
    client.postMessage({ type: 'CHECK_UPDATE_SAFETY' }, [channel.port2]);
  })));
}

self.addEventListener('message', event => {
  if (event.data?.type !== 'ACTIVATE_UPDATE' || !event.source?.url) return;
  const source = new URL(event.source.url);
  if (source.origin !== base.origin || ![base.pathname, new URL(index).pathname].includes(source.pathname)) return;
  event.waitUntil((async () => {
    const replies = await inspectClients();
    if (replies.length && replies.every(reply => reply.safe === true)) await self.skipWaiting();
    else event.source.postMessage({ type: 'UPDATE_BLOCKED' });
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return;
  const home = request.mode === 'navigate' && (url.pathname === base.pathname || url.pathname === new URL(index).pathname);
  const key = home ? index : url.href;
  event.respondWith((async () => {
    const current = await caches.open(name);
    if (home || urls.has(key)) {
      const cached = await current.match(key);
      if (cached) return cached;
    } else {
      for (const previous of await caches.keys()) {
        if (previous === name || !previous.startsWith(prefix)) continue;
        const cached = await (await caches.open(previous)).match(key);
        if (cached) return cached;
      }
    }
    return fetch(request);
  })());
});
