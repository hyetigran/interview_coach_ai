import { z } from 'zod';
// Integer microdollars: $50 = 50,000,000 units. Unknown charges stay reserved.
export function createBudgetLedger(db: D1Database) {
  const amount = z.number().int().min(0).max(50000000);
  const key = z.string().min(1).max(120);
  async function reserve(id: string, operation: string, maximum: number) {
    key.parse(id); key.parse(operation); amount.parse(maximum);
    await db.prepare("INSERT OR IGNORE INTO processing_budget(id,operation,reserved_units) SELECT ?,?,? WHERE COALESCE((SELECT SUM(CASE WHEN state='reserved' THEN reserved_units ELSE COALESCE(settled_units,0) END) FROM processing_budget),0)+?<=50000000").bind(id, operation, maximum, maximum).run();
    const row = await db.prepare('SELECT reserved_units,operation,state FROM processing_budget WHERE id=?').bind(id).first<{ reserved_units: number; operation: string; state: string }>();
    if (row && (row.reserved_units !== maximum || row.operation !== operation)) throw new Error('Budget operation identity cannot be reused with different inputs.');
    return row?.state === 'reserved';
  }
  async function settle(id: string, actual: number) {
    key.parse(id); amount.parse(actual);
    const row = await db.prepare('SELECT reserved_units,settled_units,state FROM processing_budget WHERE id=?').bind(id).first<{ reserved_units: number; settled_units: number | null; state: string }>();
    if (!row || actual > row.reserved_units || (row.state === 'settled' && row.settled_units !== actual)) throw new Error('Charge does not match its reservation.');
    const update = await db.prepare("UPDATE processing_budget SET state='settled',settled_units=? WHERE id=? AND state='reserved'").bind(actual, id).run();
    if (!update.meta.changes) {
      const settled = await db.prepare('SELECT settled_units FROM processing_budget WHERE id=?').bind(id).first<{ settled_units: number }>();
      if (settled?.settled_units !== actual) throw new Error('Budget operation was already settled differently.');
    }
  }
  return { reserve, settle };
}

