/* Bin Raider service worker: caches the app shell so it opens offline. Never caches API responses. */
var CACHE = "binraider-0.1.0";
var SHELL = ["./", "index.html", "css/app.css", "js/deal.js", "js/sites.js", "js/data.js", "js/app.js", "manifest.webmanifest",
  "icons/mark.svg", "icons/icon-192.png", "icons/icon-512.png", "fonts/ArchivoBlack-Regular.ttf"];
self.addEventListener("install", function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== self.location.origin) return; // APIs and shops go straight to the network
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
    var net = fetch(e.request).then(function (res) { if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); } return res; }).catch(function () { return hit; });
    return hit || net;
  }));
});
