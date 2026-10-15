import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogueFilterValue as validate } from '../src/catalogueFilter.js'
for (const surface of ['admin figurine', 'admin corporate', 'customer figurine', 'customer corporate']) {
  test(`${surface}: obsolete category is cleared; valid selection survives loading and return`, () => {
    assert.equal(validate('Old category', [], false), 'Old category')
    assert.equal(validate('Old category', ['Angels'], true), '')
    assert.equal(validate('Angels', ['Angels'], true), 'Angels')
    assert.equal(validate('Angels', [], true), '')
  })
}
test('status default and customer-retired status migration', () => {
  assert.equal(validate('discontinued', ['active','stock','concept','retired'], true, 'all'), 'all')
  assert.equal(validate('retired', ['active','stock','concept'], true), '')
  assert.equal(validate('stock', ['active','stock','concept'], true), 'stock')
})
test('customer detail cannot invoke the private supply subscription or legacy migration', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../src/customer/FigurineDetail.jsx', import.meta.url),'utf8')
  assert.doesNotMatch(source,/from ['"]\.\.\/criticalComponents['"]|useComponents\(/)
})
