const assert = require("assert");
const Deal = require("../www/js/deal.js");
const Sites = require("../www/js/sites.js");
const Data = require("../www/js/data.js");
let pass = 0, fail = 0; const out = [];
function t(name, fn) { try { fn(); pass++; out.push("PASS " + name); } catch (e) { fail++; out.push("FAIL " + name + " :: " + e.message); } }

// deal maths
t("score at reference = 50", () => assert.strictEqual(Deal.score(20, 20), 50));
t("score 40% under = 100", () => assert.strictEqual(Deal.score(12, 20), 100));
t("score 40% over = 0", () => assert.strictEqual(Deal.score(28, 20), 0));
t("score clamps", () => { assert.strictEqual(Deal.score(1, 20), 100); assert.strictEqual(Deal.score(100, 20), 0); });
t("no reference -> null score", () => assert.strictEqual(Deal.evaluate({ price: 10, postage: 3 }).score, null));
t("total = price + postage", () => assert.strictEqual(Deal.evaluate({ price: "12.50", postage: "3.49", reference: 20 }).total, 15.99));
t("£ and commas parsed", () => assert.strictEqual(Deal.evaluate({ price: "£1,012.00", postage: "", reference: 900 }).total, 1012));
t("negative postage treated as 0", () => assert.strictEqual(Deal.evaluate({ price: 10, postage: -5, reference: 20 }).total, 10));
t("grade adjusts reference (VG = 0.65x)", () => assert.strictEqual(Deal.evaluate({ price: 10, reference: 20, grade: "VG" }).adjustedReference, 13));
t("verdict bands", () => { assert.strictEqual(Deal.verdict(85).key, "steal"); assert.strictEqual(Deal.verdict(62).key, "good"); assert.strictEqual(Deal.verdict(50).key, "fair"); assert.strictEqual(Deal.verdict(30).key, "steep"); assert.strictEqual(Deal.verdict(10).key, "pricey"); });
t("good-deal-below price scores 62", () => { const r = Deal.evaluate({ price: 1, reference: 20 }); assert.strictEqual(Deal.score(r.goodDealBelow, 20) >= 62, true); });
t("empty price -> error", () => assert.strictEqual(Deal.evaluate({ price: "", reference: 20 }).ok, false));
t("gbp formatting", () => { assert.strictEqual(Deal.gbp(3.5), "£3.50"); assert.strictEqual(Deal.gbp(null), "–"); });

// links
const L = Sites.links({ q: "Portishead Dummy", uk: true, max: 30, cond: "used", bin: true, addVinyl: true });
const get = k => L.find(l => l.key === k).url;
t("18 links generated", () => assert.strictEqual(L.length, 18));
t("every link https and on its declared host", () => L.forEach(l => { const u = new URL(l.url); assert.strictEqual(u.protocol, "https:"); assert.strictEqual(u.hostname, l.host, l.key); }));
t("every link carries the query", () => L.forEach(l => assert.ok(decodeURIComponent(l.url).replace(/\+/g, " ").includes("Portishead Dummy"), l.key)));
t("eBay: records category, cheapest+postage, UK, BIN, used, max", () => { const u = new URL(get("ebay")); const p = u.searchParams; assert.strictEqual(p.get("_sacat"), "176985"); assert.strictEqual(p.get("_sop"), "15"); assert.strictEqual(p.get("LH_PrefLoc"), "1"); assert.strictEqual(p.get("LH_BIN"), "1"); assert.strictEqual(p.get("LH_ItemCondition"), "3000"); assert.strictEqual(p.get("_udhi"), "30"); });
t("eBay auctions: auction filter, no BIN", () => { const p = new URL(get("ebayEnd")).searchParams; assert.strictEqual(p.get("LH_Auction"), "1"); assert.strictEqual(p.get("LH_BIN"), null); assert.strictEqual(p.get("_sop"), "1"); });
t("eBay sold: sold+completed", () => { const p = new URL(get("ebaySold")).searchParams; assert.strictEqual(p.get("LH_Sold"), "1"); assert.strictEqual(p.get("LH_Complete"), "1"); });
t("Vinted: adds vinyl, max price", () => { const p = new URL(get("vinted")).searchParams; assert.strictEqual(p.get("search_text"), "Portishead Dummy vinyl"); assert.strictEqual(p.get("price_to"), "30"); });
t("Discogs: vinyl, price asc, ships from UK", () => { const p = new URL(get("discogs")).searchParams; assert.strictEqual(p.get("format"), "Vinyl"); assert.strictEqual(p.get("sort"), "price,asc"); assert.strictEqual(p.get("ships_from"), "United Kingdom"); });
t("special chars encoded (AC/DC & 'Back in Black')", () => { const x = Sites.links({ q: "AC/DC & 'Back in Black' #1" }); x.forEach(l => { const u = new URL(l.url); assert.ok(!u.hash, l.key + " has a stray #"); }); assert.strictEqual(new URL(x.find(l => l.key === "ebay").url).searchParams.get("_nkw"), "AC/DC & 'Back in Black' #1"); });
t("no filters -> no filter params", () => { const p = new URL(Sites.links({ q: "x" }).find(l => l.key === "ebay").url).searchParams; ["LH_PrefLoc", "LH_BIN", "_udhi", "LH_ItemCondition"].forEach(k => assert.strictEqual(p.get(k), null)); });
t("affiliate: eBay EPN params only when id set", () => { const a = Sites.links({ q: "x" }, { epnCampaign: "5338123456" }); const p = new URL(a.find(l => l.key === "ebay").url).searchParams; assert.strictEqual(p.get("campid"), "5338123456"); assert.strictEqual(p.get("mkrid"), "710-53481-19255-0"); assert.strictEqual(new URL(a.find(l => l.key === "vinted").url).searchParams.get("campid"), null); });
t("affiliate: Amazon tag", () => { const a = Sites.links({ q: "x" }, { amazonTag: "binraider-21" }); assert.strictEqual(new URL(a.find(l => l.key === "amazon").url).searchParams.get("tag"), "binraider-21"); });
t("affiliate blank leaves links unchanged", () => assert.deepStrictEqual(Sites.links({ q: "x" }, {}).map(l => l.url), Sites.links({ q: "x" }).map(l => l.url)));

