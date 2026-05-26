import { jsPDF } from 'jspdf';
import { formatUSD } from '@timebill/shared/money';

export type PdfInvoice = {
  number: string;
  issue_date: string;
  due_date: string;
  status: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  notes: string;
  public_token: string;
};
export type PdfClient = { name: string; email?: string; address?: string };
export type PdfWorkspace = { name: string; email?: string };
export type PdfLineItem = {
  description: string;
  quantity: number;
  unit_price_cents: number;
  amount_cents: number;
};

function fmtDate(s: string): string {
  const ymd = s.slice(0, 10).split('-').map(Number);
  if (ymd.length === 3 && !ymd.some(Number.isNaN)) {
    const [y, m, d] = ymd as [number, number, number];
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }
  return s.slice(0, 10);
}

/**
 * Render an invoice to a PDF Blob using jsPDF. Lightweight layout that matches
 * the TimeBill brand palette (deep teal #004e64).
 */
export function renderInvoicePdf(args: {
  invoice: PdfInvoice;
  client: PdfClient;
  workspace: PdfWorkspace;
  lineItems: PdfLineItem[];
}): Blob {
  const { invoice, client, workspace, lineItems } = args;

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const M = 50; // margin
  let y = 60;

  // Header bar with brand color
  doc.setFillColor(0, 78, 100); // #004e64
  doc.rect(0, 0, W, 36, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(workspace.name || 'TimeBill', M, 23);

  // Big "INVOICE" + number
  doc.setTextColor(0, 78, 100);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.text('INVOICE', M, y + 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  doc.text(invoice.number, W - M, y + 10, { align: 'right' });

  y += 50;

  // From / To
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text('FROM', M, y);
  doc.text('BILL TO', W / 2, y);
  y += 14;

  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text(workspace.name || '', M, y);
  doc.text(client.name || '', W / 2, y);
  doc.setFont('helvetica', 'normal');
  y += 14;

  if (workspace.email) doc.text(workspace.email, M, y);
  if (client.email) doc.text(client.email, W / 2, y);
  y += 14;
  if (client.address) {
    const addrLines = client.address.split(/\r?\n/).slice(0, 3);
    for (const line of addrLines) {
      doc.text(line, W / 2, y);
      y += 12;
    }
  }
  y += 6;

  // Dates row
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text('ISSUE DATE', M, y);
  doc.text('DUE DATE', M + 150, y);
  y += 14;
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text(fmtDate(invoice.issue_date), M, y);
  doc.text(fmtDate(invoice.due_date), M + 150, y);
  y += 30;

  // Line items table
  const colDesc = M;
  const colQty = W - M - 220;
  const colRate = W - M - 130;
  const colAmt = W - M;

  doc.setFillColor(235, 240, 244);
  doc.rect(M - 6, y - 12, W - 2 * M + 12, 22, 'F');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.setFont('helvetica', 'bold');
  doc.text('DESCRIPTION', colDesc, y + 2);
  doc.text('QTY', colQty, y + 2, { align: 'right' });
  doc.text('RATE', colRate, y + 2, { align: 'right' });
  doc.text('AMOUNT', colAmt, y + 2, { align: 'right' });
  y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);

  for (const li of lineItems) {
    if (y > 720) {
      doc.addPage();
      y = 60;
    }
    const descLines = doc.splitTextToSize(li.description, colQty - colDesc - 20);
    doc.text(descLines, colDesc, y);
    const qty =
      Number.isInteger(li.quantity) ? String(li.quantity) : li.quantity.toFixed(2);
    doc.text(qty, colQty, y, { align: 'right' });
    doc.text(formatUSD(li.unit_price_cents), colRate, y, { align: 'right' });
    doc.text(formatUSD(li.amount_cents), colAmt, y, { align: 'right' });
    y += Math.max(14, descLines.length * 12);
    doc.setDrawColor(230, 230, 230);
    doc.line(M, y - 4, W - M, y - 4);
    y += 4;
  }

  y += 10;

  // Totals
  const totalsX = W - M - 200;
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text('Subtotal', totalsX, y);
  doc.setTextColor(0, 0, 0);
  doc.text(formatUSD(invoice.subtotal_cents), colAmt, y, { align: 'right' });
  y += 16;
  if (invoice.tax_cents > 0) {
    doc.setTextColor(80, 80, 80);
    doc.text('Tax', totalsX, y);
    doc.setTextColor(0, 0, 0);
    doc.text(formatUSD(invoice.tax_cents), colAmt, y, { align: 'right' });
    y += 16;
  }
  doc.setDrawColor(0, 78, 100);
  doc.setLineWidth(1.5);
  doc.line(totalsX, y - 4, colAmt, y - 4);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(0, 78, 100);
  doc.text('TOTAL', totalsX, y + 10);
  doc.text(formatUSD(invoice.total_cents), colAmt, y + 10, { align: 'right' });

  // Notes
  if (invoice.notes) {
    y += 50;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text('NOTES', M, y);
    y += 14;
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    const noteLines = doc.splitTextToSize(invoice.notes, W - 2 * M);
    doc.text(noteLines, M, y);
  }

  return doc.output('blob');
}
