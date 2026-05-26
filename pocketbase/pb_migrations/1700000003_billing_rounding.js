/// <reference path="../pb_data/types.d.ts" />

/**
 * Add `billing_rounding_minutes` to workspaces. 0 = no rounding (default).
 * Allowed values enforced in app code: 0, 5, 15, 30, 60.
 *
 * Applied only when pulling time entries into invoice line items; reports
 * continue to use actual durations.
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId('workspaces');
    c.schema.addField(
      new SchemaField({
        name: 'billing_rounding_minutes',
        type: 'number',
        required: false,
        options: { min: 0, max: 60 }
      })
    );
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId('workspaces');
    const f = c.schema.getFieldByName('billing_rounding_minutes');
    if (f) c.schema.removeField(f.id);
    dao.saveCollection(c);
  }
);
