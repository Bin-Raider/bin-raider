/* Bin Raider - app shell. Everything is stored on the device (localStorage). */
(function () {
  "use strict";
  var Deal = window.BRDeal, Sites = window.BRSites, Data = window.BRData;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = "binraider.v1";

  // ---------- storage ----------
  var store = load();
  function load() {
    var d = { keys: {}, aff: {}, premium: true, recent: [], want: [], filters: { uk: true, bin: false, vinyl: true, max: "", cond: "any" } };
    try { var s = JSON.parse(localStorage.getItem(KEY) || "{}"); for (var k in s) d[k] = s[k]; } catch (e) {}
    delete d.mode; // 0.1 had a mock/live switch; 0.2 is always live
    return d;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} }

  // ---------- helpers ----------
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var a in attrs) {
      if (a === "text") n.textContent = attrs[a];
      else if (a.slice(0, 2) === "on") n.addEventListener(a.slice(2), attrs[a]);
      else if (attrs[a] !== null && attrs[a] !== undefined && attrs[a] !== false) n.setAttribute(a, attrs[a]);
    }
    (kids || []).forEach(function (k) { if (k != null) n.appendChild(typeof k === "string" ? document.createTextNode(k) : k); });
    return n;
  }
  var gbp = Deal.gbp;
  var toastT;
  function toast(msg) { var t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, 2600); }
  function native() { var C = window.Capacitor; return !!(C && C.isNativePlatform && C.isNativePlatform()); }
  function openExternal(url) {
    var C = window.Capacitor;
    if (native() && C.Plugins && C.Plugins.Browser) { C.Plugins.Browser.open({ url: url }); return; }
    window.open(url, "_blank", "noopener");
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[data-ext]");
    if (a && native()) { e.preventDefault(); openExternal(a.href); }
  });
  function extLink(cls, href, text, extra) {
    var attrs = { "class": cls, href: href, target: "_blank", rel: "noopener", "data-ext": "1", text: text };
    if (extra) for (var k in extra) attrs[k] = extra[k];
    return el("a", attrs);
  }

  // price-gun sticker and rubber stamp
  function sticker(value, opts) {
    opts = opts || {};
    return el("span", { "class": "sticker" + (opts.big ? " big" : "") + (opts.muted ? " muted" : ""), "aria-label": opts.label || null }, [
      opts.top ? el("span", { "class": "st-top", text: opts.top }) : null,
      el("span", { "class": "st-val", text: value })
    ]);
  }
  function stamp(key, text, sub) {
    return el("span", { "class": "stamp " + key, role: "img", "aria-label": text + (sub ? ", score " + sub : "") }, [
      el("span", { "class": "sv", text: text }), sub != null ? el("span", { "class": "ss", text: sub }) : null
    ]);
  }
  function verdictStamp(score, v, locked) {
    if (locked) return stamp("locked", "Premium", null);
    if (score == null) return null;
    return stamp(v.key, v.label, String(score) + "/100");
  }

  // ---------- tabs ----------
  function showTab(name) {
    document.querySelectorAll(".view").forEach(function (v) { v.classList.toggle("active", v.id === "view-" + name); });
    document.querySelectorAll(".tabs button").forEach(function (b) {
      var on = b.getAttribute("data-tab") === name; b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    window.scrollTo(0, 0);
    if (location.hash !== "#" + name) history.replaceState(null, "", location.pathname + location.search + "#" + name);
  }
  document.querySelectorAll(".tabs button").forEach(function (b) { b.addEventListener("click", function () { showTab(b.getAttribute("data-tab")); }); });

  // ---------- source chip ----------
  function renderChip() {
    var chip = $("srcChip"), off = navigator.onLine === false;
    chip.lastChild.textContent = off ? "Offline" : "Live · Discogs";
    chip.classList.toggle("off", off);
  }
  window.addEventListener("online", renderChip); window.addEventListener("offline", renderChip);

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
  var last = null, digSeq = 0, retryTimer = null;
  function renderRecent() {
    var box = $("recent"); box.innerHTML = "";
    if (store.recent.length) box.appendChild(el("span", { "class": "recent-lbl", text: "Recent" }));
    store.recent.forEach(function (t) { box.appendChild(el("button", { type: "button", text: t, onclick: function () { $("q").value = t; dig(t); } })); });
  }

  function setStatus(kids, kind) {
    var s = $("status"); s.innerHTML = ""; s.className = "status" + (kind ? " " + kind : "");
    (kids || []).forEach(function (k) { if (k) s.appendChild(k); });
  }

  function dig(q) {
    q = String(q || "").trim();
    if (!q) return;
    var seq = ++digSeq; clearInterval(retryTimer);
    var f = readFilters();
    store.recent = [q].concat(store.recent.filter(function (t) { return t.toLowerCase() !== q.toLowerCase(); })).slice(0, 6);
    save(); renderRecent();
    $("empty").hidden = true; $("results").hidden = false;
    $("pick").innerHTML = ""; $("pressings").innerHTML = ""; $("crate").hidden = true; $("ebayBox").innerHTML = "";
    setStatus([el("span", { "class": "spin", "aria-hidden": "true" }), el("span", { text: "Digging through Discogs for " + q + "…" })], "loading");
    renderLinks(q, f);
    Data.search(q, { keys: store.keys, aff: store.aff, uk: f.uk, max: f.max ? Number(f.max) : null }).then(function (res) {
      if (seq !== digSeq) return;
      last = res; setStatus([]);
      renderPick(res); renderPressings(res); renderEbay(res);
    }).catch(function (e) {
      if (seq !== digSeq) return;
      showError(e, q);
    });
  }

  function showError(e, q) {
    var msg = Data.friendly(e);
    var btn = el("button", { "class": "btn small", type: "button", text: "Try again", onclick: function () { dig(q); } });
    setStatus([el("b", { "class": "err-k", text: e.kind === "offline" ? "Offline" : e.kind === "rate" ? "Slow down" : "No prices" }), el("p", { text: msg + " The shop links below still work." }), btn], "error");
    if (e.kind === "rate") {
      var left = e.retryAfter || 60; btn.disabled = true; btn.textContent = "Try again in " + left + "s";
      retryTimer = setInterval(function () { left--; if (left <= 0) { clearInterval(retryTimer); btn.disabled = false; btn.textContent = "Try again"; } else btn.textContent = "Try again in " + left + "s"; }, 1000);
    }
  }

  function sleeve(p) {
    var s = el("span", { "class": "sleeve" + (p.thumb ? " has-img" : ""), "aria-hidden": "true" });
    if (p.thumb) s.appendChild(el("img", { src: p.thumb, alt: "", loading: "lazy", referrerpolicy: "no-referrer", width: "60", height: "60" }));
    else s.appendChild(el("span", { "class": "disc" }));
    return s;
  }
  function metaLine(p) { return [p.year, p.country, p.label].filter(Boolean).join(" · "); }

  function renderPick(res) {
    var box = $("pick"); box.innerHTML = "";
    if (!res.pressings.length) {
      box.appendChild(el("div", { "class": "note-card" }, [el("b", { text: "No vinyl found on Discogs for “" + res.query + "”." }), el("p", { text: "Check the spelling, or try just the artist and album title. The shop links below search everywhere else." })]));
      return;
    }
    var c = res.cheapest;
    var card = el("div", { "class": "pick panel" });
    card.appendChild(el("p", { "class": "kicker", text: "The pick · cheapest pressing" }));
    if (!c) {
      card.appendChild(el("div", { "class": "pick-title", text: res.pressings[0].title }));
      card.appendChild(el("p", { "class": "meta", text: "No copies for sale on Discogs right now. Try the shop links below." }));
      box.appendChild(card); return;
    }
    var locked = false;
    var st = c.score != null ? verdictStamp(c.score, c.verdict, locked) : stamp("ink", "Lowest now", null);
    card.appendChild(el("div", { "class": "pick-row" }, [
      sticker(gbp(c.lowest), { big: true, top: "Lowest", label: "Lowest listed on Discogs now " + gbp(c.lowest) }),
      el("div", { "class": "pick-body" }, [
        el("div", { "class": "pick-title", text: c.album || c.title }),
        el("div", { "class": "pick-artist", text: c.artist }),
        el("div", { "class": "meta", text: [metaLine(c), c.format].filter(Boolean).join(" · ") })
      ])
    ]));
    card.appendChild(st);
    card.appendChild(el("p", { "class": "facts" }, [
      el("span", { text: "Lowest listed on Discogs now, plus postage" }),
      el("span", { text: c.forSale + " for sale" }),
      c.suggestedVgPlus ? el("span", { text: "Discogs suggested VG+ price " + gbp(c.suggestedVgPlus.value) }) : null
    ]));
    card.appendChild(el("div", { "class": "actions" }, [
      extLink("btn primary", c.marketUrl, "Buy on Discogs"),
      el("button", { "class": "btn", type: "button", text: "Check deal", onclick: function () { prefillCalc(c.lowest, null, "VG+", c.reference); } }),
      el("button", { "class": "btn", type: "button", text: "Want", onclick: function () { addWant(res.query, Math.floor(c.lowest * 0.9), c.reference); } })
    ]));
    if (!res.authed) card.appendChild(el("p", { "class": "hint tight", text: "No deal score without a reference price. Add a Discogs token in Settings for the Discogs suggested VG+ price, or set your own in Deal." }));
    box.appendChild(card);
  }

  function renderPressings(res) {
    var ol = $("pressings"); ol.innerHTML = "";
    if (!res.pressings.length) { $("crate").hidden = true; return; }
    $("crate").hidden = false;
    $("crateTitle").textContent = "Pressings";
    $("crateCount").textContent = res.forSale + " for sale";
    res.pressings.forEach(function (p, i) {
      var locked = !store.premium && i > 0 && p.score != null;
      ol.appendChild(el("li", { "class": "pressing" + (p.lowest == null ? " none" : "") }, [
        sleeve(p),
        el("div", { "class": "p-body" }, [
          extLink("p-title", p.url, p.album || p.title, { "aria-label": (p.title || "") + ", " + metaLine(p) + " on Discogs" }),
          el("div", { "class": "meta" }, [p.year ? el("b", { "class": "yr", text: p.year }) : null, [p.country, p.label].filter(Boolean).join(" · ")]),
        ]),
        p.lowest != null ? sticker(gbp(p.lowest), { top: "Lowest", label: "Lowest listed on Discogs now " + gbp(p.lowest) }) : sticker("None", { muted: true, label: "None for sale" }),
        p.format ? el("div", { "class": "fmt", text: p.format }) : null,
        el("div", { "class": "p-facts" }, [
          el("span", { text: p.lowest != null ? p.forSale + " for sale on Discogs" : (p.statsError ? "Price unavailable just now" : "None for sale on Discogs now") }),
          p.suggestedVgPlus ? el("span", { text: "Discogs suggested VG+ price " + gbp(p.suggestedVgPlus.value) }) : null,
          verdictStamp(p.score, p.verdict, locked)
        ]),
        el("div", { "class": "actions" }, [
          p.lowest != null ? extLink("btn small primary", p.marketUrl, "Buy") : extLink("btn small", p.url, "Release"),
          p.lowest != null ? el("button", { "class": "btn small", type: "button", text: "Check deal", onclick: function () { prefillCalc(p.lowest, null, "VG+", p.reference); } }) : null,
          el("button", { "class": "btn small", type: "button", text: "Want", onclick: function () { addWant(res.query, p.lowest != null ? Math.floor(p.lowest * 0.9) : 0, p.reference); } })
        ])
      ]));
    });
    var more = $("allPressings");
    if (res.totalPressings > res.pressings.length) {
      more.hidden = false; more.href = "https://www.discogs.com/search/?q=" + encodeURIComponent(res.query) + "&type=release&format_exact=Vinyl";
      more.textContent = "All " + res.totalPressings + " vinyl pressings on Discogs →";
    } else more.hidden = true;
  }

  function renderEbay(res) {
    var box = $("ebayBox"); box.innerHTML = "";
    if (res.ebay && res.ebay.length) {
      var ol = el("ol", { "class": "pressings ebay" });
      res.ebay.slice(0, 8).forEach(function (l) {
        ol.appendChild(el("li", { "class": "pressing" }, [
          sleeve(l),
          el("div", { "class": "p-body" }, [extLink("p-title", l.url, l.title), el("div", { "class": "meta", text: ["eBay UK", l.conditionText, l.location].filter(Boolean).join(" · ") })]),
          sticker(gbp(l.total), { label: "Total " + gbp(l.total) }),
          el("div", { "class": "p-facts" }, [el("span", { text: gbp(l.price) + " + " + (l.postageKnown ? gbp(l.postage) + " postage" : "postage not shown") }), verdictStamp(l.score, l.verdict, !store.premium)]),
          el("div", { "class": "actions" }, [extLink("btn small primary", l.url, "Open"), el("button", { "class": "btn small", type: "button", text: "Check deal", onclick: function () { prefillCalc(l.price, l.postage, "VG+", null); } })])
        ]));
      });
      box.appendChild(el("div", { "class": "crate" }, [el("div", { "class": "crate-head" }, [el("h3", { "class": "riso", text: "eBay UK" }), el("span", { "class": "mono-tag", text: "Live" })]), ol]));
      return;
    }
    var msg = res.ebayStatus === "needs-app" ? "eBay live prices work in the Android app. Tap eBay UK below to search it now." :
      res.ebayStatus === "live" ? "No eBay UK listings matched. Tap eBay UK below to search it yourself." :
      "eBay live prices coming soon. Tap eBay UK below to search it now.";
    box.appendChild(el("p", { "class": "ebay-note", id: "ebayNote", text: msg }));
  }

  function renderLinks(q, f) {
    var all = Sites.links({ q: q, uk: f.uk, max: f.max, cond: f.cond, bin: f.bin, addVinyl: f.vinyl }, store.aff);
    var box = $("linkGroups"); box.innerHTML = "";
    Sites.GROUPS.forEach(function (g) {
      var grid = el("div", { "class": "link-grid" });
      all.filter(function (l) { return l.group === g.id; }).forEach(function (l, i) {
        grid.appendChild(el("a", { "class": "site-link ear-" + (i % 3), href: l.url, target: "_blank", rel: "noopener", "data-ext": "1", "data-site": l.key }, [
          el("span", { "class": "ear", "aria-hidden": "true", text: l.name.charAt(0) }),
          el("b", { text: l.name }), el("span", { "class": "note", text: l.note })
        ]));
      });
      box.appendChild(el("div", { "class": "group" }, [el("h4", { text: g.title }), grid]));
    });
  }

  $("searchForm").addEventListener("submit", function (e) { e.preventDefault(); $("q").blur(); dig($("q").value); });
  document.querySelectorAll("[data-dig]").forEach(function (b) { b.addEventListener("click", function () { var t = b.getAttribute("data-dig"); $("q").value = t; dig(t); }); });
  ["fUk", "fBin", "fVinyl", "fMax", "fCond"].forEach(function (id) { $(id).addEventListener("change", function () { readFilters(); if ($("q").value.trim() && !$("results").hidden) renderLinks($("q").value.trim(), store.filters); }); });

  // ---------- wantlist ----------
  function addWant(q, target, ref) {
    q = String(q || "").trim(); if (!q) return;
    var existing = store.want.filter(function (w) { return w.q.toLowerCase() === q.toLowerCase(); })[0];
    if (existing) { existing.target = Number(target) || existing.target; if (ref) existing.ref = ref; }
    else store.want.unshift({ id: Date.now().toString(36), q: q, target: Number(target) || 0, ref: ref || null, best: null, checked: null });
    save(); renderWant(); toast("On your wantlist, target " + gbp(Number(target) || 0));
  }
  function ago(t) { if (!t) return ""; var m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago"; }
  function renderWant() {
    var ul = $("wantlist"); ul.innerHTML = "";
    $("wantEmpty").hidden = store.want.length > 0;
    $("checkAll").disabled = !store.want.length;
    store.want.forEach(function (w) {
      var hit = w.best != null && w.best <= w.target;
      ul.appendChild(el("li", { "class": "want" + (hit ? " hit" : "") }, [
        el("div", { "class": "w-body" }, [
          el("div", { "class": "q", text: w.q }),
          el("div", { "class": "meta", text: w.best != null ? "Lowest on Discogs " + gbp(w.best) + " + postage · " + ago(w.checked) : (w.checked ? "None for sale on Discogs · " + ago(w.checked) : "Not checked yet") + (w.ref ? " · VG+ ref " + gbp(w.ref) : "") })
        ]),
        sticker(gbp(w.target), { top: "Target", label: "Target " + gbp(w.target) }),
        hit ? stamp("steal", "Below target", null) : null,
        el("div", { "class": "actions" }, [
          el("button", { "class": "btn small primary", type: "button", text: "Dig", onclick: function () { $("q").value = w.q; showTab("dig"); dig(w.q); } }),
          el("button", { "class": "btn small", type: "button", text: "Edit target", onclick: function () { var t = prompt("Target price in £ for " + w.q, w.target); if (t !== null && isFinite(parseFloat(t))) { w.target = parseFloat(t); save(); renderWant(); } } }),
          el("button", { "class": "btn small", type: "button", "aria-label": "Remove " + w.q, text: "Remove", onclick: function () { store.want = store.want.filter(function (x) { return x.id !== w.id; }); save(); renderWant(); } })
        ])
      ]));
    });
  }
  $("wantForm").addEventListener("submit", function (e) { e.preventDefault(); addWant($("wQ").value, parseFloat($("wT").value), null); $("wQ").value = ""; $("wT").value = ""; });
  $("checkAll").addEventListener("click", function () {
    var btn = $("checkAll"); btn.disabled = true;
    var items = store.want.slice(), i = 0, stopped = null;
    function step() {
      if (i >= items.length || stopped) return Promise.resolve();
      var w = items[i++]; btn.textContent = "Checking " + i + "/" + items.length + "…";
      return Data.search(w.q, { keys: store.keys, aff: store.aff, uk: store.filters.uk }).then(function (res) {
        w.best = res.cheapest ? res.cheapest.lowest : null; w.checked = Date.now();
        if (res.cheapest && res.cheapest.reference) w.ref = res.cheapest.reference;
      }, function (e) { if (e.kind === "rate" || e.kind === "offline") stopped = e; }).then(step);
    }
    step().then(function () {
      save(); renderWant(); btn.textContent = "Check prices"; btn.disabled = false;
      if (stopped) { toast(Data.friendly(stopped)); return; }
      var hits = store.want.filter(function (w) { return w.best != null && w.best <= w.target; }).length;
      toast(hits ? hits + " below target on Discogs" : "Nothing below target yet");
    });
  });

  // ---------- calculator ----------
  Deal.GRADES.forEach(function (g) { $("cGrade").appendChild(el("option", { value: g.id, text: g.label })); });
  $("cGrade").value = "VG+";
  var SEG = [["pricey", 25], ["steep", 20], ["fair", 17], ["good", 18], ["steal", 20]];
  function calc() {
    var r = Deal.evaluate({ price: $("cPrice").value, postage: $("cPost").value, reference: $("cRef").value, grade: $("cGrade").value });
    var out = $("calcOut"); out.innerHTML = "";
    if (!r.ok || $("cPrice").value === "") { out.appendChild(el("div", { "class": "line", text: "Enter the asking price to see the total and score." })); return; }
    out.appendChild(el("div", { "class": "calc-total" }, [sticker(gbp(r.total), { big: true, top: "Total", label: "Total with postage " + gbp(r.total) }), el("span", { "class": "kicker", text: "incl. " + gbp(r.postage) + " postage" })]));
    out.appendChild(r.score != null ? verdictStamp(r.score, r.verdict, false) : stamp("ink", "No ref", null));
    if (r.adjustedReference) {
      var meter = el("div", { "class": "meter", "aria-hidden": "true" });
      SEG.forEach(function (s) { meter.appendChild(el("span", { "class": "seg-" + s[0], style: "flex:" + s[1] })); });
      meter.appendChild(el("i", { style: "left:" + r.score + "%" })); out.appendChild(meter);
      out.appendChild(el("div", { "class": "line", text: (r.diff <= 0 ? gbp(-r.diff) + " (" + Math.abs(r.pct) + "%) under" : gbp(r.diff) + " (" + r.pct + "%) over") + " your " + gbp(r.adjustedReference) + " reference for a " + $("cGrade").value + " copy." }));
      out.appendChild(el("div", { "class": "line", text: "Good deal at " + gbp(r.goodDealBelow) + " or less, postage included." }));
    } else out.appendChild(el("div", { "class": "line", text: "Add a reference price to get a deal score." }));
  }
  ["cPrice", "cPost", "cRef", "cGrade"].forEach(function (id) { $(id).addEventListener("input", calc); $(id).addEventListener("change", calc); });
  $("calcForm").addEventListener("submit", function (e) { e.preventDefault(); });
  function prefillCalc(price, post, grade, ref) {
    $("cPrice").value = price != null ? Number(price).toFixed(2) : ""; $("cPost").value = post != null ? Number(post).toFixed(2) : "";
    $("cGrade").value = grade || "VG+"; if (ref) $("cRef").value = Number(ref).toFixed(2);
    calc(); showTab("calc");
    if (!ref && !$("cRef").value) setTimeout(function () { $("cRef").focus(); }, 50);
  }

  // ---------- settings ----------
  function writeSettings() {
    $("kDiscogs").value = store.keys.discogsToken || ""; $("kEbay").value = store.keys.ebayToken || "";
    $("aEpn").value = store.aff.epnCampaign || ""; $("aAmz").value = store.aff.amazonTag || ""; $("premium").checked = !!store.premium;
  }
  $("kDiscogs").addEventListener("change", function () { store.keys.discogsToken = this.value.trim(); save(); toast(store.keys.discogsToken ? "Discogs token saved" : "Discogs token removed"); });
  $("kEbay").addEventListener("change", function () { store.keys.ebayToken = this.value.trim(); save(); });
  $("aEpn").addEventListener("change", function () { store.aff.epnCampaign = this.value.trim(); save(); });
  $("aAmz").addEventListener("change", function () { store.aff.amazonTag = this.value.trim(); save(); });
  $("premium").addEventListener("change", function () { store.premium = this.checked; save(); if (last) { renderPick(last); renderPressings(last); renderEbay(last); } });
  $("wipe").addEventListener("click", function () {
    if (!confirm("Clear your wantlist, recent searches, saved prices and keys from this phone?")) return;
    localStorage.removeItem(KEY); Data.clearCache(); store = load(); writeSettings(); writeFilters(); renderRecent(); renderWant(); toast("Cleared");
  });

  // ---------- boot ----------
  writeFilters(); writeSettings(); renderChip(); renderRecent(); renderWant(); calc();
  var start = (location.hash || "").slice(1);
  if (["dig", "want", "calc", "set"].indexOf(start) >= 0) showTab(start);
  var qp = new URLSearchParams(location.search).get("q");
  if (qp) { $("q").value = qp; dig(qp); }

  if ("serviceWorker" in navigator && location.protocol === "https:" && !native()) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
  window.BinRaider = { dig: dig, addWant: addWant, prefillCalc: prefillCalc, store: function () { return store; } };
})();
