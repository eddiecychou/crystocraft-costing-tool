// One rule: no-undef. A name used but never declared or imported.
//
// This exists because that exact bug shipped three times in one day and the
// third time blocked Cindy from saving anything in the UC registry —
// `listUc` was called in the save path and never imported. esbuild parses
// straight past it; a full esbuild BUNDLE does not catch it either, because a
// free variable is not an unresolved import. Only a linter sees it.
//
// Globals are declared inline rather than pulled from the `globals` package so
// this config is self-contained and needs no install beyond eslint itself.
const browser = Object.fromEntries([
  'window','document','navigator','console','fetch','Blob','File','FileReader',
  'URL','URLSearchParams','FormData','Headers','Request','Response','AbortController',
  'setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame','cancelAnimationFrame',
  'localStorage','sessionStorage','crypto','btoa','atob','alert','confirm','prompt',
  'Image','HTMLElement','Event','CustomEvent','IntersectionObserver','ResizeObserver',
  'createImageBitmap','OffscreenCanvas',
  'TextEncoder','TextDecoder','structuredClone','queueMicrotask','performance',
].map(k => [k, 'readonly']))

const node = Object.fromEntries(
  ['process','Buffer','__dirname','__filename','module','require','exports','global']
    .map(k => [k, 'readonly']))

export default [{
  files: ['src/**/*.{js,jsx}', 'netlify/**/*.js', 'qa/**/*.{js,jsx,cjs}'],
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
    globals: {
      ...browser, ...node,
      // Netlify edge functions run on Deno; Vite injects __BUILD_TIME__.
      Deno: 'readonly',
      __BUILD_TIME__: 'readonly',
    },
  },
  rules: { 'no-undef': 'error' },
}]
