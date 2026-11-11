import assert from 'node:assert/strict'

export async function directInvoiceBrowserCases({
  db,
  sqlDb,
  reset,
  pageAt,
  add,
  submit,
  saved,
  reports,
  invoiceFaults,
  dropReply
}) {
  await reset()
  const ledgerCount = async () =>
    Number(
      (
        await sqlDb.pool.query(
          'select count(*) as n from app_sales_invoice where order_id is not null'
        )
      ).rows[0].n
    )
  const orders = () => db.collection('orders').get()
  async function start() {
    const page = await pageAt('/sales-invoices')
    await page
      .getByRole('link', { name: 'Direct Invoice', exact: true })
      .click()
    await page
      .getByRole('heading', { name: 'Direct Invoice', exact: true })
      .waitFor()
    await page.getByRole('combobox').filter({
      has: page.getByRole('option', { name: 'Fictional 中文 Buyer', exact: true })
    }).selectOption('fictional-customer')
    await add(page)
    return page
  }
  let page = await start()
  dropReply('commit')
  await submit(page)
  await page.getByRole('button', { name: 'Finish Direct Invoice' }).waitFor()
  const url = page.url(),
    root = (await orders()).docs[0]
  assert.equal((await orders()).size, 1)
  assert.equal(await ledgerCount(), 0)
  await page.close()
  page = await pageAt('/sales-invoices')
  await page.getByRole('button', { name: 'My saved order requests' }).click()
  await page.getByRole('link', { name: /Resume Direct Invoice/ }).click()
  await page.getByRole('button', { name: 'Finish Direct Invoice' }).click()
  await saved(page)
  assert.ok(page.url().endsWith('/' + root.id))
  const si = (await root.ref.get()).get('erp_si_no')
  assert.match(si, /^SI\d+$/)
  await page.goBack()
  await page
    .getByRole('link', { name: 'Open saved order', exact: true })
    .waitFor()
  await page.reload()
  await page.getByText('Invoice ' + si, { exact: true }).waitFor()
  assert.equal((await orders()).size, 1)
  assert.equal(await ledgerCount(), 1)
  assert.equal(
    new URL(url).searchParams.get('request'),
    new URL(page.url()).searchParams.get('request')
  )
  reports.push(
    'Direct Invoice lost order response, close, Sales Invoices recovery, Back and reload use one saved order and SI'
  )
  await page.close()

  page = await start()
  invoiceFaults.lostSqlAck = true
  await submit(page)
  await page.getByRole('button', { name: 'Finish Direct Invoice' }).waitFor()
  assert.equal(await ledgerCount(), 2)
  const other = await pageAt(page.url())
  await other.getByRole('button', { name: 'Finish Direct Invoice' }).waitFor()
  await Promise.all(
    [page, other].map((p) =>
      p.getByRole('button', { name: 'Finish Direct Invoice' }).click()
    )
  )
  await Promise.all([saved(page), saved(other)])
  assert.equal(page.url(), other.url())
  assert.equal((await orders()).size, 2)
  assert.equal(await ledgerCount(), 2)
  reports.push(
    'two Chrome tabs resume an invoice issued before its SQL confirmation was lost, with no second ledger row'
  )
  await page.close()
  await other.close()

  page = await start()
  dropReply('initial_direct')
  await submit(page)
  await page.getByRole('link', { name: 'Open saved order' }).waitFor()
  assert.equal(await ledgerCount(), 3)
  await page.getByRole('link', { name: 'Open saved order' }).click()
  await saved(page)
  await page.goBack()
  await page
    .getByRole('link', { name: 'Start a separate Direct Invoice' })
    .click()
  await page
    .getByRole('heading', { name: 'Direct Invoice', exact: true })
    .waitFor()
  await add(page)
  await page.getByPlaceholder('e.g. SI260094').fill('SI-FICTIONAL-SUPPLIED')
  await submit(page)
  await saved(page)
  assert.equal(await ledgerCount(), 3)
  assert.equal((await orders()).size, 4)
  assert.equal((await db.doc('counters/so_26').get()).get('last'), 100)
  reports.push(
    'lost invoice response is recovered; an intentional separate Direct Invoice keeps its supplied SI and consumes no SO'
  )
  await page.close()

  for (const fault of ['followup', 'lostFollowupAck']) {
    const before = await ledgerCount()
    page = await start()
    invoiceFaults[fault] = true
    await submit(page)
    await page.getByRole('button', { name: 'Finish Direct Invoice' }).waitFor()
    await page.getByText(/Finish its pending accounting updates/).waitFor()
    const requestUrl = page.url()
    const id = new URL(requestUrl).searchParams.get('request')
    const request = db.doc('shipping_create_operators/admin/requests/' + id)
    const orderId = (await request.get()).get('order_id')
    const originalSi = (await db.doc('orders/' + orderId).get()).get('erp_si_no')
    assert.equal(await ledgerCount(), before + 1)
    await page.close()
    page = await pageAt('/sales-invoices')
    await page.getByRole('button', { name: 'My saved order requests' }).click()
    await page.getByRole('link', { name: new RegExp('Resume Direct Invoice.*' + originalSi) }).click()
    assert.equal(new URL(page.url()).searchParams.get('request'), id)
    assert.equal(new URL(page.url()).searchParams.get('operator'), 'admin')
    await page.reload()
    await page.getByRole('button', { name: 'Finish Direct Invoice' }).click()
    await saved(page)
    assert.ok(page.url().endsWith('/' + orderId))
    assert.equal(await ledgerCount(), before + 1)
    const root = await db.doc('orders/' + orderId).get()
    assert.equal(root.get('erp_si_no'), originalSi)
    const operation = await root.ref.collection('invoice_allocations').doc(root.get('invoice_allocation_id')).get()
    assert.equal(operation.get('followups.financial.state'), 'done')
    const row = (await sqlDb.pool.query('select total from app_sales_invoice where order_id=$1', [orderId])).rows
    assert.equal(row.length, 1)
    assert.equal(Number(row[0].total), 1222)
    reports.push('Direct Invoice ' + fault + ': close, list Resume, reload and Finish complete accounting on the same order/SI')
    await page.close()
  }
}
