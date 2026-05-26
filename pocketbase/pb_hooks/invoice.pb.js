/// <reference path="../pb_data/types.d.ts" />

/**
 * Generate a per-workspace sequential invoice number (INV-{YYYY}-{NNNN}) and
 * a public_token on invoice create when the client didn't supply them.
 */
onRecordBeforeCreateRequest((e) => {
  const r = e.record;

  if (!r.get('public_token')) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let token = '';
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    r.set('public_token', token);
  }

  if (!r.get('number')) {
    const wsId = r.get('workspace');
    let year = String(r.get('issue_date') ?? '').slice(0, 4);
    if (!year || year === '0001' || !/^\d{4}$/.test(year)) {
      year = String(new Date().getFullYear());
    }
    const prefix = `INV-${year}-`;

    let nextSeq = 1;
    try {
      const existing = $app
        .dao()
        .findRecordsByFilter(
          'invoices',
          `workspace = "${wsId}" && number ~ "${prefix}"`,
          '-number',
          1
        );
      if (existing.length > 0) {
        const last = String(existing[0].get('number'));
        const tail = last.slice(prefix.length);
        const n = parseInt(tail, 10);
        if (!Number.isNaN(n)) nextSeq = n + 1;
      }
    } catch (_) {}
    r.set('number', `${prefix}${String(nextSeq).padStart(4, '0')}`);
  }
}, 'invoices');

/**
 * Recompute invoice status when a payment is added/updated/deleted.
 * Inlined into each callback because top-level helpers aren't in scope
 * inside Goja hook callbacks.
 */
onRecordAfterCreateRequest((e) => {
  const invoiceId = e.record.get('invoice');
  if (!invoiceId) return;
  const dao = $app.dao();
  let invoice;
  try {
    invoice = dao.findRecordById('invoices', invoiceId);
  } catch (_) { return; }
  if (!invoice) return;
  const status = String(invoice.get('status'));
  if (status === 'draft' || status === 'void') return;
  const total = invoice.get('total_cents') || 0;
  const payments = dao.findRecordsByFilter('payments', `invoice = "${invoiceId}"`, 'date', 1000);
  const paid = payments.reduce((sum, p) => sum + (p.get('amount_cents') || 0), 0);
  console.log('[invoice.pb] payment create; paid=', paid, 'total=', total, 'status=', status);
  if (paid >= total && total > 0 && status !== 'paid') {
    invoice.set('status', 'paid');
    dao.saveRecord(invoice);
  }
}, 'payments');

onRecordAfterUpdateRequest((e) => {
  const invoiceId = e.record.get('invoice');
  if (!invoiceId) return;
  const dao = $app.dao();
  let invoice;
  try {
    invoice = dao.findRecordById('invoices', invoiceId);
  } catch (_) { return; }
  if (!invoice) return;
  const status = String(invoice.get('status'));
  if (status === 'draft' || status === 'void') return;
  const total = invoice.get('total_cents') || 0;
  const payments = dao.findRecordsByFilter('payments', `invoice = "${invoiceId}"`, 'date', 1000);
  const paid = payments.reduce((sum, p) => sum + (p.get('amount_cents') || 0), 0);
  let next = status;
  if (paid >= total && total > 0) next = 'paid';
  else if (status === 'paid' && paid < total) next = 'sent';
  if (next !== status) {
    invoice.set('status', next);
    dao.saveRecord(invoice);
  }
}, 'payments');

onRecordAfterDeleteRequest((e) => {
  const invoiceId = e.record.get('invoice');
  if (!invoiceId) return;
  const dao = $app.dao();
  let invoice;
  try {
    invoice = dao.findRecordById('invoices', invoiceId);
  } catch (_) { return; }
  if (!invoice) return;
  const status = String(invoice.get('status'));
  if (status === 'draft' || status === 'void') return;
  const total = invoice.get('total_cents') || 0;
  const payments = dao.findRecordsByFilter('payments', `invoice = "${invoiceId}"`, 'date', 1000);
  const paid = payments.reduce((sum, p) => sum + (p.get('amount_cents') || 0), 0);
  if (status === 'paid' && paid < total) {
    invoice.set('status', 'sent');
    dao.saveRecord(invoice);
  }
}, 'payments');
