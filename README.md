# Bin Raider (0.2.0)

UK second-hand vinyl deal finder. Plain HTML/CSS/JS in `www/` (no build step), wrapped for Android with Capacitor in `android/`.

- `www/js/deal.js` deal maths (total, grade-adjusted reference, 0-100 score, verdict)
- `www/js/sites.js` deep links to 18 UK searches + affiliate tagging (EPN, Amazon)
- `www/js/data.js` live price data, official APIs only (never scrapes):
  - **Discogs, no key needed (default).** `GET /database/search?type=release&format=Vinyl` once per search, then
    `GET /marketplace/stats/{id}?curr_abbr=GBP` for the top 5 pressings (lowest listed price + number for sale).
    Responses are cached in memory + localStorage for 1 hour, and a rolling limiter keeps calls under
    22/min without a token (55/min with one), so we wait instead of hitting Discogs' 429.
  - **Optional Discogs personal token** (Settings): sent as `Authorization: Discogs token=…`; adds
    `GET /marketplace/price_suggestions/{id}` → "Discogs suggested VG+ price", which is the reference for deal stamps.
    Without a token there is no reference, so no deal score is invented.
  - **eBay Browse API**: only when an eBay token is set. Works natively in the Android app (CapacitorHttp).
    Browsers block it (no CORS), so the PWA needs a proxy: set `config.proxyBase` in `data.js` to a server that
    forwards `GET {proxyBase}/buy/browse/v1/...` to `https://api.ebay.com/buy/browse/v1/...` with the same headers.
    Left blank (default), the web app shows "eBay live prices coming soon" and the eBay link.
  - Native requests go through `Capacitor.Plugins.CapacitorHttp` with User-Agent `BinRaider/0.2 +https://bin-raider.github.io/bin-raider/`
    (`capacitor.config.json` → `plugins.CapacitorHttp.enabled: true`). Web uses `fetch` (browsers don't let pages set User-Agent).
- `www/js/app.js` UI: Dig, Wantlist (on device), Deal calculator, Settings
- Fonts (OFL, licences in `www/fonts/`): Archivo Black (headings), IBM Plex Mono (prices, labels).

## Run
- Try in a browser: `npm run serve` then open http://localhost:8080
- Unit tests: `npm test` (Discogs fetch mocked with captured fixtures in `tests/fixtures/`)
- UI tests: `NO_PROXY=127.0.0.1 python3 -m http.server 8765 --directory www &` then `python3 tests/ui.test.py`
  (Playwright + Chromium at /usr/bin/chromium; Discogs stubbed with route() fixtures, plus one real-network Discogs smoke check.
  Options: a size name like `galaxy-a` to run one size, `--no-real` to skip the network check.)
- Android: `npm install && npx cap sync android && npx cap open android` (Android Studio), or push to GitHub and the workflow builds a debug APK.

## Before Play release
- eBay Browse API needs an OAuth application token minted server-side (client secret must not ship in the app). Plan: a tiny serverless function, which can double as the PWA's `proxyBase`.
- Premium billing via Google Play Billing (subscriptions), not built yet.
- Wantlist alerts need background checks + notifications (Premium), not built yet.
