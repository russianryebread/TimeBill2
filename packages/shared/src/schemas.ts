import { z } from 'zod';

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.string(),
  default_currency: z.string().default('USD'),
  created: z.string(),
  updated: z.string()
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const clientSchema = z.object({
  id: z.string(),
  workspace: z.string(),
  name: z.string(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional().default(''),
  default_rate_cents: z.number().int().nonnegative().default(0),
  notes: z.string().optional().default(''),
  archived: z.boolean().default(false)
});
export type Client = z.infer<typeof clientSchema>;

export const projectSchema = z.object({
  id: z.string(),
  workspace: z.string(),
  client: z.string(),
  name: z.string(),
  rate_cents: z.number().int().nonnegative().nullable().default(null),
  status: z.enum(['active', 'paused', 'archived']).default('active'),
  budget_hours: z.number().nonnegative().nullable().default(null),
  color: z.string().default('#f97316')
});
export type Project = z.infer<typeof projectSchema>;

export const taskSchema = z.object({
  id: z.string(),
  workspace: z.string(),
  name: z.string(),
  rate_cents: z.number().int().nonnegative().nullable().default(null),
  billable_default: z.boolean().default(true)
});
export type Task = z.infer<typeof taskSchema>;

export const timeEntrySchema = z.object({
  id: z.string(),
  workspace: z.string(),
  project: z.string(),
  task: z.string().optional().default(''),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  description: z.string().default(''),
  billable: z.boolean().default(true),
  rate_cents_snapshot: z.number().int().nonnegative().nullable().default(null),
  invoice: z.string().nullable().default(null)
});
export type TimeEntry = z.infer<typeof timeEntrySchema>;

export const expenseSchema = z.object({
  id: z.string(),
  workspace: z.string(),
  category: z.string(),
  date: z.string(),
  amount_cents: z.number().int(),
  vendor: z.string().default(''),
  description: z.string().default(''),
  client: z.string().nullable().default(null),
  project: z.string().nullable().default(null),
  billable: z.boolean().default(false),
  reimbursable: z.boolean().default(false),
  receipt: z.string().nullable().default(null),
  invoice: z.string().nullable().default(null)
});
export type Expense = z.infer<typeof expenseSchema>;

export const invoiceStatusEnum = z.enum([
  'draft',
  'sent',
  'viewed',
  'paid',
  'overdue',
  'void'
]);
export type InvoiceStatus = z.infer<typeof invoiceStatusEnum>;

export const invoiceSchema = z.object({
  id: z.string(),
  workspace: z.string(),
  client: z.string(),
  number: z.string(),
  issue_date: z.string(),
  due_date: z.string(),
  status: invoiceStatusEnum,
  subtotal_cents: z.number().int().nonnegative(),
  tax_cents: z.number().int().nonnegative().default(0),
  total_cents: z.number().int().nonnegative(),
  notes: z.string().default(''),
  public_token: z.string(),
  pdf: z.string().nullable().default(null)
});
export type Invoice = z.infer<typeof invoiceSchema>;

export const paymentSchema = z.object({
  id: z.string(),
  workspace: z.string(),
  invoice: z.string(),
  date: z.string(),
  amount_cents: z.number().int().nonnegative(),
  method: z.enum(['check', 'ach', 'cash', 'card', 'other']),
  reference: z.string().default(''),
  notes: z.string().default('')
});
export type Payment = z.infer<typeof paymentSchema>;
