# Rendering a PDF to look at it

This Mac has no permanent Node, so PDF layout used to be changed blind: parse
with esbuild, push, and let the owner find the breakage. That cost three bad
deploys on the catalogue in one evening — overlapping rows, then a worse mess,
then an orphaned heading — every one of which is obvious the moment you see a
rendered page.

This renders the real component headlessly and rasterises a page.

## One-time: get a Node

```
SCRATCH=<your scratch dir>
curl -sL https://nodejs.org/dist/v24.18.0/node-v24.18.0-darwin-arm64.tar.gz | tar xz -C "$SCRATCH"
mv "$SCRATCH"/node-v24.18.0-darwin-arm64 "$SCRATCH/node"
export PATH="$SCRATCH/node/bin:$PATH"
(cd qa && npm install pdf-lib)     # page extraction only
```

Nothing is installed into the project: `node_modules/` is already committed to
the repo's lockfile and needs no reinstall.

## Each run

```
ESB=$(ls -d node_modules/@esbuild/*/bin/esbuild | head -1)

# 1. bundle. --jsx=automatic or React is undefined at runtime; the font and
#    logo imports are Vite assets, so they need file loaders.
$ESB qa/render-catalogue.jsx --bundle --platform=node --format=cjs \
  --jsx=automatic --loader:.ttf=file --loader:.png=file --loader:.jpg=file \
  --outfile=/tmp/render.cjs

# 2. render, 3. pull one page out (qlmanage only ever rasterises page 1),
#    4. rasterise
node /tmp/render.cjs /tmp/out.pdf
node qa/extract-page.cjs /tmp/out.pdf 2 /tmp/page.pdf
qlmanage -t -s 1500 -o /tmp /tmp/page.pdf     # -> /tmp/page.pdf.png
```

Then open `/tmp/page.pdf.png`.

## Why the harness uses fake data

`render-catalogue.jsx` builds its own products rather than reading Firestore,
so it needs no credentials and can hold the cases that actually break: a card
with six price rows next to one with a single row, long labels, a retired note,
multi-brand row codes, and an odd trailing card. Real data mostly renders fine
and hides all of them.

## What this caught that esbuild could not

- `flex: 1` left on the text block after the card became a column, which made
  every child render on top of the image.
- `flexWrap` used as a grid: react-pdf does not size a wrapped line to its
  tallest child, so tall cards overlapped the line below.
- A section heading stranded at the foot of a page, which `minPresenceAhead`
  did not fix and binding the heading into the first row's `wrap={false}` did.

esbuild reported every one of those files as fine. It parses; it does not lay
out, and it does not resolve identifiers either.
