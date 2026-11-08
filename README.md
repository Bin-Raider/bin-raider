# Bin Raider (prototype 0.1)

UK second-hand vinyl deal finder. Plain HTML/CSS/JS in `www/` (no build step), wrapped for Android with Capacitor in `android/`.

- `www/js/deal.js` deal maths (total, grade-adjusted reference, 0-100 score, verdict)
- `www/js/sites.js` deep links to 18 UK searches + affiliate tagging (EPN, Amazon)
- `www/js/data.js` price data: MOCK (default) or LIVE (Discogs API + eBay Browse API, official APIs only)
- `www/js/app.js` UI: Dig, Wantlist (on device), Deal calculator, Settings

## Run
- Try in a browser: `npm run serve` then open http://localhost:8080
- Tests: `npm test` (unit) and `python3 tests/ui.test.py` (UI at phone sizes, needs Chromium + Playwright)
- Android: `npm install && npx cap sync android && npx cap open android` (Android Studio), or push to GitHub and the workflow builds a debug APK.

## Before Play release
- eBay Browse API needs an OAuth application token minted server-side (client secret must not ship in the app). Plan: a tiny serverless function.
- Premium billing via Google Play Billing (subscriptions), not built yet.
- Wantlist alerts need background checks + notifications (Premium), not built yet.
