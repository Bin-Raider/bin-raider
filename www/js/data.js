/* Bin Raider - price data layer.
   MOCK mode (default): made-up, repeatable prices so the app can be tried without API keys.
   LIVE mode: official APIs only - Discogs API (reference prices) and eBay Browse API (live listings).
   Never scrapes. Vinted and Facebook have no public API, so they stay as links. */
(function (root) {
  var Deal = root.BRDeal || (typeof require !== "undefined" ? require("./deal.js") : null);
  var Sites = root.BRSites || (typeof require !== "undefined" ? require("./sites.js") : null);

  // ---------- MOCK ----------
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    return function () { seed = (Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x6D2B79F5) >>> 0; return (seed % 100000) / 100000; };
  }
  var PRESSINGS = ["LP, original UK pressing", "LP, 2016 reissue", "LP, 180g remaster", "LP, 1980s repress", "2xLP, deluxe edition", "LP, coloured vinyl", "LP, EU pressing", "LP, ex-library copy"];
  var GRADE_IDS = ["NM", "VG+", "VG+", "VG", "VG", "G+", "M"];

  function mockSearch(query, opts) {
    var q = String(query || "").trim();
    var r = rng(hash(q.toLowerCase()) || 1);
    var ref = Math.round((9 + r() * 38) * 100) / 100; // typical VG+ price
    var links = Sites.links({ q: q, uk: opts && opts.uk, addVinyl: true }, opts && opts.aff);
    var linkFor = function (key) { for (var i = 0; i < links.length; i++) if (links[i].key === key) return links[i].url; return ""; };
    var listings = [];
    var n = 8;
    for (var i = 0; i < n; i++) {
      var source = i < 6 ? "eBay UK" : "Discogs";
      var grade = GRADE_IDS[Math.floor(r() * GRADE_IDS.length)];
      var fair = ref * Deal.gradeMult(grade);
      var price = Math.max(2, Math.round(fair * (0.55 + r() * 0.85) * 100) / 100);
      var postage = [0, 2.99, 3.5, 3.95, 4.5, 5.99][Math.floor(r() * 6)];
      var ev = Deal.evaluate({ price: price, postage: postage, reference: ref, grade: grade });
      listings.push({
        id: "mock-" + i,
        source: source,
        title: q + " - " + PRESSINGS[Math.floor(r() * PRESSINGS.length)],
        grade: grade,
        price: price,
        postage: postage,
        total: ev.total,
        score: ev.score,
        verdict: ev.verdict,
        location: ["London", "Manchester", "Bristol", "Leeds", "Glasgow", "Reading", "Brighton", "Cardiff"][Math.floor(r() * 8)],
        url: source === "Discogs" ? linkFor("discogs") : linkFor("ebay"),
        mock: true
      });
    }
    listings.sort(function (a, b) { return a.total - b.total; });
    var history = [];
    var base = ref * (0.8 + r() * 0.3);
    for (var m = 11; m >= 0; m--) { base = base * (0.93 + r() * 0.15); history.push(Math.round(base * 100) / 100); }
    history[11] = ref;
    return Promise.resolve({
      mode: "mock",
      query: q,
      reference: { price: ref, grade: "VG+", source: "Mock median sold price" },
      listings: listings,
      history: history,
      notes: ["Mock data: prices are made up and repeat for the same search."]
    });
  }

  // ---------- LIVE ----------
  function isNative() { return !!(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform()); }

  // In the Android app, CapacitorHttp makes the request natively (no browser CORS limits).
  function getJSON(url, headers) {
    if (isNative() && root.Capacitor.Plugins && root.Capacitor.Plugins.CapacitorHttp) {
      return root.Capacitor.Plugins.CapacitorHttp.get({ url: url, headers: headers || {} }).then(function (res) {
        if (res.status >= 400) throw new Error("HTTP " + res.status);
        return typeof res.data === "string" ? JSON.parse(res.data) : res.data;
      });
    }
    return fetch(url, { headers: headers || {} }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  var DISCOGS = "https://api.discogs.com";
  // Discogs: find the release, then its VG+ price suggestion and marketplace stats.
  function discogsReference(query, token) {
    var h = { "Authorization": "Discogs token=" + token };
    return getJSON(DISCOGS + "/database/search?type=release&format=Vinyl&per_page=5&q=" + encodeURIComponent(query), h)
      .then(function (d) {
        var rel = d && d.results && d.results[0];
        if (!rel) return null;
        return Promise.all([
          getJSON(DISCOGS + "/marketplace/price_suggestions/" + rel.id, h).catch(function () { return null; }),
          getJSON(DISCOGS + "/marketplace/stats/" + rel.id + "?curr_abbr=GBP", h).catch(function () { return null; })
        ]).then(function (r) { return parseDiscogs(rel, r[0], r[1]); });
      });
  }

  function parseDiscogs(rel, suggestions, stats) {
    var vgp = suggestions && suggestions["Very Good Plus (VG+)"];
    var out = { releaseId: rel.id, title: rel.title, year: rel.year, country: rel.country, thumb: rel.thumb, price: null, currency: null, lowest: null, forSale: null };
    if (vgp && vgp.value) { out.price = Math.round(vgp.value * 100) / 100; out.currency = vgp.currency; }
    if (stats) {
      if (stats.lowest_price && stats.lowest_price.value != null) out.lowest = stats.lowest_price.value;
      if (stats.num_for_sale != null) out.forSale = stats.num_for_sale;
    }
    return out;
  }

  // eBay Browse API item_summary/search on the UK marketplace, Records category.
  // Needs an OAuth application token. The Play build should mint it on a small server so the client secret never ships in the app.
  function ebayListings(query, token, opts) {
    var filters = ["deliveryCountry:GB", "priceCurrency:GBP"];
    if (opts && opts.uk) filters.push("itemLocationCountry:GB");
    if (opts && opts.max) filters.push("price:[.." + Math.floor(opts.max) + "]");
    var url = "https://api.ebay.com/buy/browse/v1/item_summary/search?category_ids=176985&limit=20&sort=price&q=" +
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
        id: it.itemId, source: "eBay UK", title: it.title, grade: null, conditionText: it.condition || "",
        price: price, postage: ship, postageKnown: ship != null, image: it.image && it.image.imageUrl,
        location: it.itemLocation ? (it.itemLocation.city || it.itemLocation.country || "") : "",
        url: Sites.affiliate(it.itemAffiliateWebUrl || it.itemWebUrl, aff), mock: false
      };
    }).filter(function (x) { return isFinite(x.price); });
  }

  function liveSearch(query, opts) {
    opts = opts || {};
    var keys = opts.keys || {};
    var notes = [];
    var pRef = keys.discogsToken ? discogsReference(query, keys.discogsToken).catch(function (e) { notes.push("Discogs: " + e.message); return null; }) : Promise.resolve(null);
    var pEbay = keys.ebayToken ? ebayListings(query, keys.ebayToken, opts).catch(function (e) { notes.push("eBay: " + e.message + (isNative() ? "" : " (the browser may block this call; it works in the Android app)")); return []; }) : Promise.resolve([]);
    if (!keys.discogsToken) notes.push("Add a Discogs token in Settings for reference prices.");
    if (!keys.ebayToken) notes.push("Add an eBay token in Settings for live listings.");
    return Promise.all([pRef, pEbay]).then(function (r) {
      var ref = r[0], listings = r[1];
      var refPrice = ref && ref.price;
      listings.forEach(function (l) {
        l.total = Math.round((l.price + (l.postage || 0)) * 100) / 100;
        var ev = Deal.evaluate({ price: l.price, postage: l.postage || 0, reference: refPrice, grade: "VG+" });
        l.score = ev.score; l.verdict = ev.verdict;
      });
      listings.sort(function (a, b) { return a.total - b.total; });
      return {
        mode: "live", query: query,
        reference: refPrice ? { price: refPrice, grade: "VG+", source: "Discogs price suggestion" + (ref.title ? " for " + ref.title : ""), lowest: ref.lowest, forSale: ref.forSale, releaseId: ref.releaseId } : null,
        listings: listings, history: null, notes: notes
      };
    });
  }

  function search(query, opts) {
    return (opts && opts.mode === "live") ? liveSearch(query, opts) : mockSearch(query, opts);
  }

  var api = { search: search, mockSearch: mockSearch, liveSearch: liveSearch, parseEbay: parseEbay, parseDiscogs: parseDiscogs };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.BRData = api;
})(typeof window !== "undefined" ? window : this);
