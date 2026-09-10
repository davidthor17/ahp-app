/**
 * How far an audit has got, and what stands between it and being finished.
 *
 * Phase 6.3. An auditor completed a real hotel checklist and could not find
 * the way to finish. The inspection found the cause was not a broken gate:
 * FINISH AUDIT was guarded by `!readOnly` alone and was always enabled. It sat
 * 885px below the fold on a 375x812 phone, under fifteen section cards, and
 * the section screen it was reached from had no exit at its bottom at all.
 *
 * So the fix is not a stricter rule. It is telling the auditor, at all times
 * and without scrolling, where they are and what to do next. That needs one
 * honest answer to three questions:
 *
 *   how much is left            remaining
 *   can I finish                READY_TO_FINISH
 *   if not, exactly what        blockers, with the items named
 *
 * The state machine deliberately reuses what the app already has rather than
 * inventing a parallel one. There is no new column and no new persisted field:
 * every state below is derived from audit_items, which is where the truth has
 * always been.
 */

import { ITEM_STATE, itemStateAcrossShifts, tallyStates, progressLabel } from './assessmentState.js';

/**
 * Where an audit is, as one word.
 *
 * NOT_STARTED and IN_PROGRESS are the same rule with a different message; they
 * are separated because "begin" and "carry on" are different invitations.
 * READY_TO_FINISH is the only one that unlocks the finish step, and it is
 * reached when nothing is pending, which is exactly the existing definition of
 * done. Nothing is made stricter here.
 */
export const AUDIT_STATE = Object.freeze({
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  READY_TO_FINISH: 'ready_to_finish',
  PUBLISHED: 'published',
});

/**
 * The completion picture for a whole audit, section by section.
 *
 * `sections` is the app's SECTIONS shape. `isApplicable` is the console's own
 * isItemApplicable, so the checklist pin and the facility gates are honoured
 * without this module knowing anything about either.
 */
export function auditCompletion({
  sections = [], isApplicable = () => true, audit = {}, shiftIds = null, status = null,
} = {}) {
  const bySection = [];
  const allStates = [];
  const remainingItems = [];

  for (const section of sections) {
    const items = section.items.filter((i) => isApplicable(i.id));
    if (items.length === 0) continue;

    const states = items.map((i) => itemStateAcrossShifts(audit[i.id] || {}, shiftIds));
    const tally = tallyStates(states);
    allStates.push(...states);

    items.forEach((item, n) => {
      if (states[n] === ITEM_STATE.PENDING) {
        remainingItems.push({ itemId: item.id, label: item.label, sectionId: section.id, sectionLabel: section.label });
      }
    });

    bySection.push({
      id: section.id,
      label: section.label,
      total: items.length,
      tally,
      complete: tally.pending === 0,
      remaining: tally.pending,
      // A section worth a second glance before publishing: either unfinished,
      // or finished but with a lot of it never experienced. Not an error, and
      // deliberately not called one.
      needsAttention: tally.pending > 0 || tally.notAssessed > 0,
      summary: progressLabel(tally),
    });
  }

  const tally = tallyStates(allStates);
  const state = status === 'published'
    ? AUDIT_STATE.PUBLISHED
    : tally.total === 0 || tally.finished === 0
      ? AUDIT_STATE.NOT_STARTED
      : tally.pending === 0
        ? AUDIT_STATE.READY_TO_FINISH
        : AUDIT_STATE.IN_PROGRESS;

  return {
    state,
    tally,
    bySection,
    remainingItems,
    remaining: tally.pending,
    percent: tally.total ? Math.round((tally.finished / tally.total) * 100) : 0,
    summary: progressLabel(tally),
  };
}

// ── finishing ───────────────────────────────────────────────────────────────

/**
 * May the auditor finish?
 *
 * The existing rule, unchanged and not made stricter: an item at any
 * deliberate final state counts as done, and Not Assessed and Not Available
 * are both deliberate final states. Only an untouched item holds the audit
 * open. An auditor is never made to invent an assessment for a spa they did
 * not visit.
 */
export const canFinish = (completion) =>
  Boolean(completion) && completion.tally.total > 0 && completion.remaining === 0;

