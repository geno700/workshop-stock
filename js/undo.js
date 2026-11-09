// Undo by reversal: records the opposite movement, so history keeps both the mistake and the fix.
import { db } from './data.js';
import { MOVE_LABELS, toast } from './ui.js';

export const isUndo = (m) => (m.reason ?? '').startsWith('Undo:');

export async function undoMovement(m) {
  const delta = Number(m.delta);
  if (!delta) throw new Error('This entry did not change the stock, so there is nothing to undo');
  const type = delta < 0 ? (m.type === 'checkout' ? 'return' : 'in') : m.type === 'return' ? 'checkout' : 'out';
  const what = (MOVE_LABELS[m.type] ?? m.type).toLowerCase();
  await db.recordMovement({
    item_id: m.item_id,
    type,
    quantity: Math.abs(delta),
    reason: `Undo: ${what}${m.reason ? ` (${m.reason})` : ''}`,
    project_id: m.project_id || null,
  });
  dispatchEvent(new Event('stock-changed'));
}

export async function runUndo(m) {
  try {
    await undoMovement(m);
    toast('Undone');
  } catch (err) {
    toast('Could not undo: ' + err.message, true);
  }
}

// Confirmation toast with an Undo button, shown right after a movement is saved.
export const savedToast = (message, movement) => toast(message, false, { label: 'Undo', run: () => runUndo(movement) });
