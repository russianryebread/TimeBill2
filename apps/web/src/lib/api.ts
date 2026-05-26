import { pb } from './pb';
import { workspace } from './workspace.svelte';

function wsFilter(extra?: string) {
  const wsId = workspace.current?.id;
  if (!wsId) throw new Error('No workspace loaded');
  const base = `workspace = "${wsId}"`;
  return extra ? `${base} && (${extra})` : base;
}

export const api = {
  async listClients(opts: { includeArchived?: boolean } = {}) {
    return pb.collection('clients').getFullList({
      filter: wsFilter(opts.includeArchived ? undefined : 'archived = false'),
      sort: 'name'
    });
  },

  async createClient(data: {
    name: string;
    email?: string;
    address?: string;
    default_rate_cents?: number;
    notes?: string;
  }) {
    return pb.collection('clients').create({
      workspace: workspace.current!.id,
      archived: false,
      default_rate_cents: 0,
      ...data
    });
  },

  async updateClient(id: string, data: Record<string, unknown>) {
    return pb.collection('clients').update(id, data);
  },

  async listProjects(opts: { clientId?: string; status?: string } = {}) {
    const extras: string[] = [];
    if (opts.clientId) extras.push(`client = "${opts.clientId}"`);
    if (opts.status) extras.push(`status = "${opts.status}"`);
    return pb.collection('projects').getFullList({
      filter: wsFilter(extras.join(' && ') || undefined),
      sort: 'name',
      expand: 'client'
    });
  },

  async createProject(data: {
    client: string;
    name: string;
    rate_cents?: number | null;
    status?: string;
    color?: string;
    budget_hours?: number | null;
  }) {
    return pb.collection('projects').create({
      workspace: workspace.current!.id,
      status: 'active',
      color: '#00a5cf',
      ...data
    });
  },

  async updateProject(id: string, data: Record<string, unknown>) {
    return pb.collection('projects').update(id, data);
  },

  async listTasks() {
    return pb.collection('tasks').getFullList({
      filter: wsFilter(),
      sort: 'name'
    });
  },

  async createTask(data: { name: string; rate_cents?: number | null; billable_default?: boolean }) {
    return pb.collection('tasks').create({
      workspace: workspace.current!.id,
      billable_default: true,
      ...data
    });
  },

  async updateTask(id: string, data: Record<string, unknown>) {
    return pb.collection('tasks').update(id, data);
  },

  async deleteTask(id: string) {
    return pb.collection('tasks').delete(id);
  },

  // ----- expenses ---------------------------------------------------------

  async listExpenseCategories() {
    return pb.collection('expense_categories').getFullList({
      filter: wsFilter(),
      sort: 'name'
    });
  },

  async listExpenses(opts: { from?: string; to?: string; categoryId?: string } = {}) {
    const extras: string[] = [];
    if (opts.from) extras.push(`date >= "${opts.from}"`);
    if (opts.to) extras.push(`date < "${opts.to}"`);
    if (opts.categoryId) extras.push(`category = "${opts.categoryId}"`);
    return pb.collection('expenses').getFullList({
      filter: wsFilter(extras.join(' && ') || undefined),
      sort: '-date',
      expand: 'category,client,project'
    });
  },

  /**
   * Create an expense. If a receipt File is provided, send as multipart.
   */
  async createExpense(data: {
    date: string;
    category: string;
    amount_cents: number;
    vendor?: string;
    description?: string;
    client?: string | null;
    project?: string | null;
    billable?: boolean;
    reimbursable?: boolean;
    receipt?: File | null;
  }) {
    const form = new FormData();
    form.append('workspace', workspace.current!.id);
    form.append('date', data.date);
    form.append('category', data.category);
    form.append('amount_cents', String(data.amount_cents));
    form.append('vendor', data.vendor ?? '');
    form.append('description', data.description ?? '');
    if (data.client) form.append('client', data.client);
    if (data.project) form.append('project', data.project);
    form.append('billable', String(!!data.billable));
    form.append('reimbursable', String(!!data.reimbursable));
    if (data.receipt) form.append('receipt', data.receipt);
    return pb.collection('expenses').create(form);
  },

  async updateExpense(id: string, data: Record<string, unknown>, receipt?: File | null) {
    if (receipt) {
      const form = new FormData();
      for (const [k, v] of Object.entries(data)) {
        form.append(k, v === null ? '' : String(v));
      }
      form.append('receipt', receipt);
      return pb.collection('expenses').update(id, form);
    }
    return pb.collection('expenses').update(id, data);
  },

  async deleteExpense(id: string) {
    return pb.collection('expenses').delete(id);
  },

  // ----- mileage ----------------------------------------------------------

  async listMileage(opts: { from?: string; to?: string } = {}) {
    const extras: string[] = [];
    if (opts.from) extras.push(`date >= "${opts.from}"`);
    if (opts.to) extras.push(`date < "${opts.to}"`);
    return pb.collection('mileage_entries').getFullList({
      filter: wsFilter(extras.join(' && ') || undefined),
      sort: '-date',
      expand: 'client,project'
    });
  },

  async createMileage(data: {
    date: string;
    miles: number;
    purpose?: string;
    client?: string | null;
    project?: string | null;
    billable?: boolean;
  }) {
    return pb.collection('mileage_entries').create({
      workspace: workspace.current!.id,
      date: data.date,
      miles: data.miles,
      purpose: data.purpose ?? '',
      client: data.client ?? null,
      project: data.project ?? null,
      billable: !!data.billable
    });
  },

  async updateMileage(id: string, data: Record<string, unknown>) {
    return pb.collection('mileage_entries').update(id, data);
  },

  async deleteMileage(id: string) {
    return pb.collection('mileage_entries').delete(id);
  },

  // ----- recurring expenses ----------------------------------------------

  async listRecurringExpenses() {
    return pb.collection('recurring_expenses').getFullList({
      filter: wsFilter(),
      sort: 'next_run',
      expand: 'category'
    });
  },

  async createRecurringExpense(data: {
    category: string;
    amount_cents: number;
    vendor?: string;
    cadence: 'weekly' | 'monthly' | 'yearly';
    next_run: string;
    active?: boolean;
  }) {
    return pb.collection('recurring_expenses').create({
      workspace: workspace.current!.id,
      category: data.category,
      amount_cents: data.amount_cents,
      vendor: data.vendor ?? '',
      cadence: data.cadence,
      next_run: data.next_run,
      active: data.active ?? true
    });
  },

  async updateRecurringExpense(id: string, data: Record<string, unknown>) {
    return pb.collection('recurring_expenses').update(id, data);
  },

  async deleteRecurringExpense(id: string) {
    return pb.collection('recurring_expenses').delete(id);
  },

  // ----- tax settings -----------------------------------------------------

  async getTaxSettings() {
    const list = await pb.collection('tax_settings').getList(1, 1, {
      filter: wsFilter()
    });
    return list.items[0] ?? null;
  },

  async updateTaxSettings(id: string, data: Record<string, unknown>) {
    return pb.collection('tax_settings').update(id, data);
  },

  // ----- invoices ---------------------------------------------------------

  async listInvoices(opts: { status?: string; clientId?: string } = {}) {
    const extras: string[] = [];
    if (opts.status) extras.push(`status = "${opts.status}"`);
    if (opts.clientId) extras.push(`client = "${opts.clientId}"`);
    return pb.collection('invoices').getFullList({
      filter: wsFilter(extras.join(' && ') || undefined),
      sort: '-issue_date,-number',
      expand: 'client'
    });
  },

  async getInvoice(id: string) {
    return pb.collection('invoices').getOne(id, { expand: 'client' });
  },

  async createDraftInvoice(data: {
    client: string;
    issue_date: string;
    due_date: string;
    notes?: string;
  }) {
    return pb.collection('invoices').create({
      workspace: workspace.current!.id,
      client: data.client,
      issue_date: data.issue_date,
      due_date: data.due_date,
      status: 'draft',
      subtotal_cents: 0,
      tax_cents: 0,
      total_cents: 0,
      notes: data.notes ?? ''
    });
  },

  async updateInvoice(id: string, data: Record<string, unknown>) {
    return pb.collection('invoices').update(id, data);
  },

  async deleteInvoice(id: string) {
    return pb.collection('invoices').delete(id);
  },

  async listLineItems(invoiceId: string) {
    return pb.collection('invoice_line_items').getFullList({
      filter: `invoice = "${invoiceId}"`,
      sort: 'sort_order,created'
    });
  },

  async addLineItem(data: {
    invoice: string;
    description: string;
    quantity: number;
    unit_price_cents: number;
    source: 'time_entry' | 'expense' | 'mileage' | 'manual';
    source_id?: string;
    sort_order?: number;
  }) {
    const amount = Math.round(data.quantity * data.unit_price_cents);
    return pb.collection('invoice_line_items').create({
      invoice: data.invoice,
      description: data.description,
      quantity: data.quantity,
      unit_price_cents: data.unit_price_cents,
      amount_cents: amount,
      source: data.source,
      source_id: data.source_id ?? '',
      sort_order: data.sort_order ?? 0
    });
  },

  async deleteLineItem(id: string) {
    return pb.collection('invoice_line_items').delete(id);
  },

  async listUnbilledTimeForClient(clientId: string) {
    const projects = await pb.collection('projects').getFullList({
      filter: `workspace = "${workspace.current!.id}" && client = "${clientId}"`
    });
    if (!projects.length) return [];
    const projectIds = projects.map((p) => `"${p.id}"`).join(',');
    const projFilter = `project ?~ '${projectIds.replace(/"/g, '')}'`;
    // Use individual project filters since `?~` quotes are tricky
    const orProjects = projects.map((p) => `project = "${p.id}"`).join(' || ');
    return pb.collection('time_entries').getFullList({
      filter: `workspace = "${workspace.current!.id}" && invoice = "" && ended_at != "" && billable = true && (${orProjects})`,
      sort: '-started_at',
      expand: 'project,task'
    });
  },

  async listUnbilledExpensesForClient(clientId: string) {
    return pb.collection('expenses').getFullList({
      filter: `workspace = "${workspace.current!.id}" && invoice = "" && billable = true && client = "${clientId}"`,
      sort: '-date',
      expand: 'category,project'
    });
  },

  async listUnbilledMileageForClient(clientId: string) {
    return pb.collection('mileage_entries').getFullList({
      filter: `workspace = "${workspace.current!.id}" && invoice = "" && billable = true && client = "${clientId}"`,
      sort: '-date'
    });
  },

  async markTimeEntryBilled(id: string, invoiceId: string) {
    return pb.collection('time_entries').update(id, { invoice: invoiceId });
  },

  async markExpenseBilled(id: string, invoiceId: string) {
    return pb.collection('expenses').update(id, { invoice: invoiceId });
  },

  async markMileageBilled(id: string, invoiceId: string) {
    return pb.collection('mileage_entries').update(id, { invoice: invoiceId });
  },

  // ----- payments ---------------------------------------------------------

  async listPayments(invoiceId: string) {
    return pb.collection('payments').getFullList({
      filter: `invoice = "${invoiceId}"`,
      sort: '-date'
    });
  },

  async addPayment(data: {
    invoice: string;
    date: string;
    amount_cents: number;
    method: 'check' | 'ach' | 'cash' | 'card' | 'other';
    reference?: string;
    notes?: string;
  }) {
    return pb.collection('payments').create({
      workspace: workspace.current!.id,
      invoice: data.invoice,
      date: data.date,
      amount_cents: data.amount_cents,
      method: data.method,
      reference: data.reference ?? '',
      notes: data.notes ?? ''
    });
  },

  async deletePayment(id: string) {
    return pb.collection('payments').delete(id);
  }
};
