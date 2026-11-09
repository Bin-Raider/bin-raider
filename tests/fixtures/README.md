Test fixtures for Bin Raider.
- search-portishead.json: real response from GET https://api.discogs.com/database/search?q=portishead+dummy&type=release&format=vinyl&per_page=8 (no token), captured 9 Nov 2026. Note: without a token Discogs returns empty thumb/cover_image.
- stats-{id}.json: real responses from GET /marketplace/stats/{id}?curr_abbr=GBP (no token), captured 9 Nov 2026.
- price-suggestions-sample.json: doc-shaped sample (endpoint needs a token); values invented for tests.
- search-empty.json: a no-results response.
