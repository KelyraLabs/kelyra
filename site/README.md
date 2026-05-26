# Kelyra Site

Static marketing UI for Kelyra. It is intentionally original and keeps product
copy, assets, and layout code owned by this repo.

Preview as a static site:

```bash
cd site
python3 -m http.server 4340
```

Open `http://127.0.0.1:4340/`.

Run with the local CLI proof bridge:

```bash
npm run build
node dist/cli.js console
```

The bridge intentionally exposes local proof routes under `/api/local/*`.
Hosted/public backend routes belong under `/api/*`.
