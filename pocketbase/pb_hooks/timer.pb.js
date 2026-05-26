/// <reference path="../pb_data/types.d.ts" />

/**
 * Enforce: at most one running time entry (ended_at empty) per workspace.
 * Starting a new timer auto-stops any currently-running entry.
 * Also snapshots the resolved hourly rate when an entry is stopped.
 *
 * NOTE: PocketBase runs each hook callback in its own isolated Goja context,
 * so top-level helpers are NOT in scope. Helpers must live inside the callback.
 */
onRecordBeforeCreateRequest((e) => {
  const r = e.record;
  const endedAt = r.get('ended_at');
  if (endedAt && String(endedAt).trim() !== '' && String(endedAt) !== '0001-01-01 00:00:00.000Z') {
    return; // not a running timer
  }

  const dao = $app.dao();
  const running = dao.findRecordsByFilter(
    'time_entries',
    `workspace = "${r.get('workspace')}" && ended_at = ""`,
    '-started_at',
    100
  );

  for (const entry of running) {
    entry.set('ended_at', new DateTime());
    snapshotRate(dao, entry);
    dao.saveRecord(entry);
  }

  function snapshotRate(dao, entry) {
    const projectId = entry.get('project');
    const taskId = entry.get('task');

    let taskRate = null;
    if (taskId) {
      try {
        const task = dao.findRecordById('tasks', taskId);
        const rate = task.get('rate_cents');
        if (typeof rate === 'number' && rate > 0) taskRate = rate;
      } catch (_) {}
    }

    let projectRate = null;
    let clientId = null;
    try {
      const project = dao.findRecordById('projects', projectId);
      const rate = project.get('rate_cents');
      if (typeof rate === 'number' && rate > 0) projectRate = rate;
      clientId = project.get('client');
    } catch (_) {}

    let clientDefault = 0;
    if (clientId) {
      try {
        const client = dao.findRecordById('clients', clientId);
        clientDefault = client.get('default_rate_cents') || 0;
      } catch (_) {}
    }

    entry.set('rate_cents_snapshot', taskRate ?? projectRate ?? clientDefault);
  }
}, 'time_entries');

onRecordBeforeUpdateRequest((e) => {
  const r = e.record;
  const original = r.originalCopy();

  // Lock: entries attached to an invoice can't be edited via the API. Only
  // exception is clearing the invoice field itself (used when removing a line
  // item from a draft invoice).
  const origInvoice = String(original.get('invoice') ?? '');
  const newInvoice = String(r.get('invoice') ?? '');
  if (origInvoice && origInvoice !== '') {
    const onlyClearingInvoice = origInvoice !== '' && newInvoice === '';
    if (!onlyClearingInvoice) {
      // Compare every other field — if anything else changed, reject.
      const fieldsToCheck = [
        'started_at',
        'ended_at',
        'description',
        'project',
        'task',
        'billable',
        'rate_cents_snapshot'
      ];
      const changed = fieldsToCheck.some(
        (f) => String(original.get(f) ?? '') !== String(r.get(f) ?? '')
      );
      if (changed) {
        throw new BadRequestError('This time entry is linked to an invoice and cannot be edited. Remove it from the invoice first.');
      }
    }
  }

  const wasRunning = !original.get('ended_at') || String(original.get('ended_at')).trim() === '';
  const isStopping = wasRunning && !!r.get('ended_at') && String(r.get('ended_at')).trim() !== '';
  if (!isStopping) return;
  if (r.get('rate_cents_snapshot')) return;

  const dao = $app.dao();
  const projectId = r.get('project');
  const taskId = r.get('task');

  let taskRate = null;
  if (taskId) {
    try {
      const task = dao.findRecordById('tasks', taskId);
      const rate = task.get('rate_cents');
      if (typeof rate === 'number' && rate > 0) taskRate = rate;
    } catch (_) {}
  }

  let projectRate = null;
  let clientId = null;
  try {
    const project = dao.findRecordById('projects', projectId);
    const rate = project.get('rate_cents');
    if (typeof rate === 'number' && rate > 0) projectRate = rate;
    clientId = project.get('client');
  } catch (_) {}

  let clientDefault = 0;
  if (clientId) {
    try {
      const client = dao.findRecordById('clients', clientId);
      clientDefault = client.get('default_rate_cents') || 0;
    } catch (_) {}
  }

  r.set('rate_cents_snapshot', taskRate ?? projectRate ?? clientDefault);
}, 'time_entries');
