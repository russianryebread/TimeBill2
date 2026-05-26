/// <reference path="../pb_data/types.d.ts" />

/**
 * Daily cron: materialize due recurring expenses into the expenses collection
 * and advance next_run. Idempotent at the day granularity — if a template is
 * "monthly" and next_run is today, it creates exactly one expense and bumps
 * next_run by 1 month.
 *
 * Schedule: every day at 02:00 UTC.
 */
cronAdd('recurring-expenses-materialize', '0 2 * * *', () => {
  const dao = $app.dao();
  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  let due;
  try {
    due = dao.findRecordsByFilter(
      'recurring_expenses',
      `active = true && next_run <= "${todayStr} 23:59:59.999Z"`,
      'next_run',
      500
    );
  } catch (err) {
    console.log('[cron] recurring expenses query failed:', err);
    return;
  }

  if (!due.length) return;
  console.log(`[cron] materializing ${due.length} recurring expenses`);

  const expensesCol = dao.findCollectionByNameOrId('expenses');

  for (const tpl of due) {
    try {
      const exp = new Record(expensesCol, {
        workspace: tpl.get('workspace'),
        category: tpl.get('category'),
        date: todayStr,
        amount_cents: tpl.get('amount_cents'),
        vendor: tpl.get('vendor') || '',
        description: '(recurring)',
        billable: false,
        reimbursable: false
      });
      dao.saveRecord(exp);

      // Advance next_run
      const cadence = String(tpl.get('cadence'));
      const next = new Date(todayStr);
      if (cadence === 'weekly') next.setDate(next.getDate() + 7);
      else if (cadence === 'yearly') next.setFullYear(next.getFullYear() + 1);
      else next.setMonth(next.getMonth() + 1); // monthly default
      tpl.set('next_run', next.toISOString().slice(0, 10));
      dao.saveRecord(tpl);
    } catch (err) {
      console.log(`[cron] failed to materialize ${tpl.id}:`, err);
    }
  }
});

/**
 * Manual trigger endpoint (auth required, workspace-scoped) so the user can
 * test recurring materialization without waiting for 02:00 UTC.
 *   POST /api/timebill/run-recurring
 */
routerAdd('POST', '/api/timebill/run-recurring', (c) => {
  const auth = c.get('authRecord');
  if (!auth) return c.json(401, { error: 'auth required' });

  const dao = $app.dao();
  const todayStr = new Date().toISOString().slice(0, 10);

  // Only this user's workspaces
  const wsList = dao.findRecordsByFilter(
    'workspaces',
    `owner = "${auth.id}"`,
    'created',
    100
  );
  const wsIds = wsList.map((w) => `"${w.id}"`).join(',');
  if (!wsIds) return c.json(200, { materialized: 0 });

  const due = dao.findRecordsByFilter(
    'recurring_expenses',
    `active = true && next_run <= "${todayStr} 23:59:59.999Z" && workspace.id ?~ '${wsIds.replace(/"/g, '')}'`,
    'next_run',
    500
  );

  const expensesCol = dao.findCollectionByNameOrId('expenses');
  let count = 0;
  for (const tpl of due) {
    try {
      const exp = new Record(expensesCol, {
        workspace: tpl.get('workspace'),
        category: tpl.get('category'),
        date: todayStr,
        amount_cents: tpl.get('amount_cents'),
        vendor: tpl.get('vendor') || '',
        description: '(recurring)',
        billable: false,
        reimbursable: false
      });
      dao.saveRecord(exp);

      const cadence = String(tpl.get('cadence'));
      const next = new Date(todayStr);
      if (cadence === 'weekly') next.setDate(next.getDate() + 7);
      else if (cadence === 'yearly') next.setFullYear(next.getFullYear() + 1);
      else next.setMonth(next.getMonth() + 1);
      tpl.set('next_run', next.toISOString().slice(0, 10));
      dao.saveRecord(tpl);
      count++;
    } catch (err) {
      console.log(`[trigger] failed ${tpl.id}:`, err);
    }
  }

  return c.json(200, { materialized: count });
});

/**
 * Nightly: flip sent/viewed invoices to overdue when due_date is past.
 */
cronAdd('invoices-mark-overdue', '0 3 * * *', () => {
  const dao = $app.dao();
  const today = new Date().toISOString().slice(0, 10);
  try {
    const due = dao.findRecordsByFilter(
      'invoices',
      `(status = "sent" || status = "viewed") && due_date < "${today} 00:00:00.000Z"`,
      'due_date',
      1000
    );
    for (const inv of due) {
      inv.set('status', 'overdue');
      dao.saveRecord(inv);
    }
    if (due.length) console.log(`[cron] flipped ${due.length} invoice(s) to overdue`);
  } catch (err) {
    console.log('[cron] overdue sweep failed:', err);
  }
});

/**
 * Public invoice view endpoint. Looks up by public_token, no auth required.
 * Returns invoice + line items + minimal client info for rendering.
 *
 * Side effect: flips status from "sent" to "viewed" on first hit.
 */
routerAdd('GET', '/api/timebill/public-invoice/:token', (c) => {
  const token = c.pathParam('token');
  if (!token) return c.json(400, { error: 'missing token' });

  const dao = $app.dao();
  let invoice;
  try {
    invoice = dao.findFirstRecordByFilter('invoices', `public_token = "${token}"`);
  } catch (_) {}
  if (!invoice) return c.json(404, { error: 'not found' });

  let client = null;
  try {
    const cr = dao.findRecordById('clients', invoice.get('client'));
    client = {
      id: cr.id,
      name: cr.get('name'),
      email: cr.get('email'),
      address: cr.get('address')
    };
  } catch (_) {}

  let workspace = null;
  try {
    const ws = dao.findRecordById('workspaces', invoice.get('workspace'));
    workspace = { id: ws.id, name: ws.get('name') };
  } catch (_) {}

  const lines = dao.findRecordsByFilter(
    'invoice_line_items',
    `invoice = "${invoice.id}"`,
    'sort_order,created',
    500
  );

  // Flip sent -> viewed on first view
  if (String(invoice.get('status')) === 'sent') {
    invoice.set('status', 'viewed');
    try {
      dao.saveRecord(invoice);
    } catch (_) {}
  }

  return c.json(200, {
    invoice: {
      id: invoice.id,
      number: invoice.get('number'),
      issue_date: invoice.get('issue_date'),
      due_date: invoice.get('due_date'),
      status: invoice.get('status'),
      subtotal_cents: invoice.get('subtotal_cents'),
      tax_cents: invoice.get('tax_cents'),
      total_cents: invoice.get('total_cents'),
      notes: invoice.get('notes'),
      pdf: invoice.get('pdf'),
      public_token: invoice.get('public_token'),
      workspace: invoice.get('workspace')
    },
    workspace,
    client,
    line_items: lines.map((l) => ({
      id: l.id,
      description: l.get('description'),
      quantity: l.get('quantity'),
      unit_price_cents: l.get('unit_price_cents'),
      amount_cents: l.get('amount_cents'),
      source: l.get('source'),
      sort_order: l.get('sort_order') ?? 0
    }))
  });
});
