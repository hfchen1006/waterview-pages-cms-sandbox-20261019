# Astro Content CMS Sandbox

All listings, articles, names, locations, citations and images are fictional.
The PNG fixtures are deterministic color patterns, not photographs. This project
contains no real property information and is not a production website.

This standalone Astro project tests Pages CMS JSON and Markdown editing. The first
hosted Save omitted nullable number fields; its comparison evidence remains at
[sandbox commit 401d70b](https://github.com/hfchen1006/waterview-pages-cms-sandbox-20261019/commit/401d70beb6b7a371896fb1e2540cacfd45897314).
This local version adds explicit Not Set / Known / Unknown controls and a build-time adapter.
The updated configuration still requires hosted Save tests. No CMS server,
deployment workflow or hosting adapter is included. Saving must not deploy to
production; candidate validation and release approval are separate steps.

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
npm run test:unit
npm run test:integration
npm run build
node --input-type=module -e "import { outputAudit } from './tests/helpers.ts'; const { html, ...audit } = await outputAudit(); console.log(JSON.stringify(audit, null, 2));"
```

`npm test` includes schema, Markdown security and production-artifact regressions.
Integration tests temporarily change synthetic fixtures, restore them in `finally`,
and write local reports. Do not edit content or run another build concurrently.
Forced termination can prevent restoration. The current hosted fixtures include
studio rent of zero, an Unknown floor area, and an Unknown guide date. Tests
normalize those state markers before canonical checks, and date scenarios replace
parsed fields rather than relying on the old literal `updatedDate: null` line.
The empty-body scenario uses captured frontmatter so it works with LF or CRLF.
Review further CMS-authored edits separately before running the suite.
`reports/test-results.json` records the candidate scenarios and final artifact
inventory. The standalone audit checks the final fresh build, including image
hashes and decoded pixels, unpublished markers, and internal-file exclusions.

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

The CMS configuration disables content rename/delete and inline media controls,
but those UI settings are not repository permissions.

## Not Set / Known / Unknown editing

Each measurement has an adjacent question: is the rent, bedroom count, bathroom
count, or floor area known? The verified update date has the same choice.

- Choose **Known** and enter the actual value.
- Choose **Unknown** and clear its value. Clearing a value alone does not declare
  unknown intent and will fail a Published candidate.
- Choose **Not Set** to return from Known or Unknown to a neutral state. It removes
  only the CMS state marker during validation: any saved valid number (including
  zero), date, or explicit null is preserved. An omitted value stays omitted.
  It does not clear a saved value or create zero, null, or today's date.
- A missing value with Not Set remains incomplete in Draft or Hidden content and
  fails Published readiness. An unselected choice has the same local behavior.
- Zero rent means actual zero rent. Zero bedrooms means Studio. Unknown bedrooms
  means an unknown bedroom count. Decimal bathrooms remain valid.
- Enter a verified calendar date only. The date control retains `default: ''`;
  no adapter logic creates today's date.

The state controls have no default and are not required by the CMS. Numeric fields
are also not marked required: the publication model decides readiness, and the
CMS must not manufacture zero from a required blank field. An explicit Known
choice with no value is inconsistent and fails validation even in Draft/Hidden.

When editing an existing null through hosted Pages CMS, select Unknown before
saving: the CMS may omit the original null. The local adapter never rewrites the
authored files and cannot make the hosted CMS retain raw nulls. Not Set cannot
recover a value that the hosted editor has already omitted. Verify raw Save/reopen
results before relying on this transition in the hosted editor.

For example, a CMS-authored property can contain:

```json
{
  "monthlyRentState": "unknown",
  "bedroomsState": "known",
  "bedrooms": 0
}
```

In the validated model, rent becomes null and bedrooms remains numeric zero.
These are field examples; a Published entry still needs every other required field.

## Compatibility and validation boundary

`src/lib/content/cms-compat.ts` exports the same compatibility schemas used by
Content Collections (`src/content.config.ts`) and published-media staging
(`src/lib/content/stage-media.ts`). Both paths normalize raw input before the
unchanged canonical storage schemas validate it. Existing publication-readiness
schemas, image validation, Markdown security, and publication filters remain
authoritative. CMS-only state keys are removed from validated data. Article
frontmatter is also read with the same shared raw YAML parser in both paths.
The Content Collections glob loader delegates parsing through this boundary so
unquoted date scalars remain strings. This avoids Astro's automatic timestamp
conversion without accepting Date objects or hiding an invalid calendar date.

The adapter only recognizes `monthlyRentState`, `bedroomsState`, `bathroomsState`,
`squareFeetState`, and `updatedDateState`, paired with their corresponding values.
State strings must be exactly `not-set`, `known` or `unknown` when supplied.

| State | Supplied value | Result |
| --- | --- | --- |
| Omitted | Valid number/date | Preserve the legacy value |
| Omitted | Explicit null | Preserve legacy null |
| Omitted | Value omitted | Remain absent; Published readiness fails |
| `not-set` | Valid number/date or explicit null | Remove only the marker; preserve the value |
| `not-set` | Value omitted | Remove only the marker; remain absent; Published readiness fails |
| `unknown` | Value omitted or null | Canonical null |
| `unknown` | Any non-null value, including zero or empty string | Fail as conflicting input |
| `known` | Valid non-null value | Preserve the value |
| `known` | Value omitted or null | Fail with a field-specific message |
| Any/omitted | Invalid string, negative number, fractional bedrooms, invalid date | Fail |

No empty string is interpreted as an omitted value. Pages CMS normally omits
blank fields on Save; a raw `""` in JSON/YAML is invalid, including when Unknown
is selected. No numeric coercion, fallback date, image repair, or general
missing-to-null conversion is performed.

An inconsistent edit reports an error such as: `monthlyRent is marked Unknown
but still contains a value. Clear the value or choose Known.` Missing unmarked or Not Set
Published values still fail the canonical readiness schema. Failed candidate
builds remove the previous local `dist` first, so stale successful output cannot
be mistaken for the failed candidate. Always check the build exit code.

## Hosted checks and future reviewed sandbox update

Local tests cannot establish the hosted editor's serialization behavior. After
review, use only `hfchen1006/waterview-pages-cms-sandbox-20261019`, branch
`cms-experiment`; retain commit `401d70b` and its parent as comparison evidence.
Do not update `main` or the real website repository for this experiment.

1. Review the five files for this Not Set update: `.pages.yml`, `README.md`,
   `src/lib/content/cms-compat.ts`, `tests/schemas.test.ts`, and
   `tests/build.test.ts`. Run all local checks above before preparing an update.
2. Inspect the current sandbox branch and diff before a separately approved
   source-only update. Exclude generated files, dependencies, reports and local
   environments. Do not force-push or rewrite the comparison evidence.
3. Confirm the experiment branch has no automatic production-deployment path.
   This local implementation does not configure or prove an external release gate.
4. In new disposable synthetic entries, test each number's null/zero/positive
   value, clearing and re-entry, Known/Unknown-to-Not-Set transitions, unselected states,
   decimal bathrooms, and repeated Save/reopen. Check exact raw state strings and
   numeric types. Unknown must save its state while the blank value may disappear.
   Not Set must save as `not-set` without changing any value the editor retains;
   check zero, explicit null, omitted values, and verified dates after Save/reopen.
5. Test missing/null/cleared/verified dates and repeated Save/reopen without an
   invented date. Test an optional cover removed completely, incomplete image
   metadata, and Draft/Hidden exclusions. Merge-mode object deletion remains an
   unresolved hosted behavior; this adapter does not repair or bypass it.
6. Inspect raw committed files after each Save and validate a separate local
   candidate copy. Confirm contradictory/missing Published inputs fail and the
   public artifact contains only approved Published text and assets. Approval to
   update the sandbox branch is not approval to merge or deploy.

The editor may save contradictory values because its native form does not enforce
the cross-field state rule. The candidate build is the authoritative gate. An
upstream coercion that has already written a numeric zero cannot be distinguished
from an intentional zero downstream; avoiding defaults and reviewing raw diffs
remain necessary. Re-run hosted tests when the CMS changes. A maintainer owns the
adapter and release checks; George should use the controls without editing JSON.

**A public GitHub repository exposes every source file, including Draft and Hidden
text and images, independently of publication filtering. Keep all data fictional.**

Upload source files only. Never upload dependencies, caches, generated output,
local reports, environment files or credentials. `.gitignore` helps Git users;
browser uploads still require deliberate file selection. Run validation in a
separate local copy before preparing another source-only upload.
