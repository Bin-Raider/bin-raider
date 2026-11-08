/* Bin Raider - app shell. Everything is stored on the device (localStorage). */
(function () {
  "use strict";
  var Deal = window.BRDeal, Sites = window.BRSites, Data = window.BRData;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = "binraider.v1";

  // ---------- storage ----------
  var store = load();
  function load() {
    var d = { mode: "mock", keys: {}, aff: {}, premium: true, recent: [], want: [], filters: { uk: true, bin: false, vinyl: true, max: "", cond: "any" } };
    try { var s = JSON.parse(localStorage.getItem(KEY) || "{}"); for (var k in s) d[k] = s[k]; } catch (e) {}
    return d;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} }

  // ---------- helpers ----------
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var a in attrs) {
      if (a === "text") n.textContent = attrs[a];
      else if (a === "html") n.innerHTML = attrs[a];
      else if (a.slice(0, 2) === "on") n.addEventListener(a.slice(2), attrs[a]);
      else if (attrs[a] !== null && attrs[a] !== undefined && attrs[a] !== false) n.setAttribute(a, attrs[a]);
    }
    (kids || []).forEach(function (k) { if (k != null) n.appendChild(typeof k === "string" ? document.createTextNode(k) : k); });
    return n;
  }
  var gbp = Deal.gbp;
  var toastT;
  function toast(msg) { var t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, 2200); }

  function openExternal(url) {
    var C = window.Capacitor;
    if (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.Browser) { C.Plugins.Browser.open({ url: url }); return; }
    window.open(url, "_blank", "noopener");
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[data-ext]");
    if (!a) return;
    var C = window.Capacitor;
    if (C && C.isNativePlatform && C.isNativePlatform()) { e.preventDefault(); openExternal(a.href); }
  });

  function scoreBadge(s, v, locked) {
    if (locked) return el("span", { "class": "score locked", title: "Premium" }, [el("span", { "class": "n", text: "?" }), el("span", { "class": "v", text: "Premium" })]);
    return el("span", { "class": "score " + v.key }, [el("span", { "class": "n", text: s == null ? "–" : String(s) }), el("span", { "class": "v", text: v.label })]);
  }

  // ---------- tabs ----------
  function showTab(name) {
    document.querySelectorAll(".view").forEach(function (v) { v.classList.toggle("active", v.id === "view-" + name); });
    document.querySelectorAll(".tabs button").forEach(function (b) {
      var on = b.getAttribute("data-tab") === name; b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    window.scrollTo(0, 0);
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
  }
  document.querySelectorAll(".tabs button").forEach(function (b) { b.addEventListener("click", function () { showTab(b.getAttribute("data-tab")); }); });

  // ---------- mode chip ----------
  function renderMode() {
    var chip = $("modeChip"), live = store.mode === "live";
    chip.textContent = live ? "LIVE DATA" : "MOCK DATA";
    chip.className = "mode-chip " + (live ? "live" : "mock");
    $("modeHint").textContent = live ? "Live: prices come from the Discogs and eBay APIs using your keys." : "Mock data is made up so you can try the app. Switch to Live once you add your keys.";
  }

  // ---------- filters ----------
  function readFilters() {
    store.filters = { uk: $("fUk").checked, bin: $("fBin").checked, vinyl: $("fVinyl").checked, max: $("fMax").value, cond: $("fCond").value };
    save();
    return store.filters;
  }
  function writeFilters() {
    var f = store.filters; $("fUk").checked = !!f.uk; $("fBin").checked = !!f.bin; $("fVinyl").checked = f.vinyl !== false; $("fMax").value = f.max || ""; $("fCond").value = f.cond || "any";
  }

  // ---------- search ----------
  var last = null;
  function renderRecent() {
    var box = $("recent"); box.innerHTML = "";
    store.recent.forEach(function (t) { box.appendChild(el("button", { type: "button", text: t, onclick: function () { $("q").value = t; dig(t); } })); });
  }

  function dig(q) {
    q = String(q || "").trim();
    if (!q) return;
    var f = readFilters();
    store.recent = [q].concat(store.recent.filter(function (t) { return t.toLowerCase() !== q.toLowerCase(); })).slice(0, 6);
    save(); renderRecent();
    $("empty").hidden = true; $("results").hidden = false;
    $("snapshot").innerHTML = ""; $("snapshot").appendChild(el("div", { "class": "spinner", text: "Digging…" }));
    $("listings").innerHTML = ""; $("trendCard").hidden = true;
    renderLinks(q, f);
    Data.search(q, { mode: store.mode, keys: store.keys, aff: store.aff, uk: f.uk, max: f.max ? Number(f.max) : null }).then(function (res) {
      last = res; renderSnapshot(res); renderListings(res); renderTrend(res);
    }).catch(function (e) {
      $("snapshot").innerHTML = ""; $("snapshot").appendChild(el("div", { "class": "notes", text: "Couldn't get prices: " + e.message + ". The links below still work." }));
    });
  }

  function renderSnapshot(res) {
    var box = $("snapshot"); box.innerHTML = "";
    var best = res.listings[0];
    if (res.mode === "mock") box.appendChild(el("div", { "class": "mock-banner", text: "MOCK DATA: made-up prices for testing. Use the links below for real ones." }));
    box.appendChild(el("div", null, [
      el("div", { "class": "label", text: best ? "Best total found" : "No listings found" }),
      el("div", { "class": "big", text: best ? gbp(best.total) : "–" }),
      best ? el("div", { "class": "price", text: best.source + " · " + (best.grade || best.conditionText || "") + (best.postageKnown === false ? " · postage not shown" : " · incl. " + gbp(best.postage) + " postage") }) : null
    ]));
    box.appendChild(best ? scoreBadge(best.score, best.verdict, !store.premium) : el("span"));
    if (res.reference) box.appendChild(el("div", { "class": "ref", text: "Typical " + res.reference.grade + " price: " + gbp(res.reference.price) + " (" + res.reference.source + ")" + (res.reference.forSale != null ? " · " + res.reference.forSale + " for sale on Discogs" : "") }));
    else box.appendChild(el("div", { "class": "ref", text: "No reference price yet, so no deal scores. Check sold prices below." }));
    (res.notes || []).filter(function (n) { return res.mode !== "mock"; }).forEach(function (n) { box.appendChild(el("div", { "class": "notes", text: n })); });
  }

  function renderListings(res) {
    var ol = $("listings"); ol.innerHTML = "";
    $("listTitle").textContent = res.listings.length ? "Cheapest copies" + (res.mode === "mock" ? " (mock)" : "") : "No live listings";
    res.listings.slice(0, 8).forEach(function (l) {
      var showScore = store.premium || l === res.listings[0];
      ol.appendChild(el("li", { "class": "listing" }, [
        el("div", null, [
          el("span", { "class": "src", text: l.source }), el("span", { "class": "grade", text: l.grade ? l.grade : l.conditionText }),
          el("div", { "class": "title", text: l.title }),
          el("div", { "class": "price", html: "<b>" + gbp(l.total) + "</b> = " + gbp(l.price) + " + " + (l.postageKnown === false ? "postage ?" : gbp(l.postage) + " postage") + (l.location ? " · " + escapeHtml(l.location) : "") })
        ]),
        scoreBadge(l.score, l.verdict, !showScore),
        el("div", { "class": "actions" }, [
          el("a", { "class": "btn small primary", href: l.url, target: "_blank", rel: "noopener", "data-ext": "1", text: l.mock ? "Search " + l.source : "Open" }),
          el("button", { "class": "btn small", type: "button", text: "Check deal", onclick: function () { prefillCalc(l.price, l.postage, l.grade || "VG+", res.reference && res.reference.price); } }),
          el("button", { "class": "btn small", type: "button", text: "Want", onclick: function () { addWant(res.query, Math.floor(l.total * 0.9), res.reference && res.reference.price); } })
        ])
      ]));
    });
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function renderTrend(res) {
    var card = $("trendCard");
    if (!res.history || !res.history.length) { card.hidden = true; return; }
    card.hidden = false; card.innerHTML = "";
    card.appendChild(el("h3", null, ["Sold price, last 12 months ", el("span", { "class": "premium-tag", text: "Premium" })]));
    if (!store.premium) { card.appendChild(el("p", { "class": "hint", text: "Price history is part of Premium. Turn on the preview in Settings to try it." })); return; }
    var h = res.history, min = Math.min.apply(null, h), max = Math.max.apply(null, h), W = 300, H = 80, pad = 6;
    var pts = h.map(function (v, i) { return [pad + i * (W - 2 * pad) / (h.length - 1), H - pad - (max === min ? 0.5 : (v - min) / (max - min)) * (H - 2 * pad)]; });
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
    card.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="Price trend"><path d="' + d + ' L' + (W - pad) + " " + H + " L" + pad + " " + H + ' Z" fill="#FF5B14" fill-opacity=".15"/><path d="' + d + '" fill="none" stroke="#FF5B14" stroke-width="3" stroke-linejoin="round"/></svg>');
    card.appendChild(el("div", { "class": "axis" }, [el("span", { text: "12 months ago" }), el("span", { text: "Low " + gbp(min) + " · High " + gbp(max) }), el("span", { text: "Now" })]));
    if (res.mode === "mock") card.appendChild(el("p", { "class": "hint tight", text: "Mock history." }));
  }

  function renderLinks(q, f) {
    var all = Sites.links({ q: q, uk: f.uk, max: f.max, cond: f.cond, bin: f.bin, addVinyl: f.vinyl }, store.aff);
    var box = $("linkGroups"); box.innerHTML = "";
    Sites.GROUPS.forEach(function (g) {
      var grid = el("div", { "class": "link-grid" });
      all.filter(function (l) { return l.group === g.id; }).forEach(function (l) {
        grid.appendChild(el("a", { "class": "site-link", href: l.url, target: "_blank", rel: "noopener", "data-ext": "1", "data-site": l.key }, [el("b", { text: l.name }), el("span", { text: l.note })]));
      });
      box.appendChild(el("div", { "class": "group" }, [el("h4", { text: g.title }), grid]));
    });
  }

  $("searchForm").addEventListener("submit", function (e) { e.preventDefault(); $("q").blur(); dig($("q").value); });
  ["fUk", "fBin", "fVinyl", "fMax", "fCond"].forEach(function (id) { $(id).addEventListener("change", function () { readFilters(); if ($("q").value.trim() && !$("results").hidden) renderLinks($("q").value.trim(), store.filters); }); });

  // ---------- wantlist ----------
  function addWant(q, target, ref) {
    q = String(q || "").trim(); if (!q) return;
    var existing = store.want.filter(function (w) { return w.q.toLowerCase() === q.toLowerCase(); })[0];
    if (existing) { existing.target = target; if (ref) existing.ref = ref; }
    else store.want.unshift({ id: Date.now().toString(36), q: q, target: Number(target) || 0, ref: ref || null, best: null, checked: null });
    save(); renderWant(); toast("Added to wantlist, target " + gbp(Number(target)));
  }
  function renderWant() {
    var ul = $("wantlist"); ul.innerHTML = "";
    $("wantEmpty").hidden = store.want.length > 0;
    $("checkAll").disabled = !store.want.length;
    store.want.forEach(function (w) {
      var hit = w.best != null && w.best <= w.target;
      ul.appendChild(el("li", { "class": "want" + (hit ? " hit" : "") }, [
        el("div", null, [
          el("div", { "class": "q", text: w.q }),
          el("div", { "class": "meta", text: "Target " + gbp(w.target) + (w.ref ? " · typical " + gbp(w.ref) : "") + (w.best != null ? " · best now " + gbp(w.best) + (w.mock ? " (mock)" : "") : "") })
        ]),
        el("button", { "class": "btn small", type: "button", "aria-label": "Remove " + w.q, text: "Remove", onclick: function () { store.want = store.want.filter(function (x) { return x.id !== w.id; }); save(); renderWant(); } }),
        hit ? el("div", { "class": "flag", text: "Below your target: " + gbp(w.best) + " incl. postage" }) : null,
        el("div", { "class": "actions" }, [
          el("button", { "class": "btn small primary", type: "button", text: "Dig", onclick: function () { $("q").value = w.q; showTab("dig"); dig(w.q); } }),
          el("button", { "class": "btn small", type: "button", text: "Edit target", onclick: function () { var t = prompt("Target price in £ for " + w.q, w.target); if (t !== null && isFinite(parseFloat(t))) { w.target = parseFloat(t); save(); renderWant(); } } })
        ])
      ]));
    });
  }
  $("wantForm").addEventListener("submit", function (e) { e.preventDefault(); addWant($("wQ").value, parseFloat($("wT").value), null); $("wQ").value = ""; $("wT").value = ""; });
  $("checkAll").addEventListener("click", function () {
    var btn = $("checkAll"); btn.disabled = true; btn.textContent = "Checking…";
    Promise.all(store.want.map(function (w) {
      return Data.search(w.q, { mode: store.mode, keys: store.keys, aff: store.aff, uk: store.filters.uk }).then(function (res) {
        w.best = res.listings[0] ? res.listings[0].total : null; w.mock = res.mode === "mock"; w.checked = Date.now();
        if (res.reference && res.reference.price) w.ref = res.reference.price;
      }).catch(function () {});
    })).then(function () {
      save(); renderWant(); btn.textContent = "Check prices"; btn.disabled = false;
      var hits = store.want.filter(function (w) { return w.best != null && w.best <= w.target; }).length;
      toast(hits ? hits + " below target" : "Nothing below target yet");
    });
  });

  // ---------- calculator ----------
  Deal.GRADES.forEach(function (g) { $("cGrade").appendChild(el("option", { value: g.id, text: g.label })); });
  $("cGrade").value = "VG+";
  function calc() {
    var r = Deal.evaluate({ price: $("cPrice").value, postage: $("cPost").value, reference: $("cRef").value, grade: $("cGrade").value });
    var out = $("calcOut"); out.innerHTML = "";
    if (!r.ok || $("cPrice").value === "") { out.appendChild(el("div", { "class": "line", text: "Enter the asking price to see the total and score." })); return; }
    out.appendChild(el("div", null, [el("div", { "class": "hint tight", text: "Total with postage" }), el("div", { "class": "big", text: gbp(r.total) })]));
    out.appendChild(scoreBadge(r.score, r.verdict, false));
    if (r.adjustedReference) {
      var meter = el("div", { "class": "meter" }); meter.appendChild(el("i", { style: "left:" + r.score + "%" })); out.appendChild(meter);
      out.appendChild(el("div", { "class": "line", text: (r.diff <= 0 ? gbp(-r.diff) + " (" + Math.abs(r.pct) + "%) under" : gbp(r.diff) + " (" + r.pct + "%) over") + " the usual " + gbp(r.adjustedReference) + " for a " + $("cGrade").value + " copy." }));
      out.appendChild(el("div", { "class": "line", text: "Good deal at " + gbp(r.goodDealBelow) + " or less, postage included." }));
    } else out.appendChild(el("div", { "class": "line", text: "Add a reference price to get a deal score." }));
  }
  ["cPrice", "cPost", "cRef", "cGrade"].forEach(function (id) { $(id).addEventListener("input", calc); $(id).addEventListener("change", calc); });
  $("calcForm").addEventListener("submit", function (e) { e.preventDefault(); });
  function prefillCalc(price, post, grade, ref) {
    $("cPrice").value = price != null ? price.toFixed(2) : ""; $("cPost").value = post != null ? Number(post).toFixed(2) : "";
    $("cGrade").value = grade || "VG+"; $("cRef").value = ref ? ref.toFixed(2) : ""; calc(); showTab("calc");
  }

  // ---------- settings ----------
  function writeSettings() {
    document.querySelectorAll('input[name="mode"]').forEach(function (r) { r.checked = r.value === store.mode; });
    $("kDiscogs").value = store.keys.discogsToken || ""; $("kEbay").value = store.keys.ebayToken || "";
    $("aEpn").value = store.aff.epnCampaign || ""; $("aAmz").value = store.aff.amazonTag || ""; $("premium").checked = !!store.premium;
  }
  document.querySelectorAll('input[name="mode"]').forEach(function (r) {
    r.addEventListener("change", function () {
      store.mode = r.value; save(); renderMode();
      if (r.value === "live" && !store.keys.discogsToken && !store.keys.ebayToken) toast("Live needs a Discogs or eBay key");
    });
  });
  $("kDiscogs").addEventListener("change", function () { store.keys.discogsToken = this.value.trim(); save(); });
  $("kEbay").addEventListener("change", function () { store.keys.ebayToken = this.value.trim(); save(); });
  $("aEpn").addEventListener("change", function () { store.aff.epnCampaign = this.value.trim(); save(); });
  $("aAmz").addEventListener("change", function () { store.aff.amazonTag = this.value.trim(); save(); });
  $("premium").addEventListener("change", function () { store.premium = this.checked; save(); if (last) { renderSnapshot(last); renderListings(last); renderTrend(last); } });
  $("wipe").addEventListener("click", function () {
    if (!confirm("Clear your wantlist, recent searches and keys from this phone?")) return;
    localStorage.removeItem(KEY); store = load(); writeSettings(); writeFilters(); renderMode(); renderRecent(); renderWant(); toast("Cleared");
  });

  // ---------- boot ----------
  writeFilters(); writeSettings(); renderMode(); renderRecent(); renderWant(); calc();
  var start = (location.hash || "").slice(1);
  if (["dig", "want", "calc", "set"].indexOf(start) >= 0) showTab(start);
  var qp = new URLSearchParams(location.search).get("q");
  if (qp) { $("q").value = qp; dig(qp); }

  if ("serviceWorker" in navigator && location.protocol === "https:" && !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
  window.BinRaider = { dig: dig, addWant: addWant, prefillCalc: prefillCalc, store: function () { return store; } };
})();
