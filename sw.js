/*
 * Service Worker для «НГТУ Ежедневник».
 * Задача: приложение открывается мгновенно и полностью работает без интернета.
 * Стратегия: cache-first с фоновым обновлением — это важно, потому что домен
 * хостинга может быть недоступен без VPN: после первого визита страница
 * берётся из кэша и сеть не требуется вовсе.
 */

const CACHE_VERSION = "nstu-v8-3";
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // Кэшируем по одному, чтобы отсутствие файла не ломало установку целиком
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: "reload" }));
      } catch (e) {
        // пропускаем недоступный ресурс
      }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => {
      if (key !== CACHE_VERSION && key.startsWith("nstu-")) return caches.delete(key);
      return null;
    }));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Кэшируем только GET-запросы своего origin
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Навигация: мгновенно отдаём кэш, в фоне обновляем его
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = (await cache.match("./index.html")) || (await cache.match("./"));

      const network = fetch(request).then((response) => {
        if (response && response.ok) {
          cache.put("./index.html", response.clone()).catch(() => {});
        }
        return response;
      }).catch(() => null);

      return cached || (await network) || new Response(
        "<!DOCTYPE html><meta charset='utf-8'><title>Нет сети</title><p style='font-family:sans-serif;padding:24px'>Нет соединения. Откройте приложение ещё раз — оно загрузится из кэша.</p>",
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    })());
    return;
  }

  // Остальные ресурсы: cache-first + фоновое обновление
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(request);

    const network = fetch(request).then((response) => {
      if (response && response.ok && response.type === "basic") {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    }).catch(() => null);

    return cached || (await network) || new Response("", { status: 504 });
  })());
});

// Push от сервера (на будущее — если появится отправка уведомлений с сервера)
self.addEventListener("push", (event) => {
  let payload = { title: "НГТУ Ежедневник", body: "Напоминание о дедлайне." };
  try {
    if (event.data) payload = Object.assign(payload, event.data.json());
  } catch (e) {
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    tag: payload.tag || "nstu-deadline",
    renotify: false,
    data: { url: payload.url || "./" }
  }));
});

// Клик по уведомлению: открыть или сфокусировать приложение
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "./";

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientList) {
      if ("focus" in client) {
        client.navigate(targetUrl).catch(() => {});
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    return null;
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
