/* Bin Raider - price data layer. Official APIs only, never scrapes.
   Discogs (default, no key needed): database search for vinyl releases, then marketplace stats
   (lowest listed price in GBP + number for sale) for the top few pressings.
   With an optional Discogs personal token: also the Discogs suggested VG+ price per release.
   eBay Browse API: only when an eBay token is set. Browsers block it (no CORS), so on the web it
   needs config.proxyBase; the Android app calls it natively through CapacitorHttp.
   Vinted and Facebook have no public API, so they stay as links. */
(function (root) {
  var Deal = root.BRDeal || (typeof require !== "undefined" ? require("./deal.js") : null);
  var Sites = root.BRSites || (typeof require !== "undefined" ? require("./sites.js") : null);

  var config = {
    version: "0.2.0",
    userAgent: "BinRaider/0.2 +https://bin-raider.github.io/bin-raider/",
    discogsBase: "https://api.discogs.com",
    ebayBase: "https://api.ebay.com",
    // Optional. eBay Browse does not allow browser CORS, so the PWA needs a small proxy that forwards
    // GET {proxyBase}/buy/browse/v1/... to https://api.ebay.com/buy/browse/v1/... with the same headers.
    // Leave blank: the Android app calls eBay directly, and the web app shows eBay as a link only.
    proxyBase: "",
    statsPerSearch: 5,        // marketplace/stats calls per search (Discogs allows ~25/min without a token)
    cacheTtlMs: 60 * 60 * 1000,
    cacheMax: 300
  };

  // ---------- errors ----------
  function DataError(kind, message, extra) {
    var e = new Error(message); e.kind = kind; // kind: offline | rate | network | http | auth
    if (extra) for (var k in extra) e[k] = extra[k];
    return e;
  }
  function friendly(e) {
    if (!e) return "Something went wrong.";
    if (e.kind === "offline") return "You're offline. Prices need a connection; the shop links below will open when you're back online.";
    if (e.kind === "rate") return "Discogs is asking us to slow down. Try again in " + (e.retryAfter || 60) + " seconds.";
    if (e.kind === "auth") return "Discogs didn't accept your token. Check it in Settings, or clear it to search without one.";
    if (e.kind === "network") return "Couldn't reach Discogs just now. It may be busy; try again in a minute.";
    return "Discogs returned an error (" + (e.status || e.message) + "). Try again shortly.";
  }

  // ---------- transport ----------
  function cap() { return root.Capacitor; }
  function isNative() { var C = cap(); return !!(C && C.isNativePlatform && C.isNativePlatform()); }
  function nativeHttp() { var C = cap(); return isNative() && C.Plugins && C.Plugins.CapacitorHttp; }
  function online() { return !(root.navigator && root.navigator.onLine === false); }
  function fetchFn() { return root.fetch || (typeof globalThis !== "undefined" && globalThis.fetch); }

  function retryAfterOf(v) { var n = parseInt(v, 10); return isFinite(n) && n > 0 ? Math.min(n, 300) : 60; }

  // Returns parsed JSON. Native: CapacitorHttp (no CORS, real User-Agent). Web: fetch.
  function getJSON(url, headers) {
    headers = headers || {};
    if (!online()) return Promise.reject(DataError("offline", "offline"));
    var http = nativeHttp();
    if (http) {
      var h = {}; for (var k in headers) h[k] = headers[k];
      h["User-Agent"] = config.userAgent;
      return http.get({ url: url, headers: h }).then(function (res) {
        return handle(res.status, function (name) { var hs = res.headers || {}; for (var k in hs) if (k.toLowerCase() === name) return hs[k]; return null; },
          function () { return typeof res.data === "string" ? JSON.parse(res.data) : res.data; });
      }, function (err) { throw online() ? DataError("network", String(err && err.message || err)) : DataError("offline", "offline"); });
    }
    var f = fetchFn();
    return f(url, { headers: headers }).then(function (res) {
      return handle(res.status, function (name) { return res.headers && res.headers.get ? res.headers.get(name) : null; }, function () { return res.json(); });
    }, function (err) {
      // A failed fetch (TypeError) is either no connection or a blocked/busy response without CORS headers.
      throw online() ? DataError("network", String(err && err.message || err)) : DataError("offline", "offline");
    });
  }
  function handle(status, header, body) {
    if (status === 429) throw DataError("rate", "HTTP 429", { status: 429, retryAfter: retryAfterOf(header("retry-after")) });
    if (status === 401 || status === 403) throw DataError("auth", "HTTP " + status, { status: status });
    if (status >= 400) throw DataError("http", "HTTP " + status, { status: status });
    return body();
  }

  // ---------- cache (memory + localStorage, 1h) ----------
  var CKEY = "binraider.cache.v2";
  var mem = null;
  function ls() { try { return root.localStorage || null; } catch (e) { return null; } }
  function cacheLoad() {
    if (mem) return mem;
    mem = {};
    var s = ls(); if (!s) return mem;
    try { mem = JSON.parse(s.getItem(CKEY) || "{}") || {}; } catch (e) { mem = {}; }
    return mem;
  }
  function cacheSave() {
    var s = ls(); if (!s) return;
    var now = Date.now(), keys = Object.keys(mem).filter(function (k) { return now - mem[k].t < config.cacheTtlMs; });
    keys.sort(function (a, b) { return mem[b].t - mem[a].t; });
    var keep = {}; keys.slice(0, config.cacheMax).forEach(function (k) { keep[k] = 1; });
    Object.keys(mem).forEach(function (k) { if (!keep[k]) delete mem[k]; }); // prune in place: callers hold this object
    try { s.setItem(CKEY, JSON.stringify(mem)); } catch (e) { /* quota: memory cache still works */ }
  }
  function cached(key, fn) {
    var c = cacheLoad(), hit = c[key];
    if (hit && Date.now() - hit.t < config.cacheTtlMs) return Promise.resolve(hit.v);
    return fn().then(function (v) { c[key] = { t: Date.now(), v: v }; cacheSave(); return v; });
  }
  function clearCache() { if (mem) Object.keys(mem).forEach(function (k) { delete mem[k]; }); var s = ls(); if (s) try { s.removeItem(CKEY); } catch (e) {} }

  // ---------- Discogs rate limiter: rolling 60s window, waits rather than hitting 429 ----------
  var stamps = [];
  var limiterNow = function () { return Date.now(); };
  function throttle(authed) {
    var cap = authed ? 55 : 22, now = limiterNow();
    stamps = stamps.filter(function (t) { return now - t < 60000; });
    if (stamps.length < cap) { stamps.push(now); return Promise.resolve(0); }
    var wait = 60000 - (now - stamps[0]) + 50;
    return new Promise(function (res) { setTimeout(function () { res(throttle(authed)); }, wait); });
  }

  function discogsHeaders(token) {
    var h = {};
    if (token) h["Authorization"] = "Discogs token=" + token;
    return h;
  }
  function discogsGet(path, token) {
    var url = config.discogsBase + path;
    return cached((token ? "a:" : "p:") + url, function () {
      return throttle(!!token).then(function () { return getJSON(url, discogsHeaders(token)); });
    });
  }

  // ---------- Discogs parsing ----------
  function splitTitle(t) {
    var i = String(t || "").indexOf(" - ");
    return i > 0 ? { artist: t.slice(0, i), album: t.slice(i + 3) } : { artist: "", album: String(t || "") };
  }
  function formatText(r) {
    var f = (r.formats && r.formats[0]) || null;
    var bits = [];
    if (f) {
      if (f.qty && Number(f.qty) > 1) bits.push(f.qty + "×" + (f.name || "Vinyl"));
      (f.descriptions || []).forEach(function (d) { if (bits.indexOf(d) < 0) bits.push(d); });
      if (f.text) bits.push(f.text);
    } else (r.format || []).forEach(function (d) { if (d !== "Vinyl") bits.push(d); });
    return bits.join(", ");
  }
  function parseRelease(r) {
    var t = splitTitle(r.title);
    var img = r.thumb || r.cover_image || "";
    if (/spacer\.gif$/.test(img)) img = "";
    return {
      id: r.id, title: r.title, artist: t.artist, album: t.album,
      year: r.year || "", country: r.country || "", label: (r.label && r.label[0]) || "", catno: r.catno || "",
      format: formatText(r), thumb: img,
      have: r.community ? r.community.have : null, want: r.community ? r.community.want : null,
      url: "https://www.discogs.com/release/" + r.id,
      marketUrl: "https://www.discogs.com/sell/release/" + r.id + "?currency=GBP",
      lowest: null, currency: null, forSale: null, suggestedVgPlus: null
    };
  }
  function applyStats(p, stats) {
    if (!stats) return p;
    if (stats.lowest_price && stats.lowest_price.value != null) { p.lowest = Math.round(stats.lowest_price.value * 100) / 100; p.currency = stats.lowest_price.currency || "GBP"; }
    if (stats.num_for_sale != null) p.forSale = stats.num_for_sale;
    return p;
  }
  function applySuggestion(p, sug) {
    var v = sug && sug["Very Good Plus (VG+)"];
    if (v && v.value != null) p.suggestedVgPlus = { value: Math.round(v.value * 100) / 100, currency: v.currency || "GBP" };
    return p;
  }

  // Run promise-returning tasks with limited concurrency, keeping order.
  function pool(items, limit, fn) {
    var out = new Array(items.length), i = 0;
    function next() { if (i >= items.length) return Promise.resolve(); var k = i++; return fn(items[k], k).then(function (v) { out[k] = v; return next(); }); }
    var runners = []; for (var n = 0; n < Math.min(limit, items.length); n++) runners.push(next());
    return Promise.all(runners).then(function () { return out; });
  }

  function discogsSearch(query, token) {
    var path = "/database/search?type=release&format=Vinyl&per_page=10&q=" + encodeURIComponent(query);
    return discogsGet(path, token).then(function (d) {
      var all = ((d && d.results) || []).filter(function (r) { return r && r.id && r.type !== "master"; });
      var total = d && d.pagination ? d.pagination.items : all.length;
      var top = all.slice(0, config.statsPerSearch).map(parseRelease);
      return pool(top, 2, function (p) {
        var jobs = [discogsGet("/marketplace/stats/" + p.id + "?curr_abbr=GBP", token).then(function (s) { applyStats(p, s); }, function (e) { if (e.kind === "rate" || e.kind === "offline") throw e; p.statsError = true; })];
        if (token) jobs.push(discogsGet("/marketplace/price_suggestions/" + p.id, token).then(function (s) { applySuggestion(p, s); }, function (e) { if (e.kind === "rate" || e.kind === "offline") throw e; }));
        return Promise.all(jobs).then(function () { return p; });
      }).then(function (pressings) { return { pressings: pressings, totalPressings: total }; });
    });
  }

  // ---------- eBay Browse ----------
  function ebayAvailable(keys) { return !!(keys && keys.ebayToken) && (isNative() || !!config.proxyBase); }
  function ebayListings(query, token, opts) {
    var filters = ["deliveryCountry:GB", "priceCurrency:GBP"];
    if (opts && opts.uk) filters.push("itemLocationCountry:GB");
    if (opts && opts.max) filters.push("price:[.." + Math.floor(opts.max) + "]");
    var base = isNative() ? config.ebayBase : config.proxyBase.replace(/\/$/, "");
    var url = base + "/buy/browse/v1/item_summary/search?category_ids=176985&limit=20&sort=price&q=" +
      encodeURIComponent(query) + "&filter=" + encodeURIComponent(filters.join(","));
    var h = { "Authorization": "Bearer " + token, "X-EBAY-C-MARKETPLACE-ID": "EBAY_GB", "X-EBAY-C-ENDUSERCTX": "contextualLocation=country%3DGB" };
    return getJSON(url, h).then(function (d) { return parseEbay(d, opts && opts.aff); });
  }
  function parseEbay(d, aff) {
    var items = (d && d.itemSummaries) || [];
    return items.map(function (it) {
      var price = it.price ? parseFloat(it.price.value) : NaN;
      var ship = it.shippingOptions && it.shippingOptions[0] && it.shippingOptions[0].shippingCost ? parseFloat(it.shippingOptions[0].shippingCost.value) : null;
      return {
        id: it.itemId, source: "eBay UK", title: it.title, conditionText: it.condition || "",
        price: price, postage: ship, postageKnown: ship != null, thumb: it.image && it.image.imageUrl,
        location: it.itemLocation ? (it.itemLocation.city || it.itemLocation.country || "") : "",
        url: Sites.affiliate(it.itemAffiliateWebUrl || it.itemWebUrl, aff)
      };
    }).filter(function (x) { return isFinite(x.price); });
  }

  // ---------- search ----------
  // opts: { keys: {discogsToken, ebayToken}, aff, uk, max }
  function search(query, opts) {
    opts = opts || {};
    var q = String(query || "").trim();
    var keys = opts.keys || {};
    var notes = [];
    var pDiscogs = discogsSearch(q, keys.discogsToken);
    var pEbay = Promise.resolve(null);
    if (ebayAvailable(keys)) pEbay = ebayListings(q, keys.ebayToken, opts).catch(function (e) { notes.push("eBay: " + (e.kind === "auth" ? "token expired or invalid; add a fresh one in Settings." : "couldn't load (" + (e.status || e.kind) + ").")); return []; });
    else if (keys.ebayToken) notes.push("eBay live prices work in the Android app. On the web, tap eBay below to search it now.");
    return Promise.all([pDiscogs, pEbay]).then(function (r) {
      var d = r[0], ebay = r[1];
      var pressings = d.pressings.slice().sort(function (a, b) {
        var x = a.lowest == null ? Infinity : a.lowest, y = b.lowest == null ? Infinity : b.lowest;
        return x - y;
      });
      pressings.forEach(function (p) {
        p.reference = p.suggestedVgPlus ? p.suggestedVgPlus.value : null;
        if (p.lowest != null && p.reference) {
          var ev = Deal.evaluate({ price: p.lowest, postage: 0, reference: p.reference, grade: "VG+" });
          p.score = ev.score; p.verdict = ev.verdict;
        } else { p.score = null; p.verdict = Deal.verdict(null); }
      });
      var priced = pressings.filter(function (p) { return p.lowest != null; });
      var forSale = pressings.reduce(function (s, p) { return s + (p.forSale || 0); }, 0);
      var refs = pressings.filter(function (p) { return p.reference; });
      if (ebay) ebay.forEach(function (l) {
        l.total = Math.round((l.price + (l.postage || 0)) * 100) / 100;
        var ref = refs.length ? refs[0].reference : null;
        var ev = Deal.evaluate({ price: l.price, postage: l.postage || 0, reference: ref, grade: "VG+" });
        l.score = ev.score; l.verdict = ev.verdict;
      });
      if (ebay) ebay.sort(function (a, b) { return a.total - b.total; });
      return {
        source: "discogs", query: q, authed: !!keys.discogsToken,
        pressings: pressings, totalPressings: d.totalPressings,
        cheapest: priced[0] || null, forSale: forSale,
        ebay: ebay, ebayStatus: ebay ? "live" : (keys.ebayToken ? "needs-app" : "soon"),
        notes: notes
      };
    });
  }

  var api = {
    config: config, search: search, getJSON: getJSON, friendly: friendly, clearCache: clearCache,
    parseRelease: parseRelease, applyStats: applyStats, applySuggestion: applySuggestion, parseEbay: parseEbay, formatText: formatText,
    _resetLimiter: function (nowFn) { stamps = []; if (nowFn) limiterNow = nowFn; }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.BRData = api;
})(typeof window !== "undefined" ? window : globalThis);
