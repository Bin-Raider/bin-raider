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

// data layer: Discogs fetch mocked with real captured fixtures (tests/fixtures)
const fs = require("fs"), path = require("path");
const FIX = n => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8"));
let calls = [], mode = "ok";
function res(status, body, headers) { return { ok: status < 400, status, headers: { get: k => (headers || {})[k.toLowerCase()] || null }, json: async () => body }; }
global.fetch = async (url, opts) => {
  calls.push({ url, headers: (opts && opts.headers) || {} });
  if (mode === "offline-net") throw new TypeError("Failed to fetch");
  const u = new URL(url);
  if (u.pathname === "/database/search") {
    if (mode === "429") return res(429, { message: "slow down" }, { "retry-after": "17" });
    if (mode === "500") return res(500, {});
    if (mode === "401") return res(401, {});
    return res(200, /zzqq/.test(u.searchParams.get("q")) ? FIX("search-empty.json") : FIX("search-portishead.json"));
  }
  const m = u.pathname.match(/^\/marketplace\/stats\/(\d+)$/);
  if (m) { const f = path.join(__dirname, "fixtures", "stats-" + m[1] + ".json"); return res(200, fs.existsSync(f) ? FIX("stats-" + m[1] + ".json") : { num_for_sale: 0, lowest_price: null }); }
  if (u.pathname.startsWith("/marketplace/price_suggestions/")) return (opts.headers || {}).Authorization ? res(200, FIX("price-suggestions-sample.json")) : res(401, {});
  return res(404, {});
};
const fresh = () => { Data.clearCache(); Data._resetLimiter(); calls = []; mode = "ok"; };

