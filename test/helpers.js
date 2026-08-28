import { applicableItems } from '../src/framework/catalog.js';

export const FULL_5_STAR = { category: '5★', hasRestaurant: true, hasPool: true, hasSpa: true };
export const FULL_4_STAR = { category: '4★', hasRestaurant: true, hasPool: true, hasSpa: true };
export const FULL_ULTRA = { category: 'Ultra', hasRestaurant: true, hasPool: true, hasSpa: true };
export const ROOMS_ONLY_5 = { category: '5★', hasRestaurant: false, hasPool: false, hasSpa: false };

/** Grade every applicable item with one status. */
export function gradeAll(profile, status, shift = 'day') {
  const graded = {};
  for (const item of applicableItems(profile)) graded[item.id] = { [shift]: { status } };
  return graded;
}

/** Override specific item ids on an existing graded object. */
export function setStatus(graded, ids, status, shift = 'day', extra = {}) {
  const out = { ...graded };
  for (const id of ids) out[id] = { ...(out[id] || {}), [shift]: { status, ...extra } };
  return out;
}

/** Applicable item ids matching a predicate on their metadata. */
export function itemsWhere(profile, predicate) {
  return applicableItems(profile).filter((i) => predicate(i.meta, i)).map((i) => i.id);
}
