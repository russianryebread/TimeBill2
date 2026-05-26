/// <reference path="../pb_data/types.d.ts" />

/**
 * Add `invoice_from_email` and `invoice_from_name` to workspaces.
 * Used by /api/timebill/invoices/:id/send-email to set the sender on
 * outgoing invoice emails. Optional; PB's admin SMTP defaults apply.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId('workspaces');
    c.schema.addField(
      new SchemaField({
        name: 'invoice_from_email',
        type: 'email',
        required: false
      })
    );
    c.schema.addField(
      new SchemaField({
        name: 'invoice_from_name',
        type: 'text',
        required: false,
        options: { max: 200 }
      })
    );
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId('workspaces');
    for (const f of ['invoice_from_email', 'invoice_from_name']) {
      const field = c.schema.getFieldByName(f);
      if (field) c.schema.removeField(field.id);
    }
    dao.saveCollection(c);
  }
);