(async () => {
  async function at(name, fn) { try { await fn(); pass++; out.push("PASS " + name); } catch (e) { fail++; out.push("FAIL " + name + " :: " + e.message); } }

  fresh();
  const r = await Data.search("Portishead Dummy", {});
  await at("live search: 1 search + 5 stats calls (rate-limit friendly)", () => { assert.strictEqual(calls.length, 6); assert.strictEqual(calls.filter(c => c.url.includes("/marketplace/stats/")).length, 5); });
  await at("search asks for vinyl releases", () => { const u = new URL(calls[0].url); assert.strictEqual(u.searchParams.get("type"), "release"); assert.strictEqual(u.searchParams.get("format"), "Vinyl"); assert.strictEqual(u.searchParams.get("q"), "Portishead Dummy"); });
  await at("stats requested in GBP", () => calls.filter(c => c.url.includes("/stats/")).forEach(c => assert.ok(c.url.endsWith("curr_abbr=GBP"))));
  await at("no auth header without token", () => calls.forEach(c => assert.ok(!c.headers.Authorization)));
  await at("pressings sorted by lowest listed price", () => assert.deepStrictEqual(r.pressings.map(p => p.lowest), [16.67, 18.75, 20, 25, 96.75]));
  await at("cheapest = lowest listed now, with count for sale", () => { assert.strictEqual(r.cheapest.id, 1526433); assert.strictEqual(r.cheapest.forSale, 41); assert.strictEqual(r.forSale, 41 + 166 + 22 + 27 + 26); });
  await at("release fields parsed (year, country, label, format text)", () => { const p = r.pressings.find(x => x.id === 10147986); assert.strictEqual(p.year, "2017"); assert.strictEqual(p.country, "Europe"); assert.strictEqual(p.label, "Go! Beat"); assert.strictEqual(p.album, "Dummy"); assert.strictEqual(p.artist, "Portishead"); assert.ok(p.format.includes("180 Gram, Pallas Pressing")); });
  await at("release + GBP marketplace links", () => { assert.strictEqual(r.cheapest.url, "https://www.discogs.com/release/1526433"); assert.strictEqual(r.cheapest.marketUrl, "https://www.discogs.com/sell/release/1526433?currency=GBP"); });
  await at("no reference without token -> no invented score", () => r.pressings.forEach(p => { assert.strictEqual(p.reference, null); assert.strictEqual(p.score, null); }));
  await at("no sold-price medians or history in results", () => { assert.ok(!("history" in r)); assert.ok(!JSON.stringify(r).toLowerCase().includes("median")); });
  await at("total pressings from pagination", () => assert.strictEqual(r.totalPressings, 30));
  await at("eBay: coming soon when no token", () => { assert.strictEqual(r.ebay, null); assert.strictEqual(r.ebayStatus, "soon"); });
  calls = []; await Data.search("Portishead Dummy", {});
  await at("repeat search is served from cache (0 calls)", () => assert.strictEqual(calls.length, 0));

  fresh();
  const t = await Data.search("Portishead Dummy", { keys: { discogsToken: "TKN" } });
  await at("token: Authorization: Discogs token=… on every call", () => calls.forEach(c => assert.strictEqual(c.headers.Authorization, "Discogs token=TKN")));
  await at("token: 5 price_suggestions calls", () => assert.strictEqual(calls.filter(c => c.url.includes("/price_suggestions/")).length, 5));
  await at("token: suggested VG+ used as reference and scored", () => { assert.strictEqual(t.cheapest.suggestedVgPlus.value, 24.68); assert.strictEqual(t.cheapest.reference, 24.68); assert.strictEqual(t.cheapest.score, Deal.score(16.67, 24.68)); assert.strictEqual(t.cheapest.verdict.key, "steal"); });
  await at("token and no-token results cached separately", () => assert.ok(calls.length > 0));
  await at("eBay token in Node/web without proxy -> needs-app note, no eBay call", async () => { fresh(); const e = await Data.search("x y", { keys: { ebayToken: "E" } }); assert.strictEqual(e.ebayStatus, "needs-app"); assert.ok(!calls.some(c => c.url.includes("ebay"))); });

  fresh(); mode = "429";
  await at("429 -> rate error with retry-after", async () => { try { await Data.search("a b", {}); assert.fail("no throw"); } catch (e) { assert.strictEqual(e.kind, "rate"); assert.strictEqual(e.retryAfter, 17); assert.ok(/slow down/i.test(Data.friendly(e))); } });
  fresh(); mode = "401";
  await at("401 -> auth error message", async () => { try { await Data.search("a b", { keys: { discogsToken: "bad" } }); assert.fail("no throw"); } catch (e) { assert.strictEqual(e.kind, "auth"); assert.ok(/token/.test(Data.friendly(e))); } });
  fresh(); mode = "offline-net";
  await at("network failure while online -> network error", async () => { try { await Data.search("c d", {}); assert.fail("no throw"); } catch (e) { assert.strictEqual(e.kind, "network"); } });
  fresh(); const navDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator"); Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true, writable: true });
  await at("offline -> offline error, no request made", async () => { try { await Data.search("c d", {}); assert.fail("no throw"); } catch (e) { assert.strictEqual(e.kind, "offline"); assert.strictEqual(calls.length, 0); assert.ok(/offline/i.test(Data.friendly(e))); } });
  if (navDesc) Object.defineProperty(globalThis, "navigator", navDesc); else delete globalThis.navigator;
  fresh();
  await at("no results -> empty pressings, cheapest null", async () => { const e = await Data.search("zzqq nothing", {}); assert.strictEqual(e.pressings.length, 0); assert.strictEqual(e.cheapest, null); assert.strictEqual(calls.length, 1); });
  fresh(); mode = "429";
  await at("errors are not cached", async () => { try { await Data.search("e f", {}); } catch (e) {} mode = "ok"; const x = await Data.search("e f", {}); assert.strictEqual(x.pressings.length, 5); });

  await at("limiter waits instead of exceeding 22 calls/min without a token", async () => {
    fresh(); let now = 1e9; Data._resetLimiter(() => now);
    // 4 searches = 24 calls; the 23rd must wait for the window
    let done = 0; const ps = ["q1 a", "q2 a", "q3 a", "q4 a"].map(q => Data.search(q, {}).then(() => done++));
    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(calls.length, 22); assert.ok(done < 4);
    Data._resetLimiter(); // release
  });

  await at("eBay Browse parser (doc-shaped sample)", () => {
    const e = Data.parseEbay({ itemSummaries: [{ itemId: "v1|1|0", title: "Portishead Dummy LP", price: { value: "18.99", currency: "GBP" }, shippingOptions: [{ shippingCost: { value: "3.20", currency: "GBP" } }], condition: "Used", itemWebUrl: "https://www.ebay.co.uk/itm/1", itemLocation: { country: "GB" } }, { itemId: "v1|2|0", title: "no ship", price: { value: "9.00" }, itemWebUrl: "https://www.ebay.co.uk/itm/2" }] }, { epnCampaign: "123" });
    assert.strictEqual(e.length, 2); assert.strictEqual(e[0].price, 18.99); assert.strictEqual(e[0].postage, 3.2); assert.strictEqual(e[1].postageKnown, false); assert.ok(e[0].url.includes("campid=123"));
  });
  await at("config: proxyBase present and blank, UA set", () => { assert.strictEqual(Data.config.proxyBase, ""); assert.ok(/^BinRaider\/0\.2 /.test(Data.config.userAgent)); });
  await at("no mock search exported", () => { assert.strictEqual(Data.mockSearch, undefined); });
  await at("capacitor config enables CapacitorHttp", () => assert.strictEqual(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "capacitor.config.json"))).plugins.CapacitorHttp.enabled, true));
  await at("version 0.2.0 everywhere", () => { assert.strictEqual(require("../package.json").version, "0.2.0"); assert.ok(fs.readFileSync(path.join(__dirname, "../www/sw.js"), "utf8").includes("binraider-0.2.0")); assert.ok(fs.readFileSync(path.join(__dirname, "../www/index.html"), "utf8").includes("Bin Raider 0.2.0")); });
  await at("no Hark branding in www", () => { const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(f => f.isDirectory() ? walk(path.join(d, f.name)) : [path.join(d, f.name)]); walk(path.join(__dirname, "../www")).filter(f => !/\.(png|ttf|woff2?)$/.test(f)).forEach(f => assert.ok(!/hark/i.test(fs.readFileSync(f, "utf8")), f)); });

  console.log(out.join("\n")); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
