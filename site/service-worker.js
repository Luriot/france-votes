/* Service worker — coquille hors-ligne + données en réseau d'abord.
   Après une modification d'asset : incrémenter ?v=N dans les pages (les URL changent)
   et, si la liste SHELL change, incrémenter VERSION ici. */

const VERSION = "v3";
const SHELL_CACHE = `fv-shell-${VERSION}`;
const DATA_CACHE = `fv-data-${VERSION}`;
const SHELL = [
  "./",
  "./index.html",
  "./votes.html",
  "./questionnaire.html",
  "./methodologie.html",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
];

// Pré-cache la coquille + les assets versionnés lus dans index.html (découvre ?v=N tout seul).
async function precache() {
  const cache = await caches.open(SHELL_CACHE);
  await cache.addAll(SHELL);
  try {
    const html = await (await fetch("./index.html", { cache: "no-cache" })).text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:css|js)(?:\?v=\d+)?)"/g)].map((m) => m[1]);
    await cache.addAll([...new Set(assets)]);
  } catch {
    /* installation hors-ligne : le cache se remplira à la première visite en ligne */
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.endsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Données : réseau d'abord (fraîcheur), cache en secours (hors-ligne).
  if (url.pathname.endsWith(".json")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(DATA_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  // Navigations : réseau d'abord (et mise en cache), puis page en cache, puis coquille.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match("./index.html"))),
    );
    return;
  }

  // Assets : cache d'abord (URL versionnées ?v=N), réseau et mise en cache sinon.
  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
      return response;
    })),
  );
});
