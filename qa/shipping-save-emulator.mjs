// Each actual SDK scenario gets an isolated client lifetime and external deadline.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {runNodeTest} from './test-process.mjs'
assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):\d+$/)
const source=await readFile('qa/shipping-save-emulator-cases.mjs','utf8')
const names=[...source.matchAll(/^test\(\s*['"]([^'"]+)['"]/gm)].map(match=>match[1])
assert.equal(names.length,16,'Every save and concurrency scenario must run')
for(const name of names){
  const pattern = '^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'
  runNodeTest(['--test','--test-reporter=dot','--test-name-pattern='+pattern,'qa/shipping-save-emulator-cases.mjs'],{
    label:name,timeoutMs:45000
  })
  console.log('PASS '+name)
}
