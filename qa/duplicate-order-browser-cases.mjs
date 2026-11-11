import assert from 'node:assert/strict'

// Exercised by order-create-browser only when the fictional SQL fixture is enabled.
export async function duplicateBrowserCases({
  fixture,
  db,
  reset,
  pageAt,
  saved,
  setAfterIssue,
  dropReply,
  reports
}) {
  await reset()
  const seed = async (id) => {
    const ref = db.collection('orders').doc(id)
    await ref.set({
      customer_id: 'fictional-customer',
      customer_name: 'Fictional Repeat',
      currency: 'USD',
      erp_so_no: id,
      uc_no: 'OLD-' + id,
      notes: 'copy my notes'
    })
    await ref.collection('lines').doc('item').set({
      line_no: 1,
      description: 'Fractional price',
      qty_ordered: 1000,
      unit_price: 1.222
    })
  }
  const receipts = async () =>
    Number(
      (
        await fixture.db.pool.query(
          'select count(*) as n from oc_shipping_private.duplicate_order_ucs'
        )
      ).rows[0].n
    )
  const duplicate = (page, id) =>
    page
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: id, exact: true }) })
      .getByRole('button', { name: 'Duplicate order', exact: true })
      .click()
  await seed('SO-FICTIONAL-1')
  let page = await pageAt('/shipping')
  setAfterIssue(async () => {
    throw Error('Fictional response lost after issuing UC')
  })
  await duplicate(page, 'SO-FICTIONAL-1')
  await page.getByRole('button', { name: 'Finish order copy' }).waitFor()
  const issued = (
    await fixture.db.pool.query(
      'select uc_no from oc_shipping_private.duplicate_order_ucs'
    )
  ).rows[0].uc_no
  await page
    .getByText('Issued ' + issued + ' · Order copy pending', { exact: true })
    .waitFor()
  assert.equal((await db.collection('orders').get()).size, 1)
  assert.equal(await receipts(), 1)
  setAfterIssue(null)
  await page.reload()
  await page.getByRole('button', { name: 'Finish order copy' }).click()
  await saved(page)
  const first = page.url()
  assert.equal(await receipts(), 1)
  const copy = (
    await db
      .collection('orders')
      .doc(new URL(first).pathname.split('/').at(-1))
      .get()
  ).data()
  assert.equal(copy.uc_no, issued)
  assert.equal(copy.source, 'duplicated')
  await page.getByRole('link', { name: 'Shipping list' }).click()
  await duplicate(page, 'SO-FICTIONAL-1')
  await page.getByRole('link', { name: /Open saved order/ }).waitFor()
  await page.getByRole('button', { name: 'Make another copy' }).click()
  await page.getByRole('button', { name: 'Finish order copy' }).click()
  await saved(page)
  assert.notEqual(page.url(), first)
  assert.equal(await receipts(), 2)
  reports.push(
    'UC confirmation lost, reload and Resume reuse the UC; explicit additional copy receives a separate UC and SO'
  )

  await seed('SO-FICTIONAL-2')
  await page.getByRole('link', { name: 'Shipping list' }).click()
  dropReply('duplicate')
  await duplicate(page, 'SO-FICTIONAL-2')
  await page.getByText('Fictional confirmation lost', { exact: true }).waitFor()
  assert.equal(await receipts(), 2)
  await duplicate(page, 'SO-FICTIONAL-2')
  await page.getByRole('button', { name: 'Finish order copy' }).waitFor()
  dropReply('commit')
  await page.getByRole('button', { name: 'Finish order copy' }).click()
  await page.getByRole('link', { name: /Open saved order/ }).click()
  await saved(page)
  assert.equal(await receipts(), 3)
  reports.push('lost prepare and lost final save reopen the same copy')

  await seed('SO-FICTIONAL-3')
  await page.getByRole('link', { name: 'Shipping list' }).click()
  let notify, release
  const issuedGate = new Promise((resolve) => {
      notify = resolve
    }),
    finishGate = new Promise((resolve) => {
      release = resolve
    })
  setAfterIssue(async () => {
    notify()
    await finishGate
  })
  try {
    await duplicate(page, 'SO-FICTIONAL-3')
    await Promise.race([
      issuedGate,
      new Promise((_, reject) => {
        const t = setTimeout(
          () => reject(Error('Timed out waiting for the fictional UC')),
          18000
        )
        t.unref()
      })
    ])
    await page.getByRole('link', { name: 'New Order', exact: true }).click()
    await page
      .getByRole('button', { name: '+ Add line', exact: true })
      .waitFor()
    const destination = page.url()
    release()
    let linked = false
    for (let i = 0; i < 100; i++) {
      const docs = await db
        .collection('shipping_create_operators/admin/requests')
        .get()
      if (
        docs.docs.some(
          (d) =>
            d.get('source_id') === 'SO-FICTIONAL-3' &&
            d.get('status') === 'committed'
        )
      ) {
        linked = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.ok(linked)
    assert.equal(page.url(), destination)
    assert.equal(await receipts(), 4)
  } finally {
    release()
    setAfterIssue(null)
  }
  reports.push(
    'leaving Duplicate during UC issuance respects the destination and finishes one copy'
  )
  await page.close()
}
