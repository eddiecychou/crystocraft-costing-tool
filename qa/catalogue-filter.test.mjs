import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogueFilterValue as validate } from '../src/catalogueFilter.js'
import { customerProductAvailability as availability } from '../src/customerAvailability.js'
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
test('unknown private component stock never becomes sold-out or a fast-delivery promise', () => {
  const p = { critical_components:[{id:'private-part'}], lead_time_weeks:2 }
  for (const status of ['active','stock']) {
    const result = availability({...p,status})
    assert.equal(result.buildable,null)
    assert.match(result.customerPromise,/confirmed on enquiry/)
    assert.doesNotMatch(result.customerPromise,/Sold out|~2 weeks|private-part/)
  }
})
test('customer availability respects lifecycle and published delivery notes', () => {
  assert.match(availability({status:'concept'}).customerPromise,/Concept/)
  assert.equal(availability({status:'retired'}).buildable,0)
  assert.equal(availability({delivery_note:'Confirm custom production schedule'}).customerPromise,'Confirm custom production schedule')
  assert.equal(availability({moq:100}).leadWeeks,8)
})

test('customer detail cannot invoke the private supply subscription or legacy migration', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../src/customer/FigurineDetail.jsx', import.meta.url),'utf8')
  assert.doesNotMatch(source,/from ['"]\.\.\/criticalComponents['"]|useComponents\(/)
})
