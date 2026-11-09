"""Bin Raider UI tests (0.2). Runs the app in Chromium at phone sizes.
Discogs/eBay calls are stubbed with Playwright route() fixtures so results are deterministic.
One final smoke check hits the real Discogs API (no stubs).
Run from app/: serve www on :8765 (NO_PROXY=127.0.0.1 python3 -m http.server 8765 --directory www), then python3 tests/ui.test.py"""
import json, os, re, sys, urllib.parse
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8765/index.html"
FIX = os.path.join(os.path.dirname(__file__), "fixtures")
SHOTS = os.path.join(os.path.dirname(__file__), "screens")
SIZES = [("small-320x640", 320, 640), ("galaxy-a-360x800", 360, 800), ("pixel-8-412x915", 412, 915), ("galaxy-s24-ultra-480x1040", 480, 1040)]
ONLY = [a for a in sys.argv[1:] if not a.startswith("--")]
if ONLY: SIZES = [s for s in SIZES if any(o in s[0] for o in ONLY)]
NO_REAL = "--no-real" in sys.argv
OUT = os.environ.get("UI_RESULTS", os.path.join(os.path.dirname(__file__), "ui-results.json"))
results = []
def check(name, cond, detail=""):
    results.append(("PASS" if cond else "FAIL", name, str(detail)[:300]))

def fx(name): return open(os.path.join(FIX, name)).read()

