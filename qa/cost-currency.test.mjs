import test from 'node:test'
import assert from 'node:assert/strict'
import { costToHKD, hkdRateForCostCurrency, normalizeCostCurrency } from '../src/costCurrency.js'

const rates = { HKD: 1, RMB: 1.1653, USD: 7.8447 }

test('CNY supplier costs use the configured RMB-to-HKD rate', () => {
  assert.equal(normalizeCostCurrency(' cny '), 'RMB')
  assert.equal(hkdRateForCostCurrency('CNY', rates), 1.1653)
  assert.equal(costToHKD(35, 'CNY', rates), 40.7855)
})

test('an unconfigured supplier currency cannot silently become a 1:1 HKD cost', () => {
  assert.equal(hkdRateForCostCurrency('GBP', rates), null)
  assert.equal(costToHKD(35, 'GBP', rates), null)
})
