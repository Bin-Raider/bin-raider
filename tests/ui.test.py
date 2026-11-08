"""Bin Raider UI tests: runs the app in Chromium at phone sizes and checks the main flows."""
import json, sys
from playwright.sync_api import sync_playwright
BASE = "http://127.0.0.1:8765/index.html"
SIZES = [("small-320x640", 320, 640), ("galaxy-a-360x800", 360, 800), ("pixel-8-412x915", 412, 915), ("galaxy-s24-ultra-480x1040", 480, 1040)]
results = []
def check(name, cond, detail=""):
    results.append(("PASS" if cond else "FAIL", name, detail))
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])
    for label, w, h in SIZES:
        ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="en-GB")
        pg = ctx.new_page(); errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.goto(BASE); pg.wait_for_timeout(400)
        def overflow(): return pg.evaluate(f"Math.max(document.documentElement.scrollWidth, window.innerWidth) - {w}")
        check(f"{label}: home loads, mock chip visible", pg.locator("#modeChip").inner_text() == "MOCK DATA")
        check(f"{label}: home no horizontal overflow", overflow() <= 0, str(overflow()))
        for v in ["want", "calc", "set"]:
            pg2 = ctx.new_page(); pg2.goto(BASE + "?fresh=" + v + "#" + v); pg2.wait_for_timeout(300)
            ov = pg2.evaluate(f"Math.max(document.documentElement.scrollWidth, window.innerWidth) - {w}")
            check(f"{label}: {v} view (fresh load) no horizontal overflow", ov <= 0, str(ov)); pg2.close()
        pg.screenshot(path=f"tests/screens/{label}-1-home.png")
        pg.fill("#q", "Portishead Dummy"); pg.click("#digBtn"); pg.wait_for_selector(".listing")
        check(f"{label}: search shows mock banner", pg.locator(".mock-banner").count() == 1)
        n = pg.locator(".listing").count(); check(f"{label}: 8 listings", n == 8, str(n))
        links = pg.locator("a.site-link").count(); check(f"{label}: 18 shop links", links == 18, str(links))
        hrefs = pg.eval_on_selector_all("a.site-link", "els => els.map(e => [e.dataset.site, e.href, e.target])")
        check(f"{label}: links open in new tab with query", all(t == "_blank" and "Portishead" in hr for _, hr, t in hrefs))
        check(f"{label}: results no horizontal overflow", overflow() <= 0, str(overflow()))
        pg.screenshot(path=f"tests/screens/{label}-2-results.png", full_page=True)
        # tap targets
        small = pg.evaluate("""[...document.querySelectorAll('.tabs button, .btn, a.site-link')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.height<36||r.width<44)}).length""")
        check(f"{label}: tap targets >= 36px tall", small == 0, str(small))
        # check deal -> calculator
        pg.locator(".listing .btn", has_text="Check deal").first.click(); pg.wait_for_timeout(200)
        check(f"{label}: Check deal opens calculator prefilled", pg.locator("#view-calc").is_visible() and pg.input_value("#cPrice") != "" and pg.locator("#calcOut .score").count() == 1)
        pg.screenshot(path=f"tests/screens/{label}-3-calc.png", full_page=True)
        # manual calc: 12 + 3.5 vs 20 VG+ -> total 15.50, score 53 fair
        pg.fill("#cPrice", "12"); pg.fill("#cPost", "3.50"); pg.select_option("#cGrade", "VG+"); pg.fill("#cRef", "20")
        check(f"{label}: calculator maths 12+3.50 vs 20", "£15.50" in pg.inner_text("#calcOut") and pg.inner_text("#calcOut .score .n") == "78", pg.inner_text("#calcOut")[:80])
        check(f"{label}: calc no horizontal overflow", overflow() <= 0)
        # want from result
        pg.click('.tabs button[data-tab="dig"]'); pg.locator(".listing .btn", has_text="Want").first.click()
        pg.click('.tabs button[data-tab="want"]'); pg.wait_for_timeout(100)
        check(f"{label}: Want adds to wantlist", pg.locator(".want").count() == 1)
        pg.fill("#wQ", "Massive Attack Mezzanine"); pg.fill("#wT", "100"); pg.click("#wantForm button")
        pg.click("#checkAll"); pg.wait_for_function("document.getElementById('checkAll').textContent==='Check prices'")
        check(f"{label}: Check prices flags item below £100 target", pg.locator(".want.hit").count() >= 1)
        pg.reload(); pg.wait_for_timeout(300); pg.click('.tabs button[data-tab="want"]')
        check(f"{label}: wantlist survives reload (saved on device)", pg.locator(".want").count() == 2)
        check(f"{label}: wantlist no horizontal overflow", overflow() <= 0)
        pg.screenshot(path=f"tests/screens/{label}-4-want.png", full_page=True)
        # settings: premium off locks scores, live switch label
        pg.click('.tabs button[data-tab="set"]'); pg.uncheck("#premium")
        pg.click('.tabs button[data-tab="dig"]'); pg.fill("#q", "Portishead Dummy"); pg.click("#digBtn"); pg.wait_for_selector(".listing")
        locked = pg.locator(".listing .score.locked").count(); check(f"{label}: free tier locks scores except best", locked == 7, str(locked))
        pg.click('.tabs button[data-tab="set"]'); pg.check('input[name="mode"][value="live"]', force=True)
        check(f"{label}: Live switch relabels chip", pg.locator("#modeChip").inner_text() == "LIVE DATA")
        pg.screenshot(path=f"tests/screens/{label}-5-settings.png", full_page=True)
        pg.click('.tabs button[data-tab="dig"]'); pg.click("#digBtn"); pg.wait_for_timeout(800)
        check(f"{label}: Live with no keys degrades gracefully", "Add a Discogs token" in pg.inner_text("#snapshot") and pg.locator("a.site-link").count() == 18)
        # affiliate tagging
        pg.click('.tabs button[data-tab="set"]'); pg.fill("#aEpn", "5338000000"); pg.press("#aEpn", "Tab"); pg.check('input[name="mode"][value="mock"]', force=True)
        pg.click('.tabs button[data-tab="dig"]'); pg.click("#digBtn"); pg.wait_for_selector(".listing")
        eb = pg.get_attribute('a[data-site="ebay"]', "href"); check(f"{label}: EPN id added to eBay links", "campid=5338000000" in eb)
        check(f"{label}: no JS errors", not errors, "; ".join(errors)[:200])
        ctx.close()
    # PWA manifest + SW basics
    ctx = b.new_context(); pg = ctx.new_page(); pg.goto(BASE)
    man = pg.evaluate("fetch('manifest.webmanifest').then(r=>r.json())")
    check("manifest: name, standalone, 192+512 icons, maskable", man["name"] == "Bin Raider" and man["display"] == "standalone" and {"192x192", "512x512"} <= {i["sizes"] for i in man["icons"]} and any(i["purpose"] == "maskable" for i in man["icons"]))
    for path in ["icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "sw.js", "fonts/ArchivoBlack-Regular.ttf"]:
        st = pg.evaluate(f"fetch('{path}').then(r=>r.status)"); check(f"asset {path} served", st == 200, str(st))
    html = pg.content().lower()
    check("no Hark branding in app", "hark" not in html)
    b.close()
fails = [r for r in results if r[0] == "FAIL"]
for r in results: print(" | ".join(r))
print(f"\n{len(results)-len(fails)} passed, {len(fails)} failed")
json.dump(results, open("tests/ui-results.json", "w"), indent=1)
