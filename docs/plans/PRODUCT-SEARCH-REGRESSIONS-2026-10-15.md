# Automated catalogue search regressions — V8.18

Tests render the actual four catalogue pages (admin Range/Products, customer FigurineShop/CorporateShop) with in-memory Firestore snapshots in JSDOM. Production search, row identity, category/status filters, pagination, saved storage values, URL constraints and customer visibility logic remain unchanged. Remote services and unrelated rendering widgets are mocked; all network calls and Firestore writes are forbidden.

27 component tests cover repeated queries, case, no matches/clear, duplicate names/codes/SKUs, results beyond page1, page reset, delayed loading with saved filters, obsolete category repair, remount restoration, live new-product snapshots, saved availability filters, design/SKU queries, URL design/format narrowing and sensitive-customer image exclusion. Duplicate-key warnings are fatal.

`npm run test:product-search` also includes existing quote/filter regressions: **39/39 passed**. The broader catalogue/carousel/availability/config suite: **80/80 passed**. Production build and no-undefined lint pass (existing bundle-size advisory only).

Mutation verification: temporarily replacing each grid's product-ID key with a repeated code/name makes its repeated-search test fail, for all four pages. Each source was restored immediately. The same mutation also stops `npm run build` during prebuild, before Vite compilation. No application source changes remain.

Automation: `prebuild` runs the search suite before every normal application build, including Netlify Git deployments. Local Node20 verification mirrors the hosting runtime. A standalone GitHub Actions workflow was attempted but GitHub rejected the push because the current Personal Access Token lacks `workflow` scope. The unpushed workflow was removed from the commit; no token or account permissions were expanded and branch protection settings were not changed. Build-time regression protection remains active.

This is a test/build-tooling change. The commit uses `[skip netlify]` to retain the already verified production application. No app or Firebase rules deployment and no live product/quote/account mutations.
