/// <reference path="../pb_data/types.d.ts" />

/**
 * Send an invoice to the client by email.
 *
 *   POST /api/timebill/invoices/:id/send-email
 *     body: { to?: string, cc?: string }
 *
 * - Auth required; the invoice must belong to one of the caller's
 *   workspaces.
 * - Uses PocketBase's $app.newMailClient(), which sends via SMTP if
 *   configured in admin settings, or logs the message body otherwise
 *   (useful for local development).
 * - If the invoice has a PDF stored, it's attached.
 * - On success: when the invoice is still "draft", flip status to
 *   "sent".
 */
routerAdd('POST', '/api/timebill/invoices/:id/send-email', (c) => {
  const auth = c.get('authRecord');
  if (!auth) return c.json(401, { error: 'auth required' });

  const id = c.pathParam('id');
  if (!id) return c.json(400, { error: 'missing invoice id' });

  let body = {};
  try {
    body = $apis.requestInfo(c).data || {};
  } catch (_) {}

  const dao = $app.dao();
  let invoice;
  try {
    invoice = dao.findRecordById('invoices', id);
  } catch (_) {
    return c.json(404, { error: 'invoice not found' });
  }

  // Caller must own the workspace this invoice belongs to.
  let workspace;
  try {
    workspace = dao.findRecordById('workspaces', invoice.get('workspace'));
  } catch (_) {
    return c.json(404, { error: 'workspace not found' });
  }
  if (workspace.get('owner') !== auth.id) {
    return c.json(403, { error: 'forbidden' });
  }

  let client;
  try {
    client = dao.findRecordById('clients', invoice.get('client'));
  } catch (_) {
    return c.json(404, { error: 'client not found' });
  }

  const to = (body.to && String(body.to).trim()) || client.get('email');
  if (!to) {
    return c.json(400, { error: 'no recipient — client has no email and none was provided' });
  }
  const cc = body.cc && String(body.cc).trim() ? String(body.cc).trim() : '';

  const fromEmail = workspace.get('invoice_from_email') || $app.settings().meta.senderAddress;
  const fromName = workspace.get('invoice_from_name') || workspace.get('name') || 'TimeBill';

  // Public URL — fall back to host header if appUrl is unset.
  let baseUrl = $app.settings().meta.appUrl;
  if (!baseUrl) baseUrl = c.scheme() + '://' + c.request().host;
  const publicLink = `${baseUrl.replace(/\/+$/, '')}/i/${invoice.get('public_token')}`;

  const number = invoice.get('number');
  const totalDollars = ((invoice.get('total_cents') || 0) / 100).toFixed(2);
  const dueDateRaw = String(invoice.get('due_date') || '').slice(0, 10);
  const subject = `Invoice ${number} from ${fromName} — $${totalDollars} due ${dueDateRaw}`;
  const text = [
    `Hi ${client.get('name') || 'there'},`,
    ``,
    `Invoice ${number} for $${totalDollars} is ready.`,
    `Due ${dueDateRaw}.`,
    ``,
    `View online or download the PDF:`,
    `  ${publicLink}`,
    ``,
    invoice.get('notes') ? `Notes: ${invoice.get('notes')}\n` : '',
    `Thanks,`,
    fromName
  ]
    .filter((l) => l !== null && l !== undefined)
    .join('\n');

  const html = `
<div style="font-family: -apple-system, system-ui, sans-serif; color: #1f2937; max-width: 560px;">
  <h2 style="color: #004e64; margin: 0 0 12px;">Invoice ${number}</h2>
  <p>Hi ${client.get('name') || 'there'},</p>
  <p>Invoice <strong>${number}</strong> for <strong>$${totalDollars}</strong> is ready.<br>
     Due <strong>${dueDateRaw}</strong>.</p>
  <p>
    <a href="${publicLink}"
       style="display: inline-block; background:#004e64; color:#fff;
              padding:10px 16px; border-radius:6px; text-decoration:none;
              font-weight:600;">
      View invoice online
    </a>
  </p>
  ${invoice.get('notes') ? `<p style="color:#475569;"><em>Notes: ${invoice.get('notes')}</em></p>` : ''}
  <p style="color:#64748b; font-size:12px;">— ${fromName}</p>
</div>
`;

  const message = new MailerMessage({
    from: { address: fromEmail, name: fromName },
    to: [{ address: to }],
    subject: subject,
    text: text,
    html: html
  });
  if (cc) message.cc = [{ address: cc }];

  // Attach the PDF if one is stored on the invoice.
  // PocketBase's MailerMessage accepts `attachments: Map<string, []byte|File>`,
  // but the JSVM exposes a simpler `files` shortcut that takes the storage path.
  const pdfName = invoice.get('pdf');
  if (pdfName) {
    try {
      const fs = $app.newFilesystem();
      const path = `${invoice.collection().id}/${invoice.id}/${pdfName}`;
      // Try the modern API first; fall back to older shapes silently.
      if (typeof fs.getFile === 'function') {
        const file = fs.getFile(path);
        message.attachments = { [pdfName]: file };
      } else if (typeof fs.attachment === 'function') {
        message.attachments = { [pdfName]: fs.attachment(path) };
      }
    } catch (err) {
      // Non-fatal: the public link in the body still lets the client view + download.
      console.log('[email] PDF attach skipped:', String(err));
    }
  }

  try {
    $app.newMailClient().send(message);
  } catch (err) {
    console.log('[email] send failed:', err);
    return c.json(500, { error: 'send failed: ' + String(err) });
  }

  // Flip draft → sent
  if (String(invoice.get('status')) === 'draft') {
    invoice.set('status', 'sent');
    try {
      dao.saveRecord(invoice);
    } catch (_) {}
  }

  return c.json(200, {
    to,
    cc,
    subject,
    status: invoice.get('status')
  });
});
