---
name: appstore-data
description: Use when a task needs live App Store or Google Play data (app details, reviews, rankings, keyword search).
---

# App Store + Google Play data

Call these MCP tools instead of scraping or guessing app metadata.

## When to use

- Comparing apps (ratings, review counts, price, release version) across storefronts
- ASO work: keyword search results, category rankings, chart positions
- Review mining: recent complaints, developer reply latency, version-specific feedback
- Any question about what is actually live in a store right now

## How to use

1. `search_apps` when you only have a name. It returns `id` — numeric for iOS, package name for Android.
2. `get_app` with that id for full metadata.
3. `get_app_reviews` for sentiment work. `sort=recent` for monitoring, `sort=helpful` for the loudest opinions.
4. `top_charts` for "what is popular" questions; `list_categories` to resolve a category id.

## Rules that avoid wrong answers

- Pass `country` deliberately. The storefront changes the catalogue, the currency and the ranking — an app that exists in `us` can 404 in `jp`.
- Do not page reviews past `has_more: false`; a short page is not a signal to stop.
- `rating_count` is the number of ratings the store reports, not the number of reviews you can fetch.
- Prices are in the storefront's currency; use `is_free` for a store-agnostic check.
- Every tool returns trimmed records — `description` is truncated to keep responses inside client limits.
