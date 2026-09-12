// Phase 7.3C — the refusal message has to be able to count.
//
// Found live, on the console, in the exact state this phase exists to make
// trustworthy: one permanent refusal produced
//
//   "1 change were refused because this audit belongs to another auditor."
//
// blockedMessage built a singular subject ("1 change") and then hardcoded a
// plural verb, so every single-change refusal disagreed with itself. One
// refusal is the commonest case in the field, and this sentence is the first
// thing an auditor reads when something has gone wrong: a console that cannot
// conjugate does not read like one that can be trusted with the grades.
//
// The two sibling messages, startAuditMessage and blockerMessage, had carried
// agreement explicitly since they were written. This one was the outlier.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createQueue, queueWrite, markFailure, blockedReasons, blockedMessage,
  unknownItemError, UNKNOWN_ITEM_CODE, FOREIGN_ENTRY_CODE,
} from '../src/framework/syncQueue.js';

const AUDIT = 'a1b2c3d4-0000-0000-0000-00000000000a';
const RLS = { code: '42501', message: 'new row violates row-level security policy' };

/** A queue holding n refusals of one kind. */
const refusedQueue = (n, error, prefix = 'RM') => {
  const q = createQueue();
  for (let i = 1; i <= n; i += 1) {
    const id = `${prefix}-0${i}`;
    queueWrite(q, id, 'morning', { status: 'met' }, AUDIT);
    markFailure(q, id, 'morning', typeof error === 'function' ? error(id) : error);
  }
  return q;
};

const messageFor = (n, error, prefix) => blockedMessage(blockedReasons(refusedQueue(n, error, prefix)));

// ── one refused ─────────────────────────────────────────────────────────────

test('one refused change reads as one change', () => {
  const msg = messageFor(1, RLS);
  assert.match(msg, /^1 change was refused/, 'the defect, in the words it appeared in');
  assert.equal(/1 change were/.test(msg), false);
  // The meaning and the remedy are untouched; only the verb moved.
  assert.match(msg, /belongs to another auditor/);
  assert.match(msg, /Ask them to publish it, or start your own audit/);
});

// ── two or more refused ─────────────────────────────────────────────────────

test('two or more refused changes stay plural', () => {
  const two = messageFor(2, RLS);
  assert.match(two, /^2 changes were refused/);
  assert.match(messageFor(22, RLS), /^22 changes were refused/, 'and the twenty-two case is unchanged');
});

// ── one unknown item ────────────────────────────────────────────────────────

test('one unknown item refers back to it in the singular, twice', () => {
  // This sentence carries agreement in two places: the subject at the front
  // and the thing being re-entered at the end. Both had to move.
  const msg = messageFor(1, (id) => unknownItemError(id), 'GHOST');
  assert.match(msg, /^1 change was refused because it is for a checklist item this version of the console does not have\./);
  assert.match(msg, /Update the console, then re-enter it\.$/);
  assert.equal(/checklist items|re-enter them|they are/.test(msg), false, 'nothing plural is left behind');
  assert.equal(/GHOST|UNKNOWN_ITEM/.test(msg), false, 'still no internal id and no code');
});

// ── multiple unknown items ──────────────────────────────────────────────────

test('several unknown items keep the plural wording they always had', () => {
  const msg = messageFor(3, (id) => unknownItemError(id), 'GHOST');
  assert.match(msg, /^3 changes were refused because they are for checklist items this version of the console does not have\./);
  assert.match(msg, /re-enter them\.$/);
});

// ── every other branch ──────────────────────────────────────────────────────

test('a wrong-audit refusal agrees with itself either way', () => {
  const one = messageFor(1, { code: FOREIGN_ENTRY_CODE, permanent: true, message: 'made elsewhere' });
  assert.match(one, /^1 change was made in a different audit and was not saved to this one\./);
  assert.match(one, /send it\.$/);

  const many = messageFor(2, { code: FOREIGN_ENTRY_CODE, permanent: true, message: 'made elsewhere' });
  assert.match(many, /^2 changes were made in a different audit and were not saved to this one\./);
  assert.match(many, /send them\.$/);
});

test('a missing audit, and the last-resort message, agree too', () => {
  assert.match(messageFor(1, { code: '23503', message: 'fk' }), /^1 change was refused because this audit no longer exists/);
  assert.match(messageFor(4, { code: '23503', message: 'fk' }), /^4 changes were refused because this audit no longer exists/);
  assert.match(messageFor(1, { code: '23502', message: 'null' }), /^1 change was refused by Specula and will not be retried/);
  assert.match(messageFor(2, { code: '23502', message: 'null' }), /^2 changes were refused by Specula and will not be retried/);
});

// ── the sweep: no branch may disagree with its own count ────────────────────

test('no refusal message anywhere disagrees with its own number', () => {
  const errors = [
    RLS,
    { code: '23503', message: 'fk' },
    { code: '23502', message: 'null' },
    { code: FOREIGN_ENTRY_CODE, permanent: true, message: 'elsewhere' },
    (id) => unknownItemError(id),
  ];
  for (const error of errors) {
    for (const n of [1, 2, 5]) {
      const msg = messageFor(n, error, 'SW');
      assert.ok(msg, 'every branch produces a message');
      if (n === 1) {
        assert.equal(/1 changes|1 change were|1 change are/.test(msg), false, `singular disagreement: ${msg}`);
      } else {
        assert.equal(new RegExp(`${n} change was|${n} change \\b`).test(msg), false, `plural disagreement: ${msg}`);
      }
    }
  }
});

test('nothing refused still says nothing at all', () => {
  assert.equal(blockedMessage([]), null);
  assert.equal(blockedMessage(), null);
});

test('the UNKNOWN_ITEM branch is still selected by its code, not by its words', () => {
  const msg = blockedMessage([{ code: UNKNOWN_ITEM_CODE, message: 'x', items: ['A-1'] }]);
  assert.match(msg, /checklist item this version of the console does not have/);
});
