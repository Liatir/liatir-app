# Website download click counts

The public website counts activations of the five final download buttons in
`docs/.vitepress/theme/DownloadPage.vue`: macOS DMG, Microsoft Store, Linux
AppImage, DEB and RPM. Links that only open the download page are not counted.
Counts describe clicks, not completed downloads, unique visitors or installations.

The browser sends a same-origin POST to `/api/download-click?button=...`, with
`keepalive` and omitted credentials. It never waits before following the original
link. Left clicks, keyboard activation and middle clicks are counted; unavailable
assets and right clicks are not. Failure to count never prevents a download.

The Pages Function in `docs/functions/api/download-click.js` validates the method,
origin and a fixed allowlist, then atomically increments one aggregate row. The
only columns are UTC day, button and click count. No individual event, IP address,
user agent, referrer, identifier, cookie or local-storage access is added. Hosting
and security processing by Cloudflare is separate and remains disclosed in the
public Privacy Policy. A public unauthenticated counter is approximate: it does
not deduplicate visitors or provide bot-proof measurement.

## Cloudflare configuration

The existing Pages project is `liatir-docs` in account
`e02001dce662ad2c8c0e74aaf5c69384`. `docs/wrangler.toml` binds `DOWNLOAD_CLICKS` to
the EU-jurisdiction D1 database `liatir-download-clicks`, ID
`b379d786-b9a2-42a3-bb2e-744441b7fd5e`. Preview deployments explicitly omit the
binding to avoid contaminating production counts. Local development uses a local
D1 simulation, never the remote database.

Apply the tracked schema before the first production deployment:

```sh
npx wrangler d1 migrations apply liatir-download-clicks --config docs/wrangler.toml --remote
```

Read the counts from the terminal or Cloudflare's D1 console; there is no public
read endpoint or additional dashboard:

```sh
npx wrangler d1 execute liatir-download-clicks --config docs/wrangler.toml --remote --command "SELECT day, button, clicks FROM download_clicks ORDER BY day DESC, button"
```

The migration is `docs/migrations/0001_download_clicks.sql`; focused regression
coverage lives in `tests/unit/docs-download-clicks.test.ts`. The website UI is
verified in a browser driven entirely from the terminal. Native desktop UI tests
are unrelated to these public-site buttons.

## Activation and verification receipt — 2026-10-12

- Remote migration `0001_download_clicks.sql` applied successfully; the live table
  schema and EU database identity were read back.
- All seven repository `test:verify` gates passed, run
  `2026-10-12T13-33-57-387Z`, including 88 unit files / 687 tests. The first attempt
  lacked installed frontend/CLI dependencies and generated SvelteKit configuration;
  installing the existing lockfiles and preparing existing build inputs resolved it.
  No dependency manifest or lockfile was changed.
- The public docs build and Pages Functions compilation passed. Terminal-driven
  headless Chrome checks covered all five buttons, keyboard activation, middle
  clicks, excluded right clicks and unavailable assets, mobile width, and continued
  navigation when tracking fails. Method and foreign-origin guards were exercised.
- Production Pages deployment `a61178d8-c3fd-4005-96ec-27394c12e389`, branch `main`,
  was verified through Wrangler and `https://liatir.com/download`. The live site
  serves the tested frontend bundle. GET returned 405, a foreign origin returned
  403, an unknown button returned 400, and a valid POST returned 204.
- The live test produced exactly one `macos-dmg` click on UTC day `2026-10-12` in
  the expected D1 database. That synthetic contribution was subtracted atomically;
  the remaining test count was verified as zero. A zero-count aggregate row may
  remain and does not represent a download.
- This was a direct Pages upload of the reviewed working tree with
  `commit-dirty=true`, based on `63bf9f3f5c2e97d995c2b6bda6c922620138dd13`.
  At initial activation, the source changes were local and uncommitted. The owner
  subsequently authorized committing and pushing all reviewed changes to
  `origin/main`; the verified source publication receipt follows below.
- Syngraphe's strict check passes. Three pre-existing homepage links in current
  status were corrected from one excess parent directory to their existing files.
  Unrelated pre-existing Quenta seed drift regenerated during verification was
  restored to the original tracked content; privacy pages are excluded from that
  retrieval corpus. No desktop behavior or scientific content was changed.
