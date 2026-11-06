// Local Chrome persistence proof. Requires the loopback Firestore emulator and
// .qa-playwright/playwright-core. Uses only a fresh demo project/profile; never
// production credentials. Run with `firebase emulators:exec --only firestore
// --project demo-shipping-save-browser "node qa/shipping-save-persistence.mjs"`.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runNodeTest } from "./test-process.mjs";
import { build } from "esbuild";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDocFromServer, getDocsFromServer, collection } from "firebase/firestore";
async function verifyPersistence() {
  const out = "qa/out/shipping-save-persistence", projectId = "demo-shipping-save-browser";
  await mkdir(out, { recursive: true });
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(":"), env = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: await readFile("firestore.rules", "utf8") } });
  await env.clearFirestore();
  const seed = async () => env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, "users", "shipping_admin"), { role: "admin", status: "approved" });
    await setDoc(doc(d, "orders", "order"), { customer_id: "fictional-customer", notes: "Original", preserved: "keep" });
    for (const id of ["keep", "remove"]) await setDoc(doc(d, "orders", "order", "lines", id), { item_code: id, qty_ordered: 1, unit_price: 1, line_no: 1 });
  });
  await seed();
  const fixtureFirebase = `import {initializeApp} from 'firebase/app';import {initializeFirestore,persistentLocalCache,persistentMultipleTabManager,connectFirestoreEmulator,disableNetwork} from 'firebase/firestore';
export const db=initializeFirestore(initializeApp({projectId:'${projectId}',apiKey:'fictional-api',appId:'fictional-app'}),{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});connectFirestoreEmulator(db,'${host}',${Number(port)},{mockUserToken:{sub:'shipping_admin'}});
export const ready=new URLSearchParams(location.search).get('offline')==='1'?disableNetwork(db):Promise.resolve();`;
  const entry = `import {db,ready} from './src/firebase';import {saveOrderWithLines} from './src/shipping.js';import {doc,collection,getDocFromServer,getDocsFromServer,getDocFromCache,getDocsFromCache,disableNetwork,enableNetwork,waitForPendingWrites} from 'firebase/firestore';
await ready;const order=doc(db,'orders','order'),lines=collection(db,'orders','order','lines');
window.sdk={warm:async()=>{await getDocFromServer(order);await getDocsFromServer(lines)},offline:()=>disableNetwork(db),online:async()=>{await enableNetwork(db);await waitForPendingWrites(db)},cache:async()=>{const s=await getDocFromCache(order),l=await getDocsFromCache(lines);return{data:s.data(),pending:s.metadata.hasPendingWrites,lines:l.docs.map(d=>({id:d.id,...d.data()}))}},save:()=>{window.result='pending';saveOrderWithLines('order',{notes:'Saved \u4E2D\u6587',deposit_paid:155},[{id:'keep',item_code:'UPDATED',qty_ordered:1000,unit_price:1.222}]).then(()=>window.result='committed',e=>window.result=e.code)},state:()=>window.result};window.ready=true;`;
  await build({ stdin: { contents: entry, resolveDir: process.cwd() }, outfile: out + "/browser.js", bundle: true, format: "esm", platform: "browser", target: "es2022", plugins: [{ name: "fictional-local-db", setup(b) {
    b.onResolve({ filter: /\/(firebase|criticalComponents|soNumber)$/ }, (a) => ({ path: a.path.split("/").at(-1), namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ loader: "js", resolveDir: process.cwd(), contents: a.path === "firebase" ? fixtureFirebase : a.path === "criticalComponents" ? "export const buildProductIndex=()=>{},matchProductCode=()=>{};" : "export const JES_SEED_BY_YEAR={},soYear=()=>{},formatSoNo=()=>{};" }));
  } }] });
  const server = createServer(async (req, res) => {
    if (req.url?.split("?")[0] === "/browser.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(await readFile(out + "/browser.js"));
    } else res.end('<!doctype html><script type="module" src="/browser.js"><\/script>');
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const require2 = createRequire(process.cwd() + "/.qa-playwright/package.json"), { chromium } = require2("playwright-core");
  const profile = await mkdtemp(resolve(out, "profile-"));
  let browser;
  const launch = async (offline) => {
    browser = await chromium.launchPersistentContext(profile, { channel: "chrome", headless: true });
    browser.setDefaultTimeout(1e4);
    browser.setDefaultNavigationTimeout(1e4);
    const p = await browser.newPage();
    await p.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (!["127.0.0.1", "localhost"].includes(u.hostname)) return route.abort();
      return route.continue();
    });
    await p.goto(origin + (offline ? "?offline=1" : ""));
    await p.waitForFunction(() => window.ready);
    return p;
  };
  const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
  const report = { method: "Actual Chrome, current Shipping helper, Firebase SDK persistentLocalCache, current production rules in demo loopback emulator", shippingSha256: sha(await readFile("src/shipping.js")), rulesSha256: sha(await readFile("firestore.rules")), scenarios: [] };
  try {
    let page = await launch(false);
    await page.evaluate(() => sdk.warm());
    await page.evaluate(() => sdk.offline());
    await page.evaluate(() => sdk.save());
    await page.waitForFunction(async () => {
      const s = await sdk.cache();
      return s.pending && s.data.notes === "Saved \u4E2D\u6587";
    });
    assert.equal(await page.evaluate(() => sdk.state()), "pending");
    const queued = await page.evaluate(() => sdk.cache());
    assert.equal(queued.lines.length, 1);
    assert.equal(queued.lines[0].unit_price, 1.222);
    report.scenarios.push({ case: "offline-local-batch", pass: true, cache: queued });
    await env.withSecurityRulesDisabled(async (ctx) => {
      assert.equal((await getDocFromServer(doc(ctx.firestore(), "orders", "order"))).data().notes, "Original");
      assert.equal((await getDocsFromServer(collection(ctx.firestore(), "orders", "order", "lines"))).size, 2);
    });
    await browser.close();
    browser = null;
    page = await launch(true);
    const reopened = await page.evaluate(() => sdk.cache());
    assert.equal(reopened.pending, true);
    assert.equal(reopened.data.notes, "Saved \u4E2D\u6587");
    assert.equal(reopened.lines.length, 1);
    assert.equal(reopened.lines[0].unit_price, 1.222);
    report.scenarios.push({ case: "close-reopen-offline-persistent-queue", pass: true, cache: reopened });
    await page.evaluate(() => sdk.online());
    await env.withSecurityRulesDisabled(async (ctx) => {
      assert.equal((await getDocFromServer(doc(ctx.firestore(), "orders", "order"))).data().notes, "Saved \u4E2D\u6587");
      assert.equal((await getDocsFromServer(collection(ctx.firestore(), "orders", "order", "lines"))).size, 1);
    });
    report.scenarios.push({ case: "reconnect-acknowledged-batch", pass: true });
    await seed();
    await page.evaluate(() => sdk.warm());
    await page.evaluate(() => sdk.offline());
    await page.evaluate(() => sdk.save());
    await page.waitForFunction(async () => (await sdk.cache()).pending);
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "users", "shipping_admin"), { role: "customer", status: "approved", customer_id: "fictional-customer" }));
    await page.evaluate(() => sdk.online().catch(() => {
    }));
    await page.waitForFunction(() => sdk.state() === "permission-denied");
    await env.withSecurityRulesDisabled(async (ctx) => {
      assert.equal((await getDocFromServer(doc(ctx.firestore(), "orders", "order"))).data().notes, "Original");
      assert.equal((await getDocsFromServer(collection(ctx.firestore(), "orders", "order", "lines"))).size, 2);
    });
    report.scenarios.push({ case: "offline-queue-late-permission-rejection-atomic", pass: true, result: await page.evaluate(() => sdk.state()) });
    await writeFile(out + "/evidence.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ pass: true, cases: report.scenarios.length, out }));
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await env.cleanup();
    await rm(profile, { recursive: true, force: true });
  }
}
if (process.env.OC_SHIPPING_PERSISTENCE_CHILD === "1") await verifyPersistence();
else runNodeTest([fileURLToPath(import.meta.url)], { label: "Shipping Chrome persistence verification", timeoutMs: 9e4, env: { ...process.env, OC_SHIPPING_PERSISTENCE_CHILD: "1" } });
