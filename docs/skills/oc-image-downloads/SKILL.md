---
name: oc-image-downloads
description: Diagnose and verify Operation Center product-image downloads, including Unicode filenames and ordinary approved-customer Chrome clicks that must save complete files while retaining the product page.
---

# OC image downloads

Use for Corporate Gifts or Crystocraft Range image-download failures. This covers
attachment headers, the customer click action and completed-file verification;
image upload, retouching and catalogue PDF layout have separate workflows.
Read [the master router](../SKILL.md) and, for an authorized application release,
[the release workflow](../RELEASE-WORKFLOW.md).

## Locate the failing layer

| Layer | Maintained implementation / check |
|---|---|
| Shared same-origin URL | `src/imageDownloadUrl.js` |
| Attachment response / safe filename | `netlify/edge-functions/download-image.js` |
| Working admin action | `src/components/ImageGallery.jsx` |
| Customer Range action | `src/customer/FigurineDetail.jsx`, `downloadPhoto` |
| Offline endpoint regressions | `qa/download-image.test.mjs` |
| Offline actual-page click regressions | `qa/range-download-click.test.mjs` |
| Build/CI image suite | `npm run test:product-images` |

1. Identify the exact product, image index/caption, source host, displayed name,
   signed-in role and served build. Work with existing records; readback of a
   product does not authorize renaming, duplicating or publishing it.
2. Compare attachment responses for the same source with its real filename and
   an ASCII filename. A Unicode-only HTTP 500 can be response-header construction
   even when the upstream image is valid. A displayed image does not establish
   that the download proxy accepts its source; see lesson L-28.
3. If the endpoint returns valid bytes, test the actual gallery download control.
   Separate an application click/navigation failure from browser permission or
   scanning behavior. `ERR_BLOCKED_BY_CLIENT` alone does not identify its cause.

## Preserve the working contract

- Build same-origin `/api/download-image` links with `imageDownloadUrl`; a direct
  cross-origin Storage link's `download` attribute can be ignored by Chrome.
- Keep the server's quoted ASCII `filename` fallback plus RFC 5987 UTF-8
  `filename*`. Sanitize path/control characters, escape the fallback safely and
  truncate by code point. Do not put raw Chinese/em-dash names in HTTP headers.
- The customer Range normal-click handler prevents default navigation and
  propagation, creates one temporary anchor with the same URL and explicit
  `download` name, appends/clicks/removes it. Keep the rendered anchor's real href
  and named `download` attribute. Use the displayed customer name and caption,
  without exposing an internal design name or opening the lightbox.
- Preserve existing host/bucket/HTTPS, redirect, timeout and size restrictions.
  Optional Firebase raster normalization already exists; WordPress photos and
  non-image assets retain their existing policy. Compare against the bytes the
  chosen endpoint actually serves, not necessarily the pre-normalization object.
- Do not broaden image visibility, alter branding or weaken browser protections
  to make a download test pass.

## Verify the customer's actual action

The success condition is **ordinary Chrome click → completed saved file with
correct name/content → original product page remains open**. A successful HTTP
response, scripted media downloader or download event is supplemental evidence,
not a substitute for that sequence.

- Use an authorized approved-customer QA identity in a dedicated tab/session.
  Keep the owner's working session intact. Coordinate foreground access only
  when native controls are needed; stop native actions if the owner switches work.
- Take a filename/directory baseline before clicking. Accept only a newly saved
  complete file for that action, never an old copy or `.crdownload`. Chrome's
  numeric suffix is legitimate when an earlier copy exists.
- Exercise a real WordPress photo with slash/brackets and a Firebase photo with
  ampersands. Chinese, accents, dashes, quotes and emoji belong in endpoint/page
  fixtures when no matching live product exists; do not rename live products for QA.
- Record saved filename, byte length, decoded format/dimensions and SHA256, and
  compare with the expected served bytes. Check the product URL, customer shell
  and lightbox state after clicking and refreshing.
- A new pinned/preview origin may ask to download multiple files. During an
  authorized repeated-download test, handle only that origin's normal prompt.
  Do not disable global protections, Safe Browsing or extensions. Record the
  origin/permission so browser state is not misreported as an application cause.
- With native Chrome, inspect fresh accessibility state and bind the dedicated
  QA tab. When navigation requires keys, focus the actual address field, paste,
  read back the address and only then submit. Global shortcuts alone did not
  reliably focus the intended Chrome window in this session.

### Observed tool limitation — avoid repeating the stall

In this Mac/Cua session, `downloadMedia` stalled for about 50 minutes and a
`waitForEvent('download')` attempt stalled for about 19 minutes despite short
requested timeouts; leaving the observer unawaited did not avoid the stall.
These are recorded tool/environment observations, not browser-wide guarantees.
Use the supported normal/native tab click plus bounded local file readback here.
After a stall, inspect whether a file already arrived before repeating a click.
Do not substitute a helper download or an alternate browser surface to bypass a
tool URL-policy rejection. Use only the APIs exposed by the current browser tool.

## Release and closeout evidence

Run the image suite and relevant checks, then follow the existing exact-SHA
two-job and fresh candidate/production two-role gates. Do not promote a candidate
whose ordinary customer download is still FAIL/BLOCKED, even if CI and login pass.
Reuse the verified artifact; rerun gates after source/artifact changes.

For manual prebuilt Netlify publication, rerun `npm run release:ci -- --wait`
immediately before each upload. Do not combine `--context production` with
`--no-build`. Bind a deploy with null `commit_ref` to its source through the
clean release SHA, CI results, artifact manifest and served build identity.

Record canonical-site role checks separately from pinned-artifact Chrome clicks,
including browser, URL/origin, role, source host, file readback and page retention.
Do not claim a main-domain Chrome test when it ran on the exact production pin.
Keep credentials, Storage tokens, raw records and downloads in ignored evidence;
commit only the redacted findings and links. Documentation-only closeout is not
a new app release; authorized pushes use `[skip netlify]` and production readback.

Historical reproductions and completed releases:

- [Unicode attachment-header correction](../../plans/V8.20-IMAGE-DOWNLOAD-FILENAME.md)
- [Normal customer Chrome clicks and release evidence](../../plans/V8.20-RANGE-CUSTOMER-DOWNLOAD-CLICKS.md)
- [Lessons L-69–L-71](../LESSONS-LEARNED.md#l-69--a-valid-image-failed-to-download-because-its-filename-was-unicode)

Those passes describe the recorded 30 October 2026 artifacts. Future releases
require new evidence; historical deploy IDs or hashes are not current approval.