// data layer
(async () => {
  const a = await Data.mockSearch("Portishead Dummy", {}), b = await Data.mockSearch("portishead dummy", {});
  t("mock is labelled mock", () => { assert.strictEqual(a.mode, "mock"); assert.ok(a.listings.every(l => l.mock)); });
  t("mock repeatable for same search", () => assert.deepStrictEqual(a.listings.map(l => l.total), b.listings.map(l => l.total)));
  t("mock sorted by total, totals add up", () => { for (let i = 0; i < a.listings.length; i++) { const l = a.listings[i]; assert.strictEqual(Math.round((l.price + l.postage) * 100) / 100, l.total); if (i) assert.ok(l.total >= a.listings[i - 1].total); } });
  t("mock has 12-month history", () => assert.strictEqual(a.history.length, 12));
  t("eBay Browse parser (doc-shaped sample)", () => {
    const r = Data.parseEbay({ itemSummaries: [{ itemId: "v1|1|0", title: "Portishead Dummy LP", price: { value: "18.99", currency: "GBP" }, shippingOptions: [{ shippingCost: { value: "3.20", currency: "GBP" } }], condition: "Used", itemWebUrl: "https://www.ebay.co.uk/itm/1", itemLocation: { country: "GB" } }, { itemId: "v1|2|0", title: "no ship", price: { value: "9.00" }, itemWebUrl: "https://www.ebay.co.uk/itm/2" }] }, { epnCampaign: "123" });
    assert.strictEqual(r.length, 2); assert.strictEqual(r[0].price, 18.99); assert.strictEqual(r[0].postage, 3.2); assert.strictEqual(r[1].postageKnown, false); assert.ok(r[0].url.includes("campid=123"));
  });
  t("Discogs parser (doc-shaped sample)", () => {
    const r = Data.parseDiscogs({ id: 367084, title: "Portishead - Dummy", year: "1994" }, { "Very Good Plus (VG+)": { currency: "GBP", value: 24.6789 } }, { lowest_price: { currency: "GBP", value: 19.5 }, num_for_sale: 212 });
    assert.strictEqual(r.price, 24.68); assert.strictEqual(r.lowest, 19.5); assert.strictEqual(r.forSale, 212);
  });
  const live = await Data.liveSearch("x", { keys: {} });
  t("live with no keys returns notes, no crash", () => { assert.strictEqual(live.mode, "live"); assert.strictEqual(live.listings.length, 0); assert.ok(live.notes.length === 2); });
  console.log(out.join("\n")); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
