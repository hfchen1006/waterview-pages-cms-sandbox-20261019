# Astro Content CMS Sandbox

All listings, articles, names, locations, citations and images are fictional.
The PNG fixtures are deterministic color patterns, not photographs. This project
contains no real property information and is not a production website.

This standalone Astro project prepares an experiment with Pages CMS JSON and
Markdown editing. `.pages.yml` is a configuration candidate; hosted editing,
uploads, previews and save serialization have not been verified. No CMS server,
GitHub integration, deployment workflow or hosting adapter is included.

## Install and develop

Use Node 24+ and npm 9.6.5+. From this directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run dev
```

Development and preview bind to the loopback interface. On Windows, use `npm.cmd`
instead of `npm` if PowerShell blocks the npm script wrapper.

## Validate and build

```sh
npm run check
npm test
npm run build
npm run preview
```

`npm test` includes schema, Markdown security and production-artifact regressions.
Integration tests temporarily change synthetic fixtures, restore them in `finally`,
and write local reports. Do not edit content or run another build concurrently.
Forced termination can prevent restoration. The suite expects the supplied
baseline fixtures; review CMS-authored edits separately before running it.

## Publication behavior

New content defaults to **Draft**. Only **Published** entries are rendered and
have media staged into the built artifact. **Hidden** entries are excluded after
a fresh rebuild. Availability is independent of publication status. Invalid
published entries fail validation; zero published properties shows Coming Soon.

CMS form controls do not replace Astro's checks. Markdown links allow HTTPS,
single-slash site paths and local fragments. Unsafe links, actual inline images
and raw HTML are rejected; literal code examples remain supported. The CMS's own
preview renderer remains a separate, unverified surface.

## Images and editing limits

Structured image fields reference flat lowercase PNG names under
`src/assets/uploads`, with alt text and usage metadata. A build stages only
published originals and generated WebPs. Do not put uploads in a public folder
or replace references with external URLs. Restart development after media/status
changes. Hosted/CDN deletion and cache invalidation are outside this experiment.

Authorization metadata is an assertion, not a proof of rights. Originals are
copied unchanged; do not add private metadata or real photos. Recreate synthetic
fixtures, when needed, with `node scripts/generate-images.mjs`.

Pages CMS blank/null number and date saving is unresolved. Unknown values must
not become zero or an invented date. Preserve zero bedrooms for Studio, fractional
bathrooms and explicit nulls. The CMS configuration disables content rename/delete
and inline media controls, but those UI settings are not repository permissions.

**A public GitHub repository exposes every source file, including Draft and Hidden
text and images, independently of publication filtering. Keep all data fictional.**

Upload source files only. Never upload dependencies, caches, generated output,
local reports, environment files or credentials. `.gitignore` helps Git users;
browser uploads still require deliberate file selection. Run validation in a
separate local copy before preparing another source-only upload.
