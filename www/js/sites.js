/* Bin Raider - deep links to UK shops and marketplaces. Links only: nothing here fetches or scrapes a page. */
(function (root) {
  var EBAY = "https://www.ebay.co.uk/sch/i.html?_nkw=";
  var EBAY_VINYL_CAT = "176985"; // eBay UK: Music > Records

  // opts: { q: raw text, uk: bool, max: number|"", cond: "any"|"used"|"new", bin: bool, addVinyl: bool }
  function state(opts) {
    var raw = String(opts.q || "").trim();
    var max = opts.max === "" || opts.max == null ? "" : String(Math.floor(Number(opts.max)) || "");
    return {
      raw: raw,
      q: encodeURIComponent(raw),
      qv: encodeURIComponent(opts.addVinyl !== false ? raw + " vinyl" : raw),
      uk: !!opts.uk, max: max, cond: opts.cond || "any", bin: !!opts.bin
    };
  }

  function ebayFilters(s, o) {
    var u = "";
    if (s.uk) u += "&LH_PrefLoc=1";
    if (o.bin && s.bin) u += "&LH_BIN=1";
    if (s.cond === "used") u += "&LH_ItemCondition=3000";
    if (s.cond === "new") u += "&LH_ItemCondition=1000";
    if (s.max) u += "&_udhi=" + s.max;
    return u;
  }

  var SITES = {
    ebay: { name: "eBay UK", group: "market", note: "Cheapest first, including postage", host: "www.ebay.co.uk", url: function (s) { return EBAY + s.q + "&_sacat=" + EBAY_VINYL_CAT + "&_sop=15" + ebayFilters(s, { bin: true }); } },
    ebayEnd: { name: "eBay UK auctions ending", group: "market", note: "Auctions about to close", host: "www.ebay.co.uk", url: function (s) { return EBAY + s.q + "&_sacat=" + EBAY_VINYL_CAT + "&_sop=1&LH_Auction=1" + ebayFilters(s, { bin: false }); } },
    vinted: { name: "Vinted", group: "market", note: "Low to high, offers welcome", host: "www.vinted.co.uk", url: function (s) { return "https://www.vinted.co.uk/catalog?search_text=" + s.qv + "&order=price_low_to_high" + (s.max ? "&price_to=" + s.max + "&currency=GBP" : ""); } },
    discogs: { name: "Discogs Marketplace", group: "market", note: "Collectors' market, cheapest first", host: "www.discogs.com", url: function (s) { return "https://www.discogs.com/sell/list?q=" + s.q + "&format=Vinyl&sort=price%2Casc" + (s.uk ? "&ships_from=United+Kingdom" : ""); } },
    facebook: { name: "Facebook Marketplace", group: "market", note: "Local, often collection only", host: "www.facebook.com", url: function (s) { return "https://www.facebook.com/marketplace/search/?query=" + s.qv + (s.max ? "&maxPrice=" + s.max : ""); } },
    gumtree: { name: "Gumtree", group: "market", note: "Job lots and clearances", host: "www.gumtree.com", url: function (s) { return "https://www.gumtree.com/search?search_category=all&q=" + s.qv + (s.max ? "&max_price=" + s.max : ""); } },
    depop: { name: "Depop", group: "market", note: "Pop and indie sellers", host: "www.depop.com", url: function (s) { return "https://www.depop.com/search/?q=" + s.qv; } },
    cex: { name: "CeX", group: "shop", note: "Fixed prices, graded stock", host: "uk.webuy.com", url: function (s) { return "https://uk.webuy.com/search?stext=" + s.qv; } },
    magpie: { name: "musicMagpie", group: "shop", note: "Cheap used titles; shows all formats", host: "www.musicmagpie.co.uk", url: function (s) { return "https://www.musicmagpie.co.uk/store/category/?keyword=" + s.q; } },
    oxfam: { name: "Oxfam Online Shop", group: "shop", note: "Charity stock", host: "onlineshop.oxfam.org.uk", url: function (s) { return "https://onlineshop.oxfam.org.uk/searchresults?Ntt=" + s.q + "&type=search"; } },
    amazon: { name: "Amazon UK", group: "shop", note: "New pressings, cheapest first", host: "www.amazon.co.uk", url: function (s) { return "https://www.amazon.co.uk/s?k=" + s.qv + "&i=popular&s=price-asc-rank" + (s.max ? "&high-price=" + s.max : ""); } },
    hmv: { name: "HMV", group: "shop", note: "High street, frequent sales", host: "hmv.com", url: function (s) { return "https://hmv.com/search?searchtext=" + s.q; } },
    juno: { name: "Juno Records", group: "shop", note: "Huge new stock, strong on dance", host: "www.juno.co.uk", url: function (s) { return "https://www.juno.co.uk/search/?q%5Ball%5D%5B%5D=" + s.q; } },
    rough: { name: "Rough Trade", group: "shop", note: "Indie exclusives, coloured vinyl", host: "www.roughtrade.com", url: function (s) { return "https://www.roughtrade.com/en-gb/search?q=" + s.q; } },
    google: { name: "Google Shopping", group: "shop", note: "Catches every other shop", host: "www.google.com", url: function (s) { return "https://www.google.com/search?q=" + s.qv + "&udm=28"; } },
    ebaySold: { name: "eBay UK sold", group: "sold", note: "What copies sold for (eBay may ask you to sign in)", host: "www.ebay.co.uk", url: function (s) { return EBAY + s.q + "&_sacat=" + EBAY_VINYL_CAT + "&LH_Sold=1&LH_Complete=1&_sop=13" + (s.uk ? "&LH_PrefLoc=1" : ""); } },
    discogsRel: { name: "Discogs release", group: "sold", note: "Lowest, median and highest sold", host: "www.discogs.com", url: function (s) { return "https://www.discogs.com/search/?q=" + s.q + "&type=all&format_exact=Vinyl"; } },
    popsike: { name: "Popsike", group: "sold", note: "Rare record auction history", host: "www.popsike.com", url: function (s) { return "https://www.popsike.com/php/quicksearch.php?searchtext=" + s.q; } }
  };

  var GROUPS = [
    { id: "market", title: "Marketplaces" },
    { id: "shop", title: "Shops" },
    { id: "sold", title: "Check sold prices" }
  ];

  // Affiliate tagging. Empty ids leave links untouched.
  // eBay Partner Network, UK rotation id 710-53481-19255-0.
  function affiliate(url, aff) {
    aff = aff || {};
    try {
      var u = new URL(url);
      if (aff.epnCampaign && /(^|\.)ebay\.co\.uk$/.test(u.hostname)) {
        u.searchParams.set("mkcid", "1");
        u.searchParams.set("mkrid", "710-53481-19255-0");
        u.searchParams.set("siteid", "3");
        u.searchParams.set("campid", aff.epnCampaign);
        u.searchParams.set("customid", "binraider");
        u.searchParams.set("toolid", "10001");
        u.searchParams.set("mkevt", "1");
        return u.toString();
      }
      if (aff.amazonTag && /(^|\.)amazon\.co\.uk$/.test(u.hostname)) {
        u.searchParams.set("tag", aff.amazonTag);
        return u.toString();
      }
    } catch (e) { /* fall through */ }
    return url;
  }

  function links(opts, aff) {
    var s = state(opts);
    return Object.keys(SITES).map(function (k) {
      var site = SITES[k];
      return { key: k, name: site.name, group: site.group, note: site.note, host: site.host, url: affiliate(site.url(s), aff) };
    });
  }

  var api = { SITES: SITES, GROUPS: GROUPS, state: state, links: links, affiliate: affiliate };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.BRSites = api;
})(this);
