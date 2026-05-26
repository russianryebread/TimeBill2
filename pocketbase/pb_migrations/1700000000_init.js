/// <reference path="../pb_data/types.d.ts" />

/**
 * TimeBill initial schema. Creates all collections, indexes, and access rules.
 *
 * Multi-tenant-ready: every business collection has a `workspace` relation and
 * rules check `workspace.owner = @request.auth.id`. When teams ship, rules will
 * additionally check membership via the `workspace_members` collection without
 * needing a migration.
 */

migrate(
  (db) => {
    const dao = new Dao(db);
    const USERS = '_pb_users_auth_';

    // ---- workspaces ---------------------------------------------------------
    const workspaces = new Collection({
      id: 'workspaces_____',
      name: 'workspaces',
      type: 'base',
      schema: [
        { name: 'name', type: 'text', required: true, options: { max: 200 } },
        {
          name: 'owner',
          type: 'relation',
          required: true,
          options: { collectionId: USERS, cascadeDelete: true, maxSelect: 1 }
        },
        {
          name: 'default_currency',
          type: 'text',
          required: true,
          options: { min: 3, max: 3, pattern: '^[A-Z]{3}$' }
        },
        { name: 'tax_profile_json', type: 'json', required: false, options: { maxSize: 5000000 } }
      ],
      indexes: ['CREATE INDEX idx_workspaces_owner ON workspaces (owner)'],
      listRule: '@request.auth.id != "" && owner = @request.auth.id',
      viewRule: '@request.auth.id != "" && owner = @request.auth.id',
      createRule: '@request.auth.id != "" && owner = @request.auth.id',
      updateRule: '@request.auth.id != "" && owner = @request.auth.id',
      deleteRule: '@request.auth.id != "" && owner = @request.auth.id'
    });
    dao.saveCollection(workspaces);

    // Helper rule fragment: caller owns the referenced workspace.
    const inWorkspace = '@request.auth.id != "" && workspace.owner = @request.auth.id';

    // ---- workspace_members (v2 stub, defined now) ---------------------------
    const workspaceMembers = new Collection({
      id: 'workspace_membe_',
      name: 'workspace_members',
      type: 'base',
      schema: [
        {
          name: 'workspace',
          type: 'relation',
          required: true,
          options: { collectionId: 'workspaces_____', cascadeDelete: true, maxSelect: 1 }
        },
        {
          name: 'user',
          type: 'relation',
          required: true,
          options: { collectionId: USERS, cascadeDelete: true, maxSelect: 1 }
        },
        {
          name: 'role',
          type: 'select',
          required: true,
          options: { values: ['owner', 'admin', 'member'], maxSelect: 1 }
        }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_workspace_members_unique ON workspace_members (workspace, user)'
      ],
      listRule: inWorkspace,
      viewRule: inWorkspace,
      createRule: inWorkspace,
      updateRule: inWorkspace,
      deleteRule: inWorkspace
    });
    dao.saveCollection(workspaceMembers);

    // ---- clients ------------------------------------------------------------
    const clients = new Collection({
      id: 'clients________',
      name: 'clients',
      type: 'base',
      schema: [
        {
          name: 'workspace',
          type: 'relation',
          required: true,
          options: { collectionId: 'workspaces_____', cascadeDelete: true, maxSelect: 1 }
        },
        { name: 'name', type: 'text', required: true, options: { max: 200 } },
        { name: 'email', type: 'email', required: false },
        { name: 'address', type: 'text', required: false, options: { max: 1000 } },
        { name: 'default_rate_cents', type: 'number', required: false, options: { min: 0 } },
        { name: 'notes', type: 'text', required: false, options: { max: 5000 } },
        { name: 'archived', type: 'bool', required: false }
      ],
      indexes: ['CREATE INDEX idx_clients_workspace ON clients (workspace)'],
      listRule: inWorkspace,
      viewRule: inWorkspace,
      createRule: inWorkspace,
      updateRule: inWorkspace,
      deleteRule: inWorkspace
    });
    dao.saveCollection(clients);

    // ---- tasks (defined before projects so projects could reference them later)
    const tasks = new Collection({
      id: 'tasks__________',
      name: 'tasks',
      type: 'base',
      schema: [
        {
          name: 'workspace',
          type: 'relation',
          required: true,
          options: { collectionId: 'workspaces_____', cascadeDelete: true, maxSelect: 1 }
        },
        { name: 'name', type: 'text', required: true, options: { max: 200 } },
        { name: 'rate_cents', type: 'number', required: false, options: { min: 0 } },
        { name: 'billable_default', type: 'bool', required: false }
      ],
      indexes: ['CREATE INDEX idx_tasks_workspace ON tasks (workspace)'],
      listRule: inWorkspace,
      viewRule: inWorkspace,
      createRule: inWorkspace,
      updateRule: inWorkspace,
      deleteRule: inWorkspace
    });
    dao.saveCollection(tasks);

    // ---- projects -----------------------------------------------------------
    const projects = new Collection({
      id: 'projects_______',
      name: 'projects',
      type: 'base',
      schema: [
        {
          name: 'workspace',
          type: 'relation',
          required: true,
          options: { collectionId: 'workspaces_____', cascadeDelete: true, maxSelect: 1 }
        },
        {
          name: 'client',
          type: 'relation',
          required: true,
          options: { collectionId: 'clients________', cascadeDelete: false, maxSelect: 1 }
        },
        { name: 'name', type: 'text', required: true, options: { max: 200 } },
        { name: 'rate_cents', type: 'number', required: false, options: { min: 0 } },
        {
          name: 'status',
          type: 'select',
          required: true,
          options: { values: ['active', 'paused', 'archived'], maxSelect: 1 }
        },
        { name: 'budget_hours', type: 'number', required: false, options: { min: 0 } },
        { name: 'color', type: 'text', required: false, options: { max: 20 } }
      ],
      indexes: [
        'CREATE INDEX idx_projects_workspace ON projects (workspace)',
        'CREATE INDEX idx_projects_client ON projects (client)'
      ],
      listRule: inWorkspace,
      viewRule: inWorkspace,
      createRule: inWorkspace,
      updateRule: inWorkspace,
      deleteRule: inWorkspace
    });
    dao.saveCollection(projects);

    // ---- time_entries -------------------------------------------------------
    const timeEntries = new Collection({
      id: 'time_entries___',
      name: 'time_entries',
      type: 'base',
      schema: [
        {
          name: 'workspace',
          type: 'relation',
          required: true,
          options: { collectionId: 'workspaces_____', cascadeDelete: true, maxSelect: 1 }
        },
        {
          name: 'project',
          type: 'relation',
          required: true,
          options: { collectionId: 'projects_______', cascadeDelete: false, maxSelect: 1 }
        },
        {
          name: 'task',
          type: 'relation',
          required: false,
          options: { collectionId: 'tasks__________', cascadeDelete: false, maxSelect: 1 }
        },
        { name: 'started_at', type: 'date', required: true },
        { name: 'ended_at', type: 'date', required: false },
        { name: 'description', type: 'text', required: false, options: { max: 5000 } },
        { name: 'billable', type: 'bool', required: false },
        { name: 'rate_cents_snapshot', type: 'number', required: false, options: { min: 0 } }
      ],
      indexes: [
        'CREATE INDEX idx_time_entries_workspace ON time_entries (workspace)',
        'CREATE INDEX idx_time_entries_project ON time_entries (project)',
        'CREATE INDEX idx_time_entries_started_at ON time_entries (started_at)'
      ],
      listRule: inWorkspace,
      viewRule: inWorkspace,
      createRule: inWorkspace,
      updateRule: inWorkspace,
      deleteRule: inWorkspace
    });
    dao.saveCollection(timeEntries);

    // ---- expense_categories -------------------------------------------------
    const expenseCategories = new Collection({
      id: 'expense_cats___',
      name: 'expense_categories',
      type: 'base',
      schema: [
        {
          name: 'workspace',
          type: 'relation',
          required: true,
          options: { collectionId: 'workspaces_____', cascadeDelete: true, maxSelect: 1 }
        },
        { name: 'name', type: 'text', required: true, options: { max: 200 } },
        { name: 'schedule_c_line', type: 'text', required: false, options: { max: 100 } }
      ],
      indexes: [
        'CREATE INDEX idx_expense_cats_workspace ON expense_categories (workspace)',
        'CREATE UNIQUE INDEX idx_expense_cats_unique ON expense_categories (workspace, name)'
      ],
      listRule: inWorkspace,
      viewRule: inWorkspace,
      createRule: inWorkspace,
      updateRule: inWorkspace,
      deleteRule: inWorkspace
    });
    dao.saveCollection(expenseCategories);

    // ---- expenses -----------------------------------------------------------
    const expenses = new Collection({
      id: 'expenses_______',
      name: 'expenses',
      type: 'base',
      schema: [
        {
          name: 'workspace',
          type: 'relation',
          required: true,
          options: { collectionId: 'workspaces_____', cascadeDelete: true, maxSelect: 1 }
        },
        {
          name: 'category',
          type: 'relation',
          required: true,
          options: { collectionId: 'expense_cats___', cascadeDelete: false, maxSelect: 1 }
        },
        { name: 'date', type: 'date', required: true },
        { name: 'amount_cents', type: 'number', required: true },
        { name: 'vendor', type: 'text', required: false, options: { max: 200 } },
        { name: 'description', type: 'text', required: false, options: { max: 5000 } },
        {
          name: 'client',
          type: 'relation',
          required: false,
          options: { collectionId: 'clients________', cascadeDelete: false, maxSelect: 1 }
        },
        {
          name: 'project',
          type: 'relation',
          required: false,
          options: { collectionId: 'projects_______', cascadeDelete: false, maxSelect: 1 }
        },
        { name: 'billable', type: 'bool', required: false },
        { name: 'reimbursable', type: 'bool', required: false },
        {
          name: 'receipt',
          type: 'file',
          required: false,
          options: {
            maxSelect: 1,
            maxSize: 10485760,
            mimeTypes: ['image/jpeg', 'image/png', 'image/heic', 'application/pdf'],
            thumbs: ['200x200']
          }
        }
      ],
      indexes: [
        'CREATE INDEX idx_expenses_workspace ON expenses (workspace)',
        'CREATE INDEX idx_expenses_date ON expenses (date)'
      ],
      listRule: inWorkspace,
      viewRule: inWorkspace,
      createRule: inWorkspace,
      updateRule: inWorkspace,
      deleteRule: inWorkspace
    });
    dao.saveCollection(expenses);

    // ---- mileage_entries ----------------------------------------------------
    const mileage = new Collection({
      id: 'mileage________',
      name: 'mileage_entries',
      type: 'base',
      schema: [
        {
          name: 'workspace',
          type: 'relation',
          required: true,
          options: { collectionId: 'workspaces_____', cascadeDelete: true, maxSelect: 1 }
        },
        { name: 'date', type: 'date', required: true },
        { name: 'miles', type: 'number', required: true, options: { min: 0 } },
        { name: 'purpose', type: 'text', required: false, options: { max: 500 } },
        {
          name: 'client',
          type: 'relation',
          required: false,
          options: { collectionId: 'clients________', cascadeDelete: false, maxSelect: 1 }
        },
        {
          name: 'project',
          type: 'relation',
          required: false,
          options: { collectionId: 'projects_______', cascadeDelete: false, maxSelect: 1 }
        },
        { name: 'billable', type: 'bool', required: false },
        { name: 'rate_cents_snapshot', type: 'number', required: false, options: { min: 0 } }
      ],
      indexes: [
        'CREATE INDEX idx_mileage_workspace ON mileage_entries (workspace)',
        'CREATE INDEX idx_mileage_date ON mileage_entries (date)'
      ],
      listRule: inWorkspace,
      viewRule: inWorkspace,
      createRule: inWorkspace,
      updateRule: inWorkspace,
      deleteRule: inWorkspace
    });
    dao.saveCollection(mileage);

    // ---- recurring_expenses -------------------------------------------------
    const recurringExpenses = new Collection({
      id: 'recurring_exp__',
      name: 'recurring_expenses',
      type: 'base',
      schema: [
        {
          name: 'workspace',
          type: 'relation',
          required: true,
          options: { collectionId: 'workspaces_____', cascadeDelete: true, maxSelect: 1 }
        },
        {
          name: 'category',
          type: 'relation',
          required: true,
          options: { collectionId: 'expense_cats___', cascadeDelete: false, maxSelect: 1 }
        },
        { name: 'amount_cents', type: 'number', required: true, options: { min: 0 } },
        { name: 'vendor', type: 'text', required: false, options: { max: 200 } },
        {
          name: 'cadence',
          type: 'select',
          required: true,
          options: { values: ['weekly', 'monthly', 'yearly'], maxSelect: 1 }
        },
        { name: 'next_run', type: 'date', required: true },
        { name: 'active', type: 'bool', required: false }
      ],
      indexes: [
        'CREATE INDEX idx_recurring_exp_workspace ON recurring_expenses (workspace)',
        'CREATE INDEX idx_recurring_exp_next_run ON recurring_expenses (next_run)'
      ],
      listRule: inWorkspace,
      viewRule: inWorkspace,
      createRule: inWorkspace,
      updateRule: inWorkspace,
      deleteRule: inWorkspace
    });
    dao.saveCollection(recurringExpenses);

    // ---- invoices -----------------------------------------------------------
    const invoices = new Collection({
      id: 'invoices_______',
      name: 'invoices',
      type: 'base',
      schema: [
        {
          name: 'workspace',
          type: 'relation',
          required: true,
          options: { collectionId: 'workspaces_____', cascadeDelete: true, maxSelect: 1 }
        },
        {
          name: 'client',
          type: 'relation',
          required: true,
          options: { collectionId: 'clients________', cascadeDelete: false, maxSelect: 1 }
        },
        { name: 'number', type: 'text', required: true, options: { max: 50 } },
        { name: 'issue_date', type: 'date', required: true },
        { name: 'due_date', type: 'date', required: true },
        {
          name: 'status',
          type: 'select',
          required: true,
          options: {
            values: ['draft', 'sent', 'viewed', 'paid', 'overdue', 'void'],
            maxSelect: 1
          }
        },
        { name: 'subtotal_cents', type: 'number', required: true, options: { min: 0 } },
        { name: 'tax_cents', type: 'number', required: false, options: { min: 0 } },
        { name: 'total_cents', type: 'number', required: true, options: { min: 0 } },
        { name: 'notes', type: 'text', required: false, options: { max: 5000 } },
        { name: 'public_token', type: 'text', required: true, options: { min: 16, max: 100 } },
        {
          name: 'pdf',
          type: 'file',
          required: false,
          options: { maxSelect: 1, maxSize: 10485760, mimeTypes: ['application/pdf'] }
        }
      ],
      indexes: [
        'CREATE INDEX idx_invoices_workspace ON invoices (workspace)',
        'CREATE INDEX idx_invoices_client ON invoices (client)',
        'CREATE UNIQUE INDEX idx_invoices_number ON invoices (workspace, number)',
        'CREATE UNIQUE INDEX idx_invoices_public_token ON invoices (public_token)'
      ],
      listRule: inWorkspace,
      viewRule: inWorkspace,
      createRule: inWorkspace,
      updateRule: inWorkspace,
      deleteRule: inWorkspace
    });
    dao.saveCollection(invoices);

    // ---- invoice_line_items -------------------------------------------------
    const invoiceLineItems = new Collection({
      id: 'invoice_lines__',
      name: 'invoice_line_items',
      type: 'base',
      schema: [
        {
          name: 'invoice',
          type: 'relation',
          required: true,
          options: { collectionId: 'invoices_______', cascadeDelete: true, maxSelect: 1 }
        },
        { name: 'description', type: 'text', required: true, options: { max: 1000 } },
        { name: 'quantity', type: 'number', required: true },
        { name: 'unit_price_cents', type: 'number', required: true },
        { name: 'amount_cents', type: 'number', required: true },
        {
          name: 'source',
          type: 'select',
          required: true,
          options: {
            values: ['time_entry', 'expense', 'mileage', 'manual'],
            maxSelect: 1
          }
        },
        { name: 'source_id', type: 'text', required: false, options: { max: 50 } },
        { name: 'sort_order', type: 'number', required: false }
      ],
      indexes: ['CREATE INDEX idx_invoice_lines_invoice ON invoice_line_items (invoice)'],
      listRule: '@request.auth.id != "" && invoice.workspace.owner = @request.auth.id',
      viewRule: '@request.auth.id != "" && invoice.workspace.owner = @request.auth.id',
      createRule: '@request.auth.id != "" && invoice.workspace.owner = @request.auth.id',
      updateRule: '@request.auth.id != "" && invoice.workspace.owner = @request.auth.id',
      deleteRule: '@request.auth.id != "" && invoice.workspace.owner = @request.auth.id'
    });
    dao.saveCollection(invoiceLineItems);

    // Back-link fields on time_entries/expenses/mileage to invoice — added now
    // (we couldn't add them above because invoices didn't exist yet).
    const addInvoiceRel = (collectionName) => {
      const c = dao.findCollectionByNameOrId(collectionName);
      c.schema.addField(
        new SchemaField({
          name: 'invoice',
          type: 'relation',
          required: false,
          options: { collectionId: 'invoices_______', cascadeDelete: false, maxSelect: 1 }
        })
      );
      dao.saveCollection(c);
    };
    addInvoiceRel('time_entries');
    addInvoiceRel('expenses');
    addInvoiceRel('mileage_entries');

    // ---- recurring_invoices -------------------------------------------------
    const recurringInvoices = new Collection({
      id: 'recurring_inv__',
      name: 'recurring_invoices',
      type: 'base',
      schema: [
        {
          name: 'workspace',
          type: 'relation',
          required: true,
          options: { collectionId: 'workspaces_____', cascadeDelete: true, maxSelect: 1 }
        },
        {
          name: 'client',
          type: 'relation',
          required: true,
          options: { collectionId: 'clients________', cascadeDelete: false, maxSelect: 1 }
        },
        { name: 'template_line_items_json', type: 'json', required: true, options: { maxSize: 5000000 } },
        {
          name: 'cadence',
          type: 'select',
          required: true,
          options: { values: ['weekly', 'monthly', 'yearly'], maxSelect: 1 }
        },
        { name: 'next_run', type: 'date', required: true },
        { name: 'active', type: 'bool', required: false },
        { name: 'auto_send', type: 'bool', required: false }
      ],
      indexes: [
        'CREATE INDEX idx_recurring_inv_workspace ON recurring_invoices (workspace)',
        'CREATE INDEX idx_recurring_inv_next_run ON recurring_invoices (next_run)'
      ],
      listRule: inWorkspace,
      viewRule: inWorkspace,
      createRule: inWorkspace,
      updateRule: inWorkspace,
      deleteRule: inWorkspace
    });
    dao.saveCollection(recurringInvoices);

    // ---- payments -----------------------------------------------------------
    const payments = new Collection({
      id: 'payments_______',
      name: 'payments',
      type: 'base',
      schema: [
        {
          name: 'workspace',
          type: 'relation',
          required: true,
          options: { collectionId: 'workspaces_____', cascadeDelete: true, maxSelect: 1 }
        },
        {
          name: 'invoice',
          type: 'relation',
          required: true,
          options: { collectionId: 'invoices_______', cascadeDelete: true, maxSelect: 1 }
        },
        { name: 'date', type: 'date', required: true },
        { name: 'amount_cents', type: 'number', required: true, options: { min: 0 } },
        {
          name: 'method',
          type: 'select',
          required: true,
          options: { values: ['check', 'ach', 'cash', 'card', 'other'], maxSelect: 1 }
        },
        { name: 'reference', type: 'text', required: false, options: { max: 200 } },
        { name: 'notes', type: 'text', required: false, options: { max: 5000 } }
      ],
      indexes: [
        'CREATE INDEX idx_payments_workspace ON payments (workspace)',
        'CREATE INDEX idx_payments_invoice ON payments (invoice)'
      ],
      listRule: inWorkspace,
      viewRule: inWorkspace,
      createRule: inWorkspace,
      updateRule: inWorkspace,
      deleteRule: inWorkspace
    });
    dao.saveCollection(payments);

    // ---- tax_settings (singleton per workspace) -----------------------------
    const taxSettings = new Collection({
      id: 'tax_settings___',
      name: 'tax_settings',
      type: 'base',
      schema: [
        {
          name: 'workspace',
          type: 'relation',
          required: true,
          options: { collectionId: 'workspaces_____', cascadeDelete: true, maxSelect: 1 }
        },
        {
          name: 'filing_status',
          type: 'select',
          required: true,
          options: { values: ['single', 'mfj', 'mfs', 'hoh'], maxSelect: 1 }
        },
        { name: 'state', type: 'text', required: false, options: { max: 2 } },
        { name: 'estimated_other_income_cents', type: 'number', required: false },
        { name: 'mileage_rate_cents_per_mile', type: 'number', required: true, options: { min: 0 } },
        {
          name: 'quarterly_safe_harbor_pct',
          type: 'number',
          required: false,
          options: { min: 0 }
        }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_tax_settings_workspace ON tax_settings (workspace)'
      ],
      listRule: inWorkspace,
      viewRule: inWorkspace,
      createRule: inWorkspace,
      updateRule: inWorkspace,
      deleteRule: inWorkspace
    });
    dao.saveCollection(taxSettings);

    // ---- events_outbox (stub for AI/integrations) ---------------------------
    const eventsOutbox = new Collection({
      id: 'events_outbox__',
      name: 'events_outbox',
      type: 'base',
      schema: [
        {
          name: 'workspace',
          type: 'relation',
          required: true,
          options: { collectionId: 'workspaces_____', cascadeDelete: true, maxSelect: 1 }
        },
        { name: 'kind', type: 'text', required: true, options: { max: 100 } },
        { name: 'payload_json', type: 'json', required: false, options: { maxSize: 5000000 } },
        { name: 'processed_at', type: 'date', required: false }
      ],
      indexes: [
        'CREATE INDEX idx_events_outbox_kind ON events_outbox (kind)',
        'CREATE INDEX idx_events_outbox_processed_at ON events_outbox (processed_at)'
      ],
      // Only server-side hooks should read/write; lock down for now.
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null
    });
    dao.saveCollection(eventsOutbox);
  },
  (db) => {
    const dao = new Dao(db);
    const names = [
      'events_outbox',
      'tax_settings',
      'payments',
      'recurring_invoices',
      'invoice_line_items',
      'invoices',
      'recurring_expenses',
      'mileage_entries',
      'expenses',
      'expense_categories',
      'time_entries',
      'projects',
      'tasks',
      'clients',
      'workspace_members',
      'workspaces'
    ];
    for (const name of names) {
      try {
        const c = dao.findCollectionByNameOrId(name);
        dao.deleteCollection(c);
      } catch (_) {
        // ignore missing
      }
    }
  }
);
