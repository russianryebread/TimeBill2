/// <reference path="../pb_data/types.d.ts" />

/**
 * Make number, public_token, subtotal_cents, total_cents non-required so
 * draft invoices start at $0 and the server hook can fill number/token.
 *
 * (Supersedes 1700000001 which only relaxed number/token. PocketBase 0.22
 * validates required:true number fields as "must be non-zero", which blocked
 * creating an empty draft.)
 */
migrate(
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId('invoices');
    for (const f of ['number', 'public_token', 'subtotal_cents', 'total_cents']) {
      const field = c.schema.getFieldByName(f);
      if (field) field.required = false;
    }
    dao.saveCollection(c);
  },
  (db) => {
    const dao = new Dao(db);
    const c = dao.findCollectionByNameOrId('invoices');
    for (const f of ['number', 'public_token', 'subtotal_cents', 'total_cents']) {
      const field = c.schema.getFieldByName(f);
      if (field) field.required = true;
    }
    dao.saveCollection(c);
  }
);
