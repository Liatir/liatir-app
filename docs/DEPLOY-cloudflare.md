# Deploying the Liatir docs + mailing list to Cloudflare Pages

The `docs/` directory is a self-contained Cloudflare Pages project:

- **Static site** — VitePress, built to `.vitepress/dist`.
- **Mailing-list API** — a Pages Function at `functions/api/subscribe.ts` (`POST /api/subscribe`).
- **Storage** — a D1 database (`subscribers` table, see `schema.sql`).
- **Anti-spam** — Cloudflare Turnstile.

All commands below are run **from inside `docs/`**.

---

## 0. Install dependencies

`wrangler` is a local dev dependency of this folder, so install once and call it
via `npx` (no global install needed):

```bash
cd docs
npm install
npx wrangler login
```

## 1. Create the D1 database

```bash
npx wrangler d1 create liatir-mailing-list
```

Copy the printed `database_id` into `wrangler.toml` (replace `REPLACE_WITH_YOUR_D1_DATABASE_ID`).

Create the table (run once against production):

```bash
npx wrangler d1 execute liatir-mailing-list --remote --file=./schema.sql
```

## 2. Create a Turnstile widget

Cloudflare dashboard → **Turnstile** → add a widget for your docs domain. You get:

- a **Site Key** (public) → used by the frontend.
- a **Secret Key** (private) → used by the function.

Set the **site key** as a **build-time** env var for the Pages project
(Settings → Environment variables, for Production *and* Preview):

```
VITE_TURNSTILE_SITE_KEY = <your site key>
```

> ⚠️ Vite inlines `VITE_*` variables **when `vitepress build` runs**, not at
> runtime. So this must be set as a *build* variable and you must **redeploy**
> after adding it. If the widget shows *"For testing only. If seen, report to
> site owner"*, the build fell back to the test key — the variable wasn't present
> at build time. (Setting it only as a Function/runtime variable has no effect on
> the frontend.)

Set the **secret key** as an encrypted secret (used by the Function at runtime):

```bash
npx wrangler pages secret put TURNSTILE_SECRET
```

**Local build:** copy `.env.example` to `.env` and put your site key there, then
`npm run build`.

> Until you set a real site key, the form falls back to Cloudflare's test key
> (`1x00000000000000000000AA`, always passes) so it works locally.

## 3. Deploy

### Option A — Git integration (recommended)

This `docs/` folder is a standalone project (`docs/package.json`), so in the
Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**:

| Setting | Value |
| --- | --- |
| Root directory | `docs` |
| Build command | `npm ci && npm run build` |
| Build output directory | `.vitepress/dist` |

Then bind D1 (**Settings → Functions → D1 database bindings**): variable `DB` → `liatir-mailing-list`.
Add the env var `VITE_TURNSTILE_SITE_KEY` and the secret `TURNSTILE_SECRET`.

### Option B — Direct upload with Wrangler

```bash
# from repo root
npm run docs:build
# from docs/
npx wrangler pages deploy .vitepress/dist
```

Wrangler picks up `functions/`, `wrangler.toml` (D1 binding) and the built assets.

---

## Reading signups

```bash
npx wrangler d1 execute liatir-mailing-list --remote --command "SELECT email, created_at, country FROM subscribers ORDER BY created_at DESC;"
```

## Reverting to the full landing at launch

The pre-launch page is `.vitepress/theme/HomePage.vue`. The full released landing
is preserved at `.vitepress/theme/HomePage.released.vue`. To switch back, copy the
released file over `HomePage.vue` (it is otherwise unimported and not routable).