/**
 * Exactly what is stopping them, in their words.
 *
 * Never "cannot finish audit". The sections are named and counted, because the
 * next thing the auditor does is go to one of them.
 */
export function finishBlocker(completion) {
  if (!completion || completion.tally.total === 0) {
    return { blocked: true, reason: 'empty', message: 'This audit has no applicable items yet.' };
  }
  if (completion.remaining === 0) return { blocked: false, reason: null, message: null };

  const n = completion.remaining;
  const sections = completion.bySection.filter((s) => s.remaining > 0);
  const named = sections.slice(0, 3).map((s) => `${s.label} (${s.remaining})`).join(', ');
  const more = sections.length > 3 ? `, and ${sections.length - 3} more` : '';

  return {
    blocked: true,
    reason: 'remaining',
    message: `${n} item${n === 1 ? '' : 's'} still to do: ${named}${more}.`,
    sections,
  };
}

// ── the primary action ──────────────────────────────────────────────────────

export const ACTION = Object.freeze({
  START: 'start',
  CONTINUE: 'continue',
  FINISH: 'finish',
  VIEW_REPORT: 'view_report',
});

/**
 * The one thing to offer, and the line above it.
 *
 * There is exactly one primary action at any moment. That is the whole point:
 * an auditor holding a phone one-handed in a corridor should never have to
 * choose, and never have to look for it.
 */
export function primaryAction(completion) {
  if (!completion) return null;
  const { state, tally, remaining } = completion;

  if (state === AUDIT_STATE.PUBLISHED) {
    return { action: ACTION.VIEW_REPORT, label: 'VIEW REPORT', caption: 'This audit is published.', tone: 'done' };
  }
  if (state === AUDIT_STATE.NOT_STARTED) {
    return { action: ACTION.START, label: 'START AUDIT', caption: `${tally.total} items to assess`, tone: 'normal' };
  }
  if (state === AUDIT_STATE.READY_TO_FINISH) {
    return { action: ACTION.FINISH, label: 'FINISH AUDIT', caption: progressLabel(tally), tone: 'ready' };
  }
  return {
    action: ACTION.CONTINUE,
    label: 'CONTINUE AUDIT',
    caption: `${tally.finished} of ${tally.total} done · ${remaining} to do`,
    tone: 'normal',
  };
}

/** The next section with unfinished work, so CONTINUE has somewhere to go. */
export function nextIncompleteSection(completion, afterSectionId = null) {
  if (!completion) return null;
  const list = completion.bySection.filter((s) => s.remaining > 0);
  if (list.length === 0) return null;
  if (!afterSectionId) return list[0];
  const order = completion.bySection.map((s) => s.id);
  const from = order.indexOf(afterSectionId);
  return list.find((s) => order.indexOf(s.id) > from) || list[0];
}

/** The section immediately after this one, finished or not, for "next". */
export function sectionAfter(completion, sectionId) {
  if (!completion) return null;
  const i = completion.bySection.findIndex((s) => s.id === sectionId);
  if (i === -1 || i + 1 >= completion.bySection.length) return null;
  return completion.bySection[i + 1];
}

// ── the completion screen ───────────────────────────────────────────────────

/**
 * Sections worth looking at before publishing, most urgent first.
 *
 * Unfinished sections come first because they are actionable. Sections that
 * are complete but carry Not Assessed follow, and are explicitly not framed as
 * a problem: they are shown because Not Assessed costs coverage even though it
 * never costs score, and the auditor should see that before publishing rather
 * than afterwards.
 */
export function sectionsNeedingAttention(completion) {
  if (!completion) return [];
  return completion.bySection
    .filter((s) => s.needsAttention)
    .sort((a, b) => b.remaining - a.remaining || b.tally.notAssessed - a.tally.notAssessed);
}

/** One line describing a section on the completion screen. */
export function sectionAttentionNote(section) {
  if (!section) return null;
  if (section.remaining > 0) {
    return { text: `${section.remaining} item${section.remaining === 1 ? '' : 's'} remaining`, tone: 'bad' };
  }
  if (section.tally.notAssessed > 0) {
    const n = section.tally.notAssessed;
    return { text: `${n} not assessed`, tone: 'muted' };
  }
  return { text: 'Complete', tone: 'ok' };
}
