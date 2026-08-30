// The five sub-feature flags, and the three states they carry.
//
// true   the property has it, recorded by somebody who looked
// false  the property does not have it, recorded by somebody who looked
// null   nobody has been asked
//
// Null is the truth for every property that predates these questions, and it
// has to stay the truth. The console's property state used to be a plain
// boolean, and reading a null column collapsed it to true, so the first save
// after the write path was enabled would have written that fabricated answer
// back into the database, permanently, with nothing to recover from.
//
// The asymmetry is why this is worth a module of its own. A wrong true only
// adds requirements to an audit, and an auditor notices. A wrong false silently
// removes them, and nobody notices. So false must always be a recorded
// decision, never the absence of one, and null must never be read as false or
// written over by a save that was about something else.
//
// Scoring is unaffected by any of this: isApplicable gates only on an explicit
// false, so an unanswered question keeps every item it always kept.

/** UI key -> properties column. The five item-level gates, no others. */
export const DEPENDENCY_COLUMNS = Object.freeze({
  hasSauna: 'has_sauna',
  hasChangingRooms: 'has_changing_rooms',
  hasMinibar: 'has_minibar',
  hasLunchService: 'has_lunch_service',
  hasGym: 'has_gym',
});

export const DEPENDENCY_KEYS = Object.freeze(Object.keys(DEPENDENCY_COLUMNS));

/**
 * Read a column into the three-state value the console holds.
 * Null and undefined both mean unanswered. Nothing here guesses.
 */
export const triState = (v) => (v === null || v === undefined ? null : !!v);

/**
 * The columns to write for these five flags, carrying only the answered ones.
 *
 * A key is omitted entirely when the value is not an explicit boolean. On an
 * update an omitted key leaves the column exactly as it was, so saving a
 * property to correct its name cannot invent a sauna along the way. On an
 * insert an omitted key takes the column default, which is null: still
 * unanswered, which is correct for a property nobody has been asked about.
 */
export function dependencyFlagsToRow(prop = {}) {
  const row = {};
  for (const [key, column] of Object.entries(DEPENDENCY_COLUMNS)) {
    const value = prop[key];
    if (value === true || value === false) row[column] = value;
  }
  return row;
}

/** Read the five flags out of a properties row, keeping every unknown unknown. */
export function dependencyFlagsFromRow(row = {}) {
  const out = {};
  for (const [key, column] of Object.entries(DEPENDENCY_COLUMNS)) {
    out[key] = triState(row[column]);
  }
  return out;
}
