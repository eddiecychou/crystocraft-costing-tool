import { doc, getDocFromServer } from 'firebase/firestore'
import { db } from './firebase'
export * from './invoiceFinancialModel.js'

export async function getOrderForInvoiceSync(orderId) {
  const snapshot = await getDocFromServer(doc(db, 'orders', orderId))
  return snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null
}
