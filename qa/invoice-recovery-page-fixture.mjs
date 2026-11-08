// Fictional service boundary for existing real-form presentation regressions.
// Real backend/SQL/rules behavior is separately tested by invoice-recovery-emulator.
import {
  invoiceRecoveryView,
  invoiceExpected
} from '../src/invoiceRecoveryModel.js'
import { wooRegistryAutofillFields } from '../src/invoiceRegistryFields.js'
import { isKnownFinancialAmount } from '../src/invoiceFinancialModel.js'
import { ocDateOnly, ocYear } from '../src/ocTime.js'
export async function referenceFixtureInvoiceAction(
  f,
  id,
  action,
  details = {}
) {
  if (action === 'status') return invoiceRecoveryView(f.order, f.operation)
  if (!['raise', 'resume'].includes(action))
    throw Error('Unexpected fictional invoice action')
  if (
    action === 'raise' &&
    JSON.stringify(invoiceExpected(f.order)) !==
      JSON.stringify(details.expected)
  )
    throw Error('Save invoice details first')
  if (!f.operation)
    f.operation = {
      id: '12345678-1234-4123-8123-123456789abc',
      request: {
        purpose: 'first',
        reason: '',
        customer: f.order.customer_name,
        currency: f.order.currency
      },
      status: 'pending',
      followups: {
        financial: { state: 'done' },
        woo: { state: 'not_applicable' }
      }
    }
  const op = f.operation
  if (!op.result) {
    try {
      const result = await f.invoke('si', [
        {
          year: String(ocYear(new Date()) % 100).padStart(2, '0'),
          customer: f.order.customer_name,
          currency: f.order.currency,
          order_id: id,
          uc_no: f.order.uc_no || f.order.erp_pi_no || null
        }
      ])
      op.result = {
        si_no: result.si_no,
        uc_no: result.uc_no || f.order.uc_no || f.order.erp_pi_no || '',
        uc_id: result.uc_id
      }
      op.status = 'allocated'
    } catch (error) {
      op.error = { message: error.message }
      return invoiceRecoveryView(f.order, op)
    }
  }
  if (op.status !== 'linked') {
    if (f.writeError) throw f.writeError
    const patch = {
      uc_no: op.result.uc_no,
      erp_si_no: op.result.si_no,
      invoiced_at: f.order.invoiced_at || ocDateOnly(new Date())
    }
    f.orderWrites.push({
      path: [{}, 'orders', id],
      data: { ...patch, updatedAt: 'FICTIONAL timestamp' }
    })
    f.order = {
      ...f.order,
      ...patch,
      invoice_allocation_id: op.id,
      invoice_reference_revision: 2
    }
    op.status = 'linked'
    op.error = null
    if (f.order.channel === 'woocommerce' && op.result.uc_id) {
      op.followups.woo = { state: 'pending' }
      if (!isKnownFinancialAmount(f.order.total_amount))
        op.followups.woo.error =
          'WooCommerce order total is missing; registry amounts were not overwritten.'
      else
        try {
          await f.invoke('registry', [
            op.result.uc_id,
            wooRegistryAutofillFields(f.order)
          ])
          op.followups.woo.state = 'done'
        } catch (error) {
          op.followups.woo.error =
            'Invoice allocated, but the UC Registry details could not be auto-filled: ' +
            error.message
        }
    }
  }
  return invoiceRecoveryView(f.order, op)
}