def make_router(log):
    def handle(route):
        req = route.request; u = urllib.parse.urlparse(req.url); qs = urllib.parse.parse_qs(u.query)
        log.append({"url": req.url, "auth": req.headers.get("authorization")})
        hdr = {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"}
        if u.path == "/database/search":
            q = (qs.get("q") or [""])[0].lower()
            if "ratelimit" in q: return route.fulfill(status=429, headers=hdr, body='{"message": "You are making requests too quickly."}')
            if "zzqq" in q: return route.fulfill(status=200, headers=hdr, body=fx("search-empty.json"))
            return route.fulfill(status=200, headers=hdr, body=fx("search-portishead.json"))
        m = re.match(r"^/marketplace/stats/(\d+)$", u.path)
        if m:
            f = os.path.join(FIX, "stats-%s.json" % m.group(1))
            return route.fulfill(status=200, headers=hdr, body=open(f).read() if os.path.exists(f) else '{"num_for_sale":0,"lowest_price":null}')
        if u.path.startswith("/marketplace/price_suggestions/"):
            if not req.headers.get("authorization"): return route.fulfill(status=401, headers=hdr, body='{"message":"You must authenticate to access this resource."}')
            return route.fulfill(status=200, headers=hdr, body=fx("price-suggestions-sample.json"))
        return route.fulfill(status=404, headers=hdr, body="{}")
    return handle

def proxy_from_env():
    p = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if not p: return None
    u = urllib.parse.urlparse(p)
    out = {"server": "%s://%s:%s" % (u.scheme, u.hostname, u.port), "bypass": "127.0.0.1,localhost"}
    if u.username: out["username"] = urllib.parse.unquote(u.username); out["password"] = urllib.parse.unquote(u.password or "")
    return out

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])
    for label, w, h in SIZES:
        shot = lambda name, full=True: pg.screenshot(path=os.path.join(SHOTS, f"{label}-{name}.png"), full_page=full)
        ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="en-GB")
        log = []; ctx.route("https://api.discogs.com/**", make_router(log))
        ctx.route("https://api.ebay.com/**", lambda r: r.fulfill(status=500, body="{}"))
        ctx.route("https://i.discogs.com/**", lambda r: r.abort())
        pg = ctx.new_page(); errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
        pg.goto(BASE); pg.wait_for_timeout(400)
        def overflow(): return pg.evaluate(f"Math.max(document.documentElement.scrollWidth, window.innerWidth) - {w}")
        check(f"{label}: source chip says Live · Discogs", pg.locator("#srcChip").inner_text().strip().lower() == "live · discogs", pg.locator("#srcChip").inner_text())
        check(f"{label}: no mock wording on home", "mock" not in pg.inner_text("body").lower())
        check(f"{label}: empty state has 3 example digs", pg.locator(".example-digs button").count() == 3)
        check(f"{label}: home no horizontal overflow", overflow() <= 0, overflow())
        for v in ["want", "calc", "set"]:
            pg2 = ctx.new_page(); pg2.goto(BASE + "?fresh=" + v + "#" + v); pg2.wait_for_timeout(300)
            ov = pg2.evaluate(f"Math.max(document.documentElement.scrollWidth, window.innerWidth) - {w}")
            check(f"{label}: {v} view (fresh load) no horizontal overflow", ov <= 0, ov); pg2.close()
        shot("1-dig-empty", False)
        # search via an example dig
        n0 = len(log)
        pg.locator(".example-digs button", has_text="Dummy").click(); pg.wait_for_selector(".pressing")
        check(f"{label}: example dig fills the search box", pg.input_value("#q") == "Portishead Dummy")
        n = pg.locator("#pressings .pressing").count(); check(f"{label}: 5 Discogs pressings shown", n == 5, n)
        calls = log[n0:]
        check(f"{label}: 1 search + 5 stats calls, GBP", len(calls) == 6 and sum("/marketplace/stats/" in c["url"] and "curr_abbr=GBP" in c["url"] for c in calls) == 5, [c["url"] for c in calls])
        check(f"{label}: no auth header without token", all(c["auth"] is None for c in calls))
        prices = pg.eval_on_selector_all("#pressings .pressing > .sticker .st-val", "els => els.map(e => e.textContent)")
        check(f"{label}: pressings sorted cheapest first, real fixture prices", prices == ["£16.67", "£18.75", "£20.00", "£25.00", "£96.75"], prices)
        check(f"{label}: pick shows lowest listed now", "£16.67" in pg.inner_text("#pick") and "Lowest listed on Discogs now" in pg.inner_text("#pick") and "41 for sale" in pg.inner_text("#pick"))
        check(f"{label}: honest count label per pressing", "166 for sale on Discogs" in pg.inner_text("#pressings") and "lowest listed on Discogs right now" in pg.inner_text("#crate"))
        hrefs = pg.eval_on_selector_all("#pressings a", "els => els.map(e => e.href)")
        check(f"{label}: links to release + GBP marketplace", "https://www.discogs.com/release/1526433" in hrefs and "https://www.discogs.com/sell/release/1526433?currency=GBP" in hrefs)
        check(f"{label}: no verdict stamps without a reference", pg.locator("#pressings .stamp").count() == 0 and pg.locator("#pick .stamp.ink").count() == 1)
        check(f"{label}: eBay coming-soon note", "eBay live prices coming soon" in pg.inner_text("#ebayNote"))
        check(f"{label}: no price history / mock UI", pg.locator(".trend, .mock-banner, svg[aria-label='Price trend']").count() == 0 and "mock" not in pg.inner_text("body").lower())
        links = pg.locator("a.site-link").count(); check(f"{label}: 18 shop divider cards", links == 18, links)
        lh = pg.eval_on_selector_all("a.site-link", "els => els.map(e => [e.dataset.site, e.href, e.target])")
        check(f"{label}: shop links open in new tab with query", all(t == "_blank" and "Portishead" in hr for _, hr, t in lh))
        check(f"{label}: musicMagpie note mentions all formats", "all formats" in pg.inner_text('a[data-site="magpie"]'))
        check(f"{label}: more-pressings link", pg.locator("#allPressings").is_visible())
        check(f"{label}: results no horizontal overflow", overflow() <= 0, overflow())
        small = pg.evaluate("""[...document.querySelectorAll('.tabs button, .btn, a.site-link, .recent button, .example-digs button, .filters summary, .more-link')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.height<44||r.width<44)}).map(e=>e.className+':'+e.textContent.slice(0,20)+':'+Math.round(e.getBoundingClientRect().height))""")
        check(f"{label}: tap targets >= 44px", not small, small)
        clipped = pg.evaluate("""[...document.querySelectorAll('.sticker, .stamp, .p-title, .site-link b, .tabs .lbl, .btn')].filter(e=>e.getBoundingClientRect().width>0 && e.scrollWidth > e.clientWidth + 1).map(e=>e.className+':'+e.textContent.slice(0,24))""")
        check(f"{label}: no clipped text in stickers/stamps/titles/buttons", not clipped, clipped)
        pg.evaluate("document.getElementById('pick').scrollIntoView()"); pg.evaluate("window.scrollBy(0,-70)"); shot("2-dig-results", False)
        pg.evaluate("document.getElementById('crate').scrollIntoView()"); pg.evaluate("window.scrollBy(0,-60)"); shot("2c-dig-crate", False)
        pg.evaluate("document.getElementById('linkGroups').scrollIntoView()"); pg.evaluate("window.scrollBy(0,-90)"); shot("2d-dig-everywhere", False)
        pg.evaluate("window.scrollTo(0,0)")
        # cache: same search again makes no network calls
        n1 = len(log); pg.click("#digBtn"); pg.wait_for_selector(".pressing"); pg.wait_for_timeout(200)
        check(f"{label}: repeat search served from cache", len(log) == n1, [c["url"] for c in log[n1:]])
        # check deal -> calculator
        pg.locator("#pick .btn", has_text="Check deal").click(); pg.wait_for_timeout(200)
        check(f"{label}: Check deal opens calculator with lowest price", pg.locator("#view-calc").is_visible() and pg.input_value("#cPrice") == "16.67")
        pg.fill("#cPrice", "12"); pg.fill("#cPost", "3.50"); pg.select_option("#cGrade", "VG+"); pg.fill("#cRef", "20")
        check(f"{label}: calculator maths 12+3.50 vs 20 -> 78 good", "£15.50" in pg.inner_text("#calcOut") and pg.locator("#calcOut .stamp.good").count() == 1 and "78/100" in pg.inner_text("#calcOut .stamp"), pg.inner_text("#calcOut")[:120])
        check(f"{label}: calc no horizontal overflow", overflow() <= 0)
        pg.evaluate("window.scrollTo(0, document.body.scrollHeight)"); pg.wait_for_timeout(100); shot("4-deal", False)
        # want from result
        pg.click('.tabs button[data-tab="dig"]'); pg.locator("#pick .btn", has_text="Want").click()
        pg.click('.tabs button[data-tab="want"]'); pg.wait_for_timeout(100)
        check(f"{label}: Want adds to wantlist", pg.locator(".want").count() == 1)
        pg.fill("#wQ", "Massive Attack Blue Lines"); pg.fill("#wT", "100"); pg.click("#wantForm button")
        pg.click("#checkAll"); pg.wait_for_function("document.getElementById('checkAll').textContent==='Check prices'", timeout=15000)
        check(f"{label}: Check prices flags item below £100 target", pg.locator(".want.hit").count() >= 1)
        check(f"{label}: wantlist says where the price is from", "Lowest on Discogs £16.67 + postage" in pg.inner_text("#wantlist"))
        pg.reload(); pg.wait_for_timeout(300); pg.click('.tabs button[data-tab="want"]')
        check(f"{label}: wantlist survives reload (saved on device)", pg.locator(".want").count() == 2)
        check(f"{label}: wantlist no horizontal overflow", overflow() <= 0)
        shot("3-wantlist", False)
        # Discogs token: auth header + price suggestions + verdict stamps
        pg.click('.tabs button[data-tab="set"]'); pg.fill("#kDiscogs", "TESTTOKEN123"); pg.press("#kDiscogs", "Tab"); pg.wait_for_timeout(2800)
        pg.evaluate("window.scrollTo(0,0)"); shot("5-settings", False)
        n2 = len(log)
        pg.click('.tabs button[data-tab="dig"]'); pg.fill("#q", "Portishead Dummy"); pg.click("#digBtn"); pg.wait_for_selector("#pressings .stamp")
        calls = log[n2:]
        check(f"{label}: token sends Authorization: Discogs token=", calls and all(c["auth"] == "Discogs token=TESTTOKEN123" for c in calls), calls[:1])
        check(f"{label}: token adds 5 price_suggestions calls", sum("/price_suggestions/" in c["url"] for c in calls) == 5, len(calls))
        check(f"{label}: suggested VG+ price labelled", "Discogs suggested VG+ price £24.68" in pg.inner_text("#pressings"))
        st = pg.locator("#pressings .stamp").count(); check(f"{label}: verdict stamps on all 5 pressings", st == 5, st)
        check(f"{label}: £16.67 vs £24.68 VG+ stamped Steal", pg.locator("#pick .stamp.steal").count() == 1)
        check(f"{label}: results with stamps no overflow", overflow() <= 0, overflow())
        clipped = pg.evaluate("""[...document.querySelectorAll('.sticker, .stamp')].filter(e=>e.scrollWidth > e.clientWidth + 1).length""")
        check(f"{label}: stamps not clipped", clipped == 0, clipped)
        pg.evaluate("document.getElementById('pick').scrollIntoView()"); pg.evaluate("window.scrollBy(0,-70)"); shot("2b-dig-results-token", False)
        pg.click('.tabs button[data-tab="set"]'); pg.uncheck("#premium"); pg.click('.tabs button[data-tab="dig"]')
        locked = pg.locator("#pressings .stamp.locked").count(); check(f"{label}: free tier locks stamps except best", locked == 4, locked)
        pg.click('.tabs button[data-tab="set"]'); pg.check("#premium"); pg.fill("#kDiscogs", ""); pg.press("#kDiscogs", "Tab")
        # eBay token on the web without proxy -> honest note, no eBay call
        pg.fill("#kEbay", "v^1.1#fake"); pg.press("#kEbay", "Tab")
        pg.click('.tabs button[data-tab="dig"]'); pg.click("#digBtn"); pg.wait_for_selector("#ebayNote")
        check(f"{label}: eBay token on web explains it needs the app", "Android app" in pg.inner_text("#ebayNote"))
        pg.click('.tabs button[data-tab="set"]'); pg.fill("#kEbay", ""); pg.press("#kEbay", "Tab")
        # errors: 429, no results, offline
        pg.click('.tabs button[data-tab="dig"]'); pg.fill("#q", "ratelimit test"); pg.click("#digBtn"); pg.wait_for_selector(".status.error")
        t = pg.inner_text("#status"); check(f"{label}: 429 shows friendly slow-down + countdown", "slow down" in t.lower() and "Try again in" in t, t)
        check(f"{label}: links still shown on error", pg.locator("a.site-link").count() == 18)
        check(f"{label}: error state no overflow", overflow() <= 0)
        shot("6-error-429", False)
        pg.fill("#q", "zzqq nothing"); pg.click("#digBtn"); pg.wait_for_selector("#pick .note-card")
        check(f"{label}: no results message", "No vinyl found on Discogs" in pg.inner_text("#pick"))
        ctx.set_offline(True); pg.wait_for_timeout(100)
        pg.fill("#q", "Some Offline Album"); pg.click("#digBtn"); pg.wait_for_selector(".status.error")
        check(f"{label}: offline message", "offline" in pg.inner_text("#status").lower() and "offline" in pg.inner_text("#srcChip").lower())
        ctx.set_offline(False)
        # affiliate tagging
        pg.click('.tabs button[data-tab="set"]'); pg.fill("#aEpn", "5338000000"); pg.press("#aEpn", "Tab")
        pg.click('.tabs button[data-tab="dig"]'); pg.fill("#q", "Portishead Dummy"); pg.click("#digBtn"); pg.wait_for_selector(".pressing")
        eb = pg.get_attribute('a[data-site="ebay"]', "href"); check(f"{label}: EPN id added to eBay links", "campid=5338000000" in eb)
        check(f"{label}: no JS errors", not errors, "; ".join(errors))
        ctx.close()
    # PWA manifest + SW basics
    ctx = b.new_context(); pg = ctx.new_page(); pg.goto(BASE)
    man = pg.evaluate("fetch('manifest.webmanifest').then(r=>r.json())")
    check("manifest: name, standalone, 192+512 icons, maskable", man["name"] == "Bin Raider" and man["display"] == "standalone" and {"192x192", "512x512"} <= {i["sizes"] for i in man["icons"]} and any(i["purpose"] == "maskable" for i in man["icons"]))
    for path in ["icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "sw.js", "fonts/ArchivoBlack-Regular.ttf", "fonts/IBMPlexMono-Regular.ttf", "fonts/IBMPlexMono-Bold.ttf", "fonts/OFL-IBMPlexMono.txt"]:
        st = pg.evaluate(f"fetch('{path}').then(r=>r.status)"); check(f"asset {path} served", st == 200, st)
    sw = pg.evaluate("fetch('sw.js').then(r=>r.text())"); check("sw cache name is 0.2.0", "binraider-0.2.0" in sw)
    check("mono font loaded", pg.evaluate("document.fonts.load('700 16px \"Plex Mono\"').then(f=>f.length>0)"))
    html = pg.content().lower(); check("no Hark branding in app", "hark" not in html)
    ctx.close()
    # real-network smoke check: Discogs without a key, no stubs
    if not NO_REAL:
        prox = proxy_from_env()
        b2 = p.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"], proxy=prox) if prox else b
        ctx = b2.new_context(viewport={"width": 360, "height": 800}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="en-GB"); pg = ctx.new_page()
        pg.goto(BASE + "?q=Portishead%20Dummy")
        try:
            pg.wait_for_selector("#pressings .pressing", timeout=45000)
            n = pg.locator("#pressings .pressing").count(); prices = pg.eval_on_selector_all("#pressings .sticker .st-val", "els => els.map(e => e.textContent)")
            check("REAL NETWORK: Discogs search renders pressings with GBP prices", n >= 1 and any(x.startswith("£") for x in prices), f"{n} pressings, prices {prices}")
            pg.screenshot(path=os.path.join(SHOTS, "real-network-360x800.png"), full_page=True)
        except Exception as e:
            check("REAL NETWORK: Discogs search renders pressings with GBP prices", False, (pg.inner_text("#results")[:200] if pg.locator("#results").count() else "") + " " + str(e)[:100])
        ctx.close()
        if b2 is not b: b2.close()
    b.close()
fails = [r for r in results if r[0] == "FAIL"]
for r in results: print(" | ".join(r))
print(f"\n{len(results)-len(fails)} passed, {len(fails)} failed")
json.dump(results, open(OUT, "w"), indent=1)
sys.exit(1 if fails else 0)
