import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// Settings → API in your Supabase project → Project URL + anon public key.
// Safe to expose in client code — access is governed by the RLS policies
// in ahp-supabase-schema.sql, not by keeping this key secret.
const SUPABASE_URL = "https://zbmhfdoqmzzscdklziss.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_s7RALrw2f5eXx5lMKGhqOw_isP5_II-";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SHIFT_SYSTEMS = {
  '2': { label: '2 shifts', shifts: [{ id: 'day', label: 'Day', time: '07:00–19:00' }, { id: 'night', label: 'Night', time: '19:00–07:00' }] },
  '3': { label: '3 shifts', shifts: [{ id: 'morning', label: 'Morning', time: '07:00–15:00' }, { id: 'afternoon', label: 'Afternoon', time: '15:00–23:00' }, { id: 'night', label: 'Night', time: '23:00–07:00' }] },
};
const ROTATION_LABELS = ['2-2-3', '5-5-4', '4-4-5', 'Fixed'];
const STAR_RANK = { '4★': 4, '5★': 5, 'Ultra': 6 };
const STAR_LABELS = ['4★', '5★', 'Ultra'];
const ROOM_TYPES = ['Standard', 'Deluxe', 'Suite', 'Villa'];
const MENU_VARIETY = ['Limited', 'Balanced', 'Extensive'];
const MENU_COMPLEXITY = ['Simple', 'Moderate', 'Complex'];

const SECTIONS = [
  { id: 'pre', label: 'Pre-Arrival & Website', icon: '◈', facility: null, items: [
    { id: 'PRE-01', label: 'Branding consistent and luxury-appropriate', minStars: 4 },
    { id: 'PRE-02', label: 'Professional photography and video', minStars: 4 },
    { id: 'PRE-03', label: 'Booking process simple and transparent', minStars: 4 },
    { id: 'PRE-04', label: 'Mobile optimized and fast loading', minStars: 4 },
    { id: 'PRE-05', label: 'Confirmation email professional and on-brand', minStars: 4 },
    { id: 'PRE-06', label: 'Pre-arrival preference questionnaire sent', minStars: 5 },
    { id: 'PRE-07', label: 'Dedicated concierge contact provided pre-stay', minStars: 6 },
    { id: 'PRE-08', label: 'Overall marketing presence strong and consistent', minStars: 4 },
    { id: 'PRE-09', label: 'Website quality — design, content, ease of use', minStars: 4 },
    { id: 'PRE-10', label: 'Phone call to reception — responsiveness and helpfulness', minStars: 4 },
    { id: 'PRE-11', label: 'Email response — timeliness and quality', minStars: 4 },
    { id: 'PRE-12', label: 'Social media presence active and on-brand', minStars: 4 },
    { id: 'PRE-13', label: 'List of bookable extras/services sent pre-arrival', minStars: 5 },
  ]},
  { id: 'arrival', label: 'Arrival & Entrance', icon: '→', facility: null, items: [
    { id: 'ARR-01', label: 'Exterior clean and well-maintained', minStars: 4 },
    { id: 'ARR-02', label: 'Guest greeted within 30 seconds', minStars: 4 },
    { id: 'ARR-03', label: 'Luggage assistance offered proactively', minStars: 4 },
    { id: 'ARR-04', label: 'Pleasant atmosphere — scent, music, temperature', minStars: 4 },
    { id: 'ARR-05', label: 'Doorman or valet present', minStars: 5 },
    { id: 'ARR-06', label: 'Welcome drink or cold towel offered', minStars: 5 },
    { id: 'ARR-07', label: 'Bespoke welcome ritual or experience', minStars: 6 },
    { id: 'ARR-08', label: 'Disabled access available and functional', minStars: 4 },
    { id: 'ARR-09', label: 'Lighting appropriate throughout', minStars: 4 },
    { id: 'ARR-10', label: 'Furniture in good condition', minStars: 4 },
    { id: 'ARR-11', label: 'Cushions fluffed, no visible dust', minStars: 4 },
    { id: 'ARR-12', label: 'Music/mood present and at appropriate volume', minStars: 4 },
  ]},
  { id: 'reception', label: 'Reception & Check-in', icon: '⊡', facility: null, items: [
    { id: 'REC-01', label: 'Wait time under 3 minutes', minStars: 4 },
    { id: 'REC-02', label: 'Guest addressed by name', minStars: 4 },
    { id: 'REC-03', label: 'Eye contact and genuine smile', minStars: 4 },
    { id: 'REC-04', label: 'Staff knowledgeable — local tips and amenities', minStars: 4 },
    { id: 'REC-05', label: 'Room preference acknowledged or upgraded', minStars: 5 },
    { id: 'REC-06', label: 'Private or in-room check-in offered', minStars: 6 },
    { id: 'REC-07', label: 'Personal butler or liaison introduced', minStars: 6 },
    { id: 'REC-08', label: 'Front desk free of clutter', minStars: 4 },
    { id: 'REC-09', label: 'Total check-in time reasonable', minStars: 4 },
    { id: 'REC-10', label: 'Tour offered or facilities map explained', minStars: 4 },
  ]},
  { id: 'room', label: 'Room Quality', icon: '□', facility: null, items: [
    { id: 'RM-01', label: 'Surfaces dust-free, mirrors spotless', minStars: 4 },
    { id: 'RM-02', label: 'No hair, stains, or odors', minStars: 4 },
    { id: 'RM-03', label: 'All lights and technology functioning', minStars: 4 },
    { id: 'RM-04', label: 'Bedding high quality and fresh', minStars: 4 },
    { id: 'RM-05', label: 'Noise levels acceptable', minStars: 4 },
    { id: 'RM-06', label: 'Premium minibar and luxury amenities', minStars: 5 },
    { id: 'RM-07', label: 'Welcome gift or personal note present', minStars: 5 },
    { id: 'RM-08', label: 'Guest preferences pre-applied (pillow, temp)', minStars: 6 },
    { id: 'RM-09', label: 'Nothing in the room visibly outdated', minStars: 4 },
    { id: 'RM-10', label: 'Minibar cleared/reset since last guest', minStars: 4 },
  ]},
  { id: 'facilities', label: 'Facilities', icon: '⚙', facility: null, items: [
    { id: 'FAC-01', label: 'Overall exterior condition well maintained', minStars: 4 },
    { id: 'FAC-02', label: 'Overall interior condition well maintained', minStars: 4 },
    { id: 'FAC-03', label: 'General maintenance standards high', minStars: 4 },
    { id: 'FAC-04', label: 'Gym equipment modern and well maintained', minStars: 4 },
    { id: 'FAC-05', label: 'Gym access cost clearly disclosed (free or paid)', minStars: 4 },
    { id: 'FAC-06', label: 'Gym has a view or pleasant environment', minStars: 5 },
  ]},
  { id: 'bathroom', label: 'Bathroom', icon: '◎', facility: null, items: [
    { id: 'BTH-01', label: 'No mold, mildew, or drain odor', minStars: 4 },
    { id: 'BTH-02', label: 'Strong water pressure, stable temperature', minStars: 4 },
    { id: 'BTH-03', label: 'Towels fresh and plentiful', minStars: 4 },
    { id: 'BTH-04', label: 'Luxury amenity brands present', minStars: 5 },
    { id: 'BTH-05', label: 'Deep bathtub present and clean', minStars: 5 },
    { id: 'BTH-06', label: 'Rainfall shower or premium showerhead', minStars: 5 },
    { id: 'BTH-07', label: 'Heated floors or towel rails', minStars: 6 },
  ]},
  { id: 'breakfast', label: 'Breakfast', icon: '☀', facility: 'hasRestaurant', items: [
    { id: 'BRK-01', label: 'Hot items fresh and at correct temperature', minStars: 4 },
    { id: 'BRK-02', label: 'Good variety — hot, cold, pastry, fruit', minStars: 4 },
    { id: 'BRK-03', label: 'Coffee quality high — espresso or equivalent', minStars: 4 },
    { id: 'BRK-04', label: 'Fresh juice — not from concentrate', minStars: 4 },
    { id: 'BRK-05', label: 'Refills fast — coffee, juice, bread', minStars: 4 },
    { id: 'BRK-06', label: 'Local or regional items featured', minStars: 4 },
    { id: 'BRK-07', label: 'Vegan and plant-based options clearly labeled', minStars: 4 },
    { id: 'BRK-08', label: 'Gluten-free options available', minStars: 4 },
    { id: 'BRK-09', label: 'Allergen information accessible', minStars: 4 },
    { id: 'BRK-10', label: 'A la carte or cooked-to-order station', minStars: 5 },
    { id: 'BRK-11', label: 'In-room breakfast well-executed', minStars: 5 },
    { id: 'BRK-12', label: 'Personalized dietary preferences remembered', minStars: 6 },
    { id: 'BRK-13', label: 'Overall food quality high', minStars: 4 },
    { id: 'BRK-14', label: 'Buffet and/or à la carte clearly presented', minStars: 4 },
  ]},
  { id: 'lunch', label: 'Lunch & All-Day Dining', icon: '◑', facility: 'hasRestaurant', items: [
    { id: 'LUN-01', label: 'Menu available and easy to navigate', minStars: 4 },
    { id: 'LUN-02', label: 'Food fresh — not reheated or tired', minStars: 4 },
    { id: 'LUN-03', label: 'Good variety — light dishes, mains, snacks', minStars: 4 },
    { id: 'LUN-04', label: 'Vegan and vegetarian options available', minStars: 4 },
    { id: 'LUN-05', label: 'Gluten-free options available', minStars: 4 },
    { id: 'LUN-06', label: 'Menu reflects local cuisine or culture', minStars: 4 },
    { id: 'LUN-07', label: 'Portion sizes appropriate for price point', minStars: 4 },
    { id: 'LUN-08', label: 'Seasonal or market-driven menu', minStars: 5 },
    { id: 'LUN-09', label: 'Chef visible or kitchen open concept', minStars: 5 },
    { id: 'LUN-10', label: 'Menu physically clean and in good condition', minStars: 4 },
  ]},
  { id: 'restaurant', label: 'Restaurant & Dinner', icon: '◇', facility: 'hasRestaurant', items: [
    { id: 'RST-01', label: 'Food fresh and at correct temperature', minStars: 4 },
    { id: 'RST-02', label: 'Presentation attractive and consistent', minStars: 4 },
    { id: 'RST-03', label: 'Menu diverse — meat, fish, vegetarian', minStars: 4 },
    { id: 'RST-04', label: 'Vegan options available and well-executed', minStars: 4 },
    { id: 'RST-05', label: 'Authentic or locally-inspired cuisine', minStars: 4 },
    { id: 'RST-06', label: 'Menu not generic — not hotel safe food', minStars: 4 },
    { id: 'RST-07', label: 'Ingredients described — origin or sourcing noted', minStars: 5 },
    { id: 'RST-08', label: 'Sommelier or beverage specialist present', minStars: 5 },
    { id: 'RST-09', label: 'Wine list curated and appropriate for category', minStars: 5 },
    { id: 'RST-10', label: 'Tasting menu or chefs table available', minStars: 6 },
    { id: 'RST-11', label: 'Michelin star or recognized culinary identity', minStars: 6 },
    { id: 'RST-12', label: 'Food cooked to correct doneness — not under or overcooked', minStars: 4 },
  ]},
  { id: 'fbservice', label: 'F&B Service', icon: '◈', facility: 'hasRestaurant', items: [
    { id: 'FBS-01', label: 'Greeted and seated promptly', minStars: 4 },
    { id: 'FBS-02', label: 'Order taken within 5 minutes', minStars: 4 },
    { id: 'FBS-03', label: 'Staff knowledgeable about the menu', minStars: 4 },
    { id: 'FBS-04', label: 'Allergies and dietary needs taken seriously', minStars: 4 },
    { id: 'FBS-05', label: 'Tables cleared promptly between courses', minStars: 4 },
    { id: 'FBS-06', label: 'Water refilled without being asked', minStars: 4 },
    { id: 'FBS-07', label: 'Staff able to recommend dishes confidently', minStars: 5 },
    { id: 'FBS-08', label: 'Pacing between courses well-managed', minStars: 5 },
    { id: 'FBS-09', label: 'Bill presented discreetly and accurately', minStars: 4 },
    { id: 'FBS-10', label: 'Farewell warm — not transactional', minStars: 4 },
  ]},
  { id: 'pool', label: 'Pool', icon: '≈', facility: 'hasPool', items: [
    { id: 'PL-01', label: 'Water temperature comfortable (28-30 C)', minStars: 4 },
    { id: 'PL-02', label: 'Deck clean — no abandoned towels', minStars: 4 },
    { id: 'PL-03', label: 'Chlorine within acceptable range', minStars: 4 },
    { id: 'PL-04', label: 'Seating adequate relative to hotel room count', minStars: 4 },
    { id: 'PL-05', label: 'Towels stocked at poolside', minStars: 4 },
    { id: 'PL-06', label: 'Pool attendant present and attentive', minStars: 5 },
    { id: 'PL-07', label: 'Poolside beverage service available', minStars: 5 },
    { id: 'PL-08', label: 'Architectural or infinity pool design', minStars: 6 },
    { id: 'PL-09', label: 'Pool overall clean and well maintained', minStars: 4 },
    { id: 'PL-10', label: 'Water clarity good', minStars: 4 },
    { id: 'PL-11', label: 'Family-friendly features present (kids pool/splash area)', minStars: 4 },
    { id: 'PL-12', label: 'Waterslides present and functioning (if applicable)', minStars: 5 },
  ]},
  { id: 'spa', label: 'Spa & Wellness', icon: '✦', facility: 'hasSpa', items: [
    { id: 'SP-01', label: 'Relaxing atmosphere from entrance', minStars: 4 },
    { id: 'SP-02', label: 'Locker rooms clean and well-stocked', minStars: 4 },
    { id: 'SP-03', label: 'No hair in drains', minStars: 4 },
    { id: 'SP-04', label: 'Sauna functioning properly', minStars: 4 },
    { id: 'SP-05', label: 'Staff knowledgeable about treatments', minStars: 4 },
    { id: 'SP-06', label: 'Premium product brands used in treatments', minStars: 5 },
    { id: 'SP-07', label: 'Thermal journey or circuit available', minStars: 6 },
    { id: 'SP-08', label: 'Bespoke treatment programming', minStars: 6 },
    { id: 'SP-09', label: 'Sauna, steam room, infrared or similar present', minStars: 4 },
    { id: 'SP-10', label: 'Interior lighting appropriate', minStars: 4 },
    { id: 'SP-11', label: 'Massage/treatments offered', minStars: 4 },
    { id: 'SP-12', label: 'Treatment quality (if a treatment was received — describe in notes)', minStars: 4 },
  ]},
  { id: 'housekeeping', label: 'Housekeeping', icon: '⌂', facility: null, items: [
    { id: 'HK-01', label: 'Room cleaned on time', minStars: 4 },
    { id: 'HK-02', label: 'Proper restocking of amenities', minStars: 4 },
    { id: 'HK-03', label: 'Guest belongings respected and undisturbed', minStars: 4 },
    { id: 'HK-04', label: 'Hallway noise minimal during service', minStars: 4 },
    { id: 'HK-05', label: 'Staff appearance professional', minStars: 4 },
    { id: 'HK-06', label: 'Turndown service with personal touch', minStars: 5 },
    { id: 'HK-07', label: 'Nightly gift or handwritten note', minStars: 6 },
  ]},
  { id: 'departure', label: 'Departure', icon: '←', facility: null, items: [
    { id: 'DEP-01', label: 'Billing accurate and clearly itemized', minStars: 4 },
    { id: 'DEP-02', label: 'Checkout completed under 3 minutes', minStars: 4 },
    { id: 'DEP-03', label: 'Warm farewell — guest addressed by name', minStars: 4 },
    { id: 'DEP-04', label: 'Luggage assistance offered', minStars: 4 },
    { id: 'DEP-05', label: 'Invitation to return', minStars: 4 },
    { id: 'DEP-06', label: 'Loyalty program or return offer presented', minStars: 5 },
    { id: 'DEP-07', label: 'Personalised farewell gift or gesture', minStars: 6 },
  ]},
];

const STATUS = {
  met:     { label: 'Met',     color: '#4DC87A', bg: 'rgba(77,200,122,0.12)',  border: 'rgba(77,200,122,0.35)' },
  partial: { label: 'Partial', color: '#F5A623', bg: 'rgba(245,166,35,0.12)', border: 'rgba(245,166,35,0.35)' },
  missed:  { label: 'Missed',  color: '#E05555', bg: 'rgba(224,85,85,0.12)',  border: 'rgba(224,85,85,0.35)'  },
  na:      { label: 'N/A',     color: '#5A5A6E', bg: 'rgba(90,90,110,0.12)', border: 'rgba(90,90,110,0.35)'  },
};

// item id -> { sectionId, label } — used when upserting audit_items to Supabase
const ITEM_INDEX = {};
SECTIONS.forEach(sec => sec.items.forEach(it => { ITEM_INDEX[it.id] = { sectionId: sec.id, label: it.label }; }));

const C = {
  bg: '#0C0C0F', surface: '#141418', surface2: '#1C1C22', border: '#28282F',
  gold: '#C9AA71', goldBg: 'rgba(201,170,113,0.12)', goldBorder: 'rgba(201,170,113,0.35)',
  text: '#EEEAE4', dim: '#888898', muted: '#444450',
  warn: '#F5A623', warnBg: 'rgba(245,166,35,0.1)',
};

const STORAGE_KEY = 'ahp_v3';
const nowTime = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const genRef = () => `AHP-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

// prop (camelCase, UI state) -> properties table row (snake_case)
const propToRow = (p, userId) => ({
  name: p.name, city: p.city, country: p.country,
  category: p.category, chain: p.chain, chain_name: p.chainName,
  room_count: p.roomCount ? Number(p.roomCount) : null, room_types: p.roomTypes,
  has_pool: p.hasPool, pool_capacity: p.poolCapacity ? Number(p.poolCapacity) : null, pool_count: p.poolCount ? Number(p.poolCount) : null,
  has_spa: p.hasSpa,
  has_restaurant: p.hasRestaurant, fb_capacity: p.fbCapacity ? Number(p.fbCapacity) : null,
  menu_variety: p.menuVariety, menu_complexity: p.menuComplexity,
  authentic_cuisine: p.authenticCuisine, has_wine_list: p.hasWineList,
  shift_count: p.shiftCount, rotation_pattern: p.rotationPattern, shift_times: p.shiftTimes,
  created_by: userId,
});

// properties row (snake_case) -> prop (camelCase UI state). Reverse of propToRow.
// Used only when a reviewer opens an audit for reading; the capture flow never
// needs it, because it owns the prop state it just authored.
const rowToProp = (row) => ({
  name: row.name || '', city: row.city || '', country: row.country || '',
  chain: !!row.chain, chainName: row.chain_name || '',
  category: row.category || '4★', roomCount: row.room_count != null ? String(row.room_count) : '',
  roomTypes: row.room_types || [],
  hasPool: !!row.has_pool, poolCapacity: row.pool_capacity != null ? String(row.pool_capacity) : '',
  poolCount: row.pool_count != null ? String(row.pool_count) : '1',
  hasSpa: !!row.has_spa,
  hasRestaurant: !!row.has_restaurant, fbCapacity: row.fb_capacity != null ? String(row.fb_capacity) : '',
  menuVariety: row.menu_variety || '', menuComplexity: row.menu_complexity || '',
  authenticCuisine: !!row.authentic_cuisine, hasWineList: !!row.has_wine_list,
  shiftCount: row.shift_count || '3', rotationPattern: row.rotation_pattern || '', shiftTimes: row.shift_times || {},
});

const fmtDate = (d) => {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch (e) { return String(d); }
};

export default function AHPAudit() {
  const [screen, setScreen]               = useState('loading');
  const [session, setSession]             = useState(undefined); // undefined = not checked yet, null = signed out
  const [authEmail, setAuthEmail]         = useState('');
  const [authPassword, setAuthPassword]   = useState('');
  const [authError, setAuthError]         = useState('');
  const [authBusy, setAuthBusy]           = useState(false);
  const [syncState, setSyncState]         = useState('offline'); // offline | synced | error
  const [ids, setIds]                     = useState({ propertyId: null, auditId: null, auditRef: null });
  const [prop, setProp]                   = useState({
    name: '', city: '', country: '', chain: false, chainName: '',
    category: '4★', roomCount: '', roomTypes: [],
    hasPool: false, poolCapacity: '', poolCount: '1',
    hasSpa: false,
    hasRestaurant: false, fbCapacity: '', menuVariety: '', menuComplexity: '', authenticCuisine: false, hasWineList: false,
    shiftCount: '3', rotationPattern: '2-2-3', shiftTimes: {},
  });
  const [activeShiftId, setActiveShiftId] = useState('morning');
  const [activeSection, setActiveSection] = useState(null);
  const [audit, setAudit]                 = useState({});
  const [openNotes, setOpenNotes]         = useState({});
  const [summaryDraft, setSummaryDraft]   = useState('');
  const [auditTier, setAuditTier]         = useState('full'); // desk | spot | full
  const [publishState, setPublishState]   = useState('idle'); // idle | saving | done | error

  // ---------- reviewer (read-only external access) ----------
  // profile is the caller's own auditors row. The database is the security
  // authority; this only decides what the UI offers.
  const [profile, setProfile]             = useState(undefined); // undefined = not loaded
  const [auditsList, setAuditsList]       = useState([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError]     = useState(false); // the list failed to load
  const [openError, setOpenError]         = useState(false); // one audit failed to open
  const [reviewAuditId, setReviewAuditId] = useState(null);
  const [reviewMeta, setReviewMeta]       = useState(null); // { ref, date, status, tier }

  const shifts = (SHIFT_SYSTEMS[prop.shiftCount] || SHIFT_SYSTEMS['3']).shifts.map(s => ({ ...s, time: (prop.shiftTimes && prop.shiftTimes[s.id]) || s.time }));

  // ---------- auth ----------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  // A reviewer can read their own auditors row (policy: id = auth.uid()).
  // A signed-in account with no row, or an expired one, resolves to no role.
  useEffect(() => {
    if (!session) { setProfile(session === null ? null : undefined); return; }
    let cancelled = false;
    supabase.from('auditors').select('role, access_expires_at').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setProfile(data || null); })
      .catch(() => { if (!cancelled) setProfile(null); });
    return () => { cancelled = true; };
  }, [session]);

  const role         = profile && profile.role ? profile.role : null;
  const isReviewer   = role === 'reviewer';
  const readOnly     = isReviewer;
  const expiresAt    = profile && profile.access_expires_at ? profile.access_expires_at : null;
  // Expiry is enforced by the database. This only picks the right empty state
  // so the reviewer sees a sentence instead of an empty list.
  const accessExpired = !!(expiresAt && new Date(expiresAt).getTime() <= Date.now());

  // A reviewer never enters setup, capture or publish. With no audit open they
  // are always on the browse list.
  useEffect(() => {
    if (!isReviewer) return;
    if (screen === 'setup' || screen === 'finish') { setScreen('review'); return; }
    if (!reviewAuditId && screen !== 'review' && screen !== 'login') setScreen('review');
  }, [isReviewer, reviewAuditId, screen]);

  // Audit list for the reviewer browse screen. RLS returns every audit for a
  // reviewer and only published ones for anybody else, so this needs no filter.
  useEffect(() => {
    if (screen !== 'review' || !session || !isReviewer) return;
    // Deliberately does not touch openError: returning to this screen after a
    // failed open would otherwise clear the message before it could be read.
    setBrowseLoading(true); setBrowseError(false);
    supabase.from('audits')
      .select('id, ref, date, status, tier, property_id, properties(name, city, country)')
      .order('date', { ascending: false })
      .then(({ data, error }) => {
        setBrowseLoading(false);
        if (error) { setBrowseError(true); return; }
        setAuditsList(data || []);
      });
  }, [screen, session, isReviewer]);

  const signIn = async () => {
    setAuthError('');
    setAuthBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    setAuthBusy(false);
    if (error) {
      setAuthError(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
    } else {
      setScreen(prop.name ? 'home' : 'setup');
    }
  };

  const openAuditForReview = async (row) => {
    setOpenError(false);
    setScreen('loading');
    try {
      const { data: propRow, error: pErr } = await supabase
        .from('properties').select('*').eq('id', row.property_id).single();
      if (pErr) throw pErr;
      const { data: items, error: iErr } = await supabase
        .from('audit_items').select('*').eq('audit_id', row.id);
      if (iErr) throw iErr;

      const nextProp = rowToProp(propRow);
      const nextAudit = {};
      (items || []).forEach(r => {
        nextAudit[r.item_id] = nextAudit[r.item_id] || {};
        nextAudit[r.item_id][r.shift_id] = {
          status: r.status, note: r.note, time: r.time, critical: r.critical,
        };
      });
      const sys = SHIFT_SYSTEMS[nextProp.shiftCount] || SHIFT_SYSTEMS['3'];

      setProp(nextProp);
      setAudit(nextAudit);
      setIds({ propertyId: row.property_id, auditId: row.id, auditRef: row.ref });
      setReviewMeta({ ref: row.ref, date: row.date, status: row.status, tier: row.tier });
      setReviewAuditId(row.id);
      setActiveShiftId(sys.shifts[0].id);
      setActiveSection(null);
      setOpenNotes({});
      setSyncState('synced');
      setScreen('home');
    } catch (e) {
      setReviewAuditId(null);
      setOpenError(true);
      setScreen('review');
    }
  };

  const closeReviewAudit = () => {
    setReviewAuditId(null);
    setReviewMeta(null);
    setIds({ propertyId: null, auditId: null, auditRef: null });
    setAudit({});
    setActiveSection(null);
    setScreen('review');
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setAuthEmail(''); setAuthPassword('');
    setProfile(null); setAuditsList([]); setReviewAuditId(null); setReviewMeta(null);
    setOpenError(false); setBrowseError(false);
    setScreen('login');
  };

  // ---------- load: local cache first (works offline), then remote if signed in ----------
  useEffect(() => {
    (async () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const data = JSON.parse(raw);
          if (data.prop) setProp(data.prop);
          if (data.audit) setAudit(data.audit);
          if (data.ids) setIds(data.ids);
          const sys = SHIFT_SYSTEMS[data.prop && data.prop.shiftCount] || SHIFT_SYSTEMS['3'];
          setActiveShiftId(sys.shifts[0].id);
          setScreen(data.prop && data.prop.name ? 'home' : 'setup');
        } else {
          setScreen(session ? 'setup' : (session === null ? 'login' : 'loading'));
        }
      } catch(e) { setScreen(session === null ? 'login' : 'setup'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session === undefined]);

  // once signed in, if there's an auditId already known, pull the latest remote copy
  // (covers: same auditor picks this up on a second device)
  useEffect(() => {
    if (!session || !ids.auditId) return;
    (async () => {
      try {
        const { data: items, error } = await supabase
          .from('audit_items').select('*').eq('audit_id', ids.auditId);
        if (error) throw error;
        if (items && items.length) {
          const remoteAudit = {};
          items.forEach(row => {
            remoteAudit[row.item_id] = remoteAudit[row.item_id] || {};
            // critical must be carried across too: it is written by pushItem, it
            // drives getCriticalFailures(), and that decides both the published
            // critical_failures payload and whether the audit meets the standard.
            remoteAudit[row.item_id][row.shift_id] = { status: row.status, note: row.note, time: row.time, critical: !!row.critical };
          });
          setAudit(remoteAudit);
        }
        setSyncState('synced');
      } catch (e) { setSyncState('error'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, ids.auditId]);

  const persist = useCallback(async (p, a, i) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ prop: p, audit: a, ids: i })); } catch(e) {}
  }, []);

  // creates (or reuses) the property + audit rows in Supabase once the auditor hits BEGIN AUDIT
  const ensureRemoteAudit = async () => {
    if (!session || readOnly) return ids;
    try {
      const userId = session.user.id;
      await supabase.from('auditors').upsert({ id: userId, name: session.user.email }, { onConflict: 'id' });

      let propertyId = ids.propertyId;
      if (!propertyId) {
        const { data, error } = await supabase.from('properties').insert(propToRow(prop, userId)).select('id').single();
        if (error) throw error;
        propertyId = data.id;
      } else {
        await supabase.from('properties').update(propToRow(prop, userId)).eq('id', propertyId);
      }

      let auditId = ids.auditId;
      let auditRef = ids.auditRef;
      if (!auditId) {
        const ref = genRef();
        const { data, error } = await supabase.from('audits')
          .insert({ ref, property_id: propertyId, auditor_id: userId, status: 'draft' })
          .select('id').single();
        if (error) throw error;
        auditId = data.id;
        auditRef = ref;
      }

      const nextIds = { propertyId, auditId, auditRef };
      setIds(nextIds);
      setSyncState('synced');
      return nextIds;
    } catch (e) {
      setSyncState('error');
      return ids;
    }
  };

  const pushItem = async (auditId, itemId, shiftId, patch) => {
    if (!session || !auditId || readOnly) return;
    const meta = ITEM_INDEX[itemId];
    if (!meta) return;
    try {
      const { error } = await supabase.from('audit_items').upsert({
        audit_id: auditId, item_id: itemId, section_id: meta.sectionId, label: meta.label,
        shift_id: shiftId, ...patch,
      }, { onConflict: 'audit_id,item_id,shift_id' });
      if (error) throw error;
      setSyncState('synced');
    } catch (e) { setSyncState('error'); }
  };

  const updateProp = (field, value) => setProp(p => ({ ...p, [field]: value }));
  const updateShiftTime = (shiftId, time) => setProp(p => ({ ...p, shiftTimes: { ...p.shiftTimes, [shiftId]: time } }));
  const toggleRoomType = (rt) => setProp(p => ({ ...p, roomTypes: p.roomTypes.includes(rt) ? p.roomTypes.filter(x => x !== rt) : [...p.roomTypes, rt] }));

  const setStatus = (itemId, status) => {
    const prev = audit[itemId] || {};
    const shiftPrev = prev[activeShiftId] || {};
    const time = shiftPrev.time || nowTime();
    const updated = { ...audit, [itemId]: { ...prev, [activeShiftId]: { ...shiftPrev, status, time } } };
    setAudit(updated); persist(prop, updated, ids);
    if (ids.auditId) pushItem(ids.auditId, itemId, activeShiftId, { status, time, note: shiftPrev.note || null, critical: !!shiftPrev.critical });
  };

  const setNote = (itemId, note) => {
    const prev = audit[itemId] || {};
    const shiftPrev = prev[activeShiftId] || {};
    const updated = { ...audit, [itemId]: { ...prev, [activeShiftId]: { ...shiftPrev, note } } };
    setAudit(updated); persist(prop, updated, ids);
    if (ids.auditId) pushItem(ids.auditId, itemId, activeShiftId, { status: shiftPrev.status || null, note, time: shiftPrev.time || null, critical: !!shiftPrev.critical });
  };

  const toggleCritical = (itemId) => {
    const prev = audit[itemId] || {};
    const shiftPrev = prev[activeShiftId] || {};
    const critical = !shiftPrev.critical;
    const updated = { ...audit, [itemId]: { ...prev, [activeShiftId]: { ...shiftPrev, critical } } };
    setAudit(updated); persist(prop, updated, ids);
    if (ids.auditId) pushItem(ids.auditId, itemId, activeShiftId, { status: shiftPrev.status || null, note: shiftPrev.note || null, time: shiftPrev.time || null, critical });
  };

  // every item ever flagged critical, across all shifts, regardless of current shift selection
  const getCriticalFailures = () => {
    const out = [];
    Object.entries(audit).forEach(([itemId, byShift]) => {
      Object.entries(byShift).forEach(([shiftId, entry]) => {
        if (entry && entry.critical) {
          const meta = ITEM_INDEX[itemId];
          out.push({ itemId, shiftId, label: meta ? meta.label : itemId, status: entry.status || null, note: entry.note || null });
        }
      });
    });
    return out;
  };

  const PASS_THRESHOLD = 85;

  const getScorePct = () => {
    const priority = { missed: 3, partial: 2, na: 1, met: 0 };
    const worst = {};
    Object.entries(audit).forEach(([itemId, byShift]) => {
      Object.values(byShift).forEach(entry => {
        if (!entry || !entry.status) return;
        const cur = worst[itemId];
        if (!cur || (priority[entry.status] || 0) > (priority[cur] || 0)) worst[itemId] = entry.status;
      });
    });
    const statuses = Object.values(worst);
    const met = statuses.filter(s => s === 'met').length;
    const partial = statuses.filter(s => s === 'partial').length;
    const missed = statuses.filter(s => s === 'missed').length;
    const graded = met + partial + missed;
    return graded ? Math.round((met / graded) * 100) : null;
  };

  const publishAudit = async (summary, tier) => {
    if (!ids.auditId || readOnly) return { ok: false, reason: 'no-audit' };
    const failures = getCriticalFailures();
    try {
      const { error } = await supabase.from('audits').update({
        status: 'published',
        auditor_summary: summary,
        critical_failures: failures,
        tier,
      }).eq('id', ids.auditId);
      if (error) throw error;
      setSyncState('synced');
      return { ok: true };
    } catch (e) {
      setSyncState('error');
      return { ok: false, reason: 'error' };
    }
  };

  const rank = STAR_RANK[prop.category] || 4;
  const visibleSections = SECTIONS.filter(s => !s.facility || prop[s.facility]);
  const getActiveData = (itemId) => (audit[itemId] || {})[activeShiftId] || {};
  const getShiftData  = (itemId, shiftId) => (audit[itemId] || {})[shiftId] || {};

  const isInconsistent = (itemId) => {
    const statuses = shifts.map(s => (audit[itemId] || {})[s.id] && (audit[itemId] || {})[s.id].status).filter(Boolean);
    return statuses.length > 1 && new Set(statuses).size > 1;
  };

  const getSectionStats = (section) => {
    const applicable = section.items.filter(i => i.minStars <= rank);
    const done = applicable.filter(i => shifts.some(s => (audit[i.id] || {})[s.id] && (audit[i.id] || {})[s.id].status));
    const missed = applicable.filter(i => shifts.some(s => ((audit[i.id] || {})[s.id] || {}).status === 'missed')).length;
    const inconsistent = applicable.filter(i => isInconsistent(i.id)).length;
    return { total: applicable.length, done: done.length, missed, inconsistent };
  };

  const getOverallProgress = () => {
    const all = visibleSections.flatMap(s => s.items.filter(i => i.minStars <= rank));
    const done = all.filter(i => shifts.some(sh => ((audit[i.id] || {})[sh.id] || {}).status));
    return { total: all.length, done: done.length };
  };

  const appStyle = { minHeight: '100vh', background: C.bg, color: C.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", sans-serif', fontSize: '15px' };
  const headerStyle = { background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '54px', position: 'sticky', top: 0, zIndex: 100 };
  const logoStyle = { fontSize: '12px', fontWeight: '700', letterSpacing: '0.18em', color: C.gold };
  const bodyStyle = { maxWidth: '600px', margin: '0 auto', padding: '24px 16px 48px' };
  const card = (extra = {}) => ({ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '18px 20px', marginBottom: '10px', ...extra });
  const lbl = { fontSize: '11px', fontWeight: '600', letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, marginBottom: '8px', display: 'block' };
  const inp = { width: '100%', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '11px 14px', color: C.text, fontSize: '15px', outline: 'none', boxSizing: 'border-box' };

  // Persistent, quiet mode indicator. Same palette and letter-spacing as the
  // existing eyebrow labels; no new colour, no banner.
  const ReviewBar = () => (
    <div style={{
      background: C.surface2, borderBottom: `1px solid ${C.border}`,
      padding: '7px 16px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.14em', color: C.gold }}>
        READ-ONLY REVIEW ACCESS
      </span>
      {expiresAt && !accessExpired && (
        <span style={{ fontSize: '10px', color: C.muted, letterSpacing: '0.04em' }}>
          Review access until {fmtDate(expiresAt)}
        </span>
      )}
    </div>
  );

  const ShiftBar = () => (
    <div style={{ background: C.surface2, borderBottom: `1px solid ${C.border}`, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto' }}>
      <span style={{ fontSize: '11px', color: C.muted, letterSpacing: '0.08em', fontWeight: '600', whiteSpace: 'nowrap', flexShrink: 0 }}>SHIFT</span>
      {shifts.map(sh => {
        const active = activeShiftId === sh.id;
        return (
          <button key={sh.id} onClick={() => setActiveShiftId(sh.id)} style={{
            padding: '6px 12px', borderRadius: '20px', border: `1px solid ${active ? C.gold : C.border}`,
            background: active ? C.goldBg : 'transparent', color: active ? C.gold : C.dim,
            fontSize: '12px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {sh.label} <span style={{ fontSize: '10px', opacity: 0.65 }}>{sh.time}</span>
          </button>
        );
      })}
      {prop.rotationPattern && (
        <span style={{ marginLeft: 'auto', fontSize: '10px', color: C.muted, border: `1px solid ${C.border}`, padding: '4px 8px', borderRadius: '4px', whiteSpace: 'nowrap', letterSpacing: '0.06em', flexShrink: 0 }}>
          {prop.rotationPattern}
        </span>
      )}
    </div>
  );

  if (screen === 'loading') return (
    <div style={{ ...appStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={logoStyle}>A · H · P</span>
    </div>
  );

  if (screen === 'login') {
    return (
      <div style={{ ...appStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ width: '100%', maxWidth: '360px' }}>
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={logoStyle}>A · H · P</div>
            <p style={{ color: C.dim, fontSize: '13px', marginTop: '10px' }}>Sign in to sync your audits across devices</p>
          </div>
          <div style={card()}>
            <span style={lbl}>Email</span>
            <input style={inp} type="email" autoComplete="username" placeholder="you@specula.com" value={authEmail} onChange={e => setAuthEmail(e.target.value)} />
            <div style={{ marginTop: '14px' }}>
              <span style={lbl}>Password</span>
              <input style={inp} type="password" autoComplete="current-password" placeholder="••••••••" value={authPassword}
                onChange={e => setAuthPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && authEmail && authPassword && !authBusy) signIn(); }} />
            </div>
            {authError && <div style={{ color: '#E05555', fontSize: '12px', marginTop: '10px' }}>{authError}</div>}
            <button onClick={signIn} disabled={!authEmail || !authPassword || authBusy} style={{ width: '100%', marginTop: '16px', padding: '12px', borderRadius: '9px', border: 'none', background: (authEmail && authPassword && !authBusy) ? C.gold : C.surface2, color: (authEmail && authPassword) ? '#0C0C0F' : C.muted, fontSize: '13px', fontWeight: '700', cursor: (authEmail && authPassword) ? 'pointer' : 'default' }}>
              {authBusy ? 'SIGNING IN…' : 'SIGN IN'}
            </button>
            <button onClick={() => setScreen('setup')} style={{ width: '100%', marginTop: '10px', padding: '10px', borderRadius: '9px', border: 'none', background: 'none', color: C.muted, fontSize: '12px', cursor: 'pointer' }}>
              Continue offline instead
            </button>
            <div style={{ marginTop: '14px', fontSize: '11px', color: C.muted, textAlign: 'center' }}>
              Accounts are created by the team admin — contact them if you don't have one yet.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (screen === 'setup') {
    const canStart = prop.name && prop.city && prop.roomCount;
    const currentShifts = (SHIFT_SYSTEMS[prop.shiftCount] || SHIFT_SYSTEMS['3']).shifts.map(s => ({ ...s, time: (prop.shiftTimes && prop.shiftTimes[s.id]) || s.time }));
    return (
      <div style={appStyle}>
        <div style={headerStyle}>
          <span style={logoStyle}>A · H · P</span>
          <span style={{ fontSize: '12px', color: C.muted }}>New Audit</span>
        </div>
        <div style={bodyStyle}>
          <div style={{ marginBottom: '28px' }}>
            <h1 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 6px' }}>Property Setup</h1>
            <p style={{ color: C.dim, fontSize: '14px', margin: 0 }}>Configure before the audit begins</p>
          </div>

          <div style={card()}>
            <div style={{ marginBottom: '16px' }}>
              <span style={lbl}>Property Name</span>
              <input style={inp} placeholder="NH Madrid Ribera del Manzanares" value={prop.name} onChange={e => updateProp('name', e.target.value)} />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <span style={lbl}>City</span>
              <input style={inp} placeholder="Madrid" value={prop.city} onChange={e => updateProp('city', e.target.value)} />
            </div>
            <div>
              <span style={lbl}>Country</span>
              <input style={inp} placeholder="Spain" value={prop.country} onChange={e => updateProp('country', e.target.value)} />
            </div>
          </div>

          <div style={card()}>
            <div onClick={() => updateProp('chain', !prop.chain)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: prop.chain ? '14px' : 0 }}>
              <span style={{ fontSize: '14px', color: prop.chain ? C.text : C.dim }}>Part of a hotel chain</span>
              <div style={{ width: '42px', height: '24px', borderRadius: '12px', background: prop.chain ? C.gold : C.border, position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: '3px', width: '18px', height: '18px', borderRadius: '50%', transition: 'left 0.2s', left: prop.chain ? '21px' : '3px', background: prop.chain ? '#0C0C0F' : C.muted }} />
              </div>
            </div>
            {prop.chain && (
              <div>
                <span style={lbl}>Chain Name</span>
                <input style={inp} placeholder="e.g. NH Hotels" value={prop.chainName} onChange={e => updateProp('chainName', e.target.value)} />
              </div>
            )}
          </div>

          <div style={card()}>
            <span style={lbl}>Category</span>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
              {STAR_LABELS.map(cat => {
                const active = prop.category === cat;
                return <button key={cat} onClick={() => updateProp('category', cat)} style={{ flex: 1, padding: '12px 6px', borderRadius: '8px', cursor: 'pointer', border: `1px solid ${active ? C.gold : C.border}`, background: active ? C.goldBg : 'transparent', color: active ? C.gold : C.dim, fontSize: '13px', fontWeight: '600' }}>{cat}</button>;
              })}
            </div>
            <div style={{ fontSize: '12px', color: C.muted }}>
              {prop.category === '4★' && 'Standard items. 5★ and Ultra items marked not required.'}
              {prop.category === '5★' && 'All 4★ items + elevated service criteria.'}
              {prop.category === 'Ultra' && 'Full checklist — all tiers active.'}
            </div>
          </div>

          <div style={card()}>
            <span style={lbl}>Total Rooms</span>
            <input style={{ ...inp, width: '40%' }} type="number" placeholder="109" value={prop.roomCount} onChange={e => updateProp('roomCount', e.target.value)} />
          </div>

          <div style={card()}>
            <span style={lbl}>Room Types Present</span>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {ROOM_TYPES.map(rt => {
                const active = prop.roomTypes.includes(rt);
                return <button key={rt} onClick={() => toggleRoomType(rt)} style={{ padding: '9px 14px', borderRadius: '8px', cursor: 'pointer', border: `1px solid ${active ? C.gold : C.border}`, background: active ? C.goldBg : 'transparent', color: active ? C.gold : C.dim, fontSize: '13px', fontWeight: '600' }}>{rt}</button>;
              })}
            </div>
          </div>

          <div style={card()}>
            <span style={lbl}>Shift System</span>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              {['2', '3'].map(n => {
                const active = prop.shiftCount === n;
                return <button key={n} onClick={() => updateProp('shiftCount', n)} style={{ flex: 1, padding: '12px 8px', borderRadius: '8px', cursor: 'pointer', border: `1px solid ${active ? C.gold : C.border}`, background: active ? C.goldBg : 'transparent', color: active ? C.gold : C.dim, fontSize: '13px', fontWeight: '600' }}>{SHIFT_SYSTEMS[n].label}</button>;
              })}
            </div>
            <div style={{ marginBottom: '16px' }}>
              {currentShifts.map((sh, i) => (
                <div key={sh.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < currentShifts.length - 1 ? `1px solid ${C.border}` : 'none', fontSize: '13px', gap: '10px' }}>
                  <span style={{ color: C.text, fontWeight: '500', flexShrink: 0 }}>{sh.label}</span>
                  <input style={{ ...inp, width: '130px', padding: '6px 10px', fontSize: '13px', textAlign: 'right' }} placeholder={sh.time} value={(prop.shiftTimes && prop.shiftTimes[sh.id]) || ''} onChange={e => updateShiftTime(sh.id, e.target.value)} />
                </div>
              ))}
            </div>
            <span style={lbl}>Rotation Pattern</span>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {ROTATION_LABELS.map(r => {
                const active = prop.rotationPattern === r;
                return <button key={r} onClick={() => updateProp('rotationPattern', active ? '' : r)} style={{ padding: '7px 14px', borderRadius: '6px', cursor: 'pointer', border: `1px solid ${active ? C.gold : C.border}`, background: active ? C.goldBg : 'transparent', color: active ? C.gold : C.dim, fontSize: '12px', fontWeight: '600' }}>{r}</button>;
              })}
            </div>
          </div>

          <div style={card()}>
            <span style={lbl}>Facilities Present</span>
            {[{ key: 'hasRestaurant', label: 'Restaurant / F&B' }, { key: 'hasPool', label: 'Pool' }, { key: 'hasSpa', label: 'Spa & Wellness' }].map((f, i, arr) => (
              <div key={f.key} onClick={() => updateProp(f.key, !prop[f.key])} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 0', cursor: 'pointer', borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <span style={{ fontSize: '14px', color: prop[f.key] ? C.text : C.dim }}>{f.label}</span>
                <div style={{ width: '42px', height: '24px', borderRadius: '12px', background: prop[f.key] ? C.gold : C.border, position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: '3px', width: '18px', height: '18px', borderRadius: '50%', transition: 'left 0.2s', left: prop[f.key] ? '21px' : '3px', background: prop[f.key] ? '#0C0C0F' : C.muted }} />
                </div>
              </div>
            ))}
            {prop.hasPool && (
              <div style={{ paddingTop: '14px', borderTop: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', gap: '16px', marginBottom: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <span style={lbl}>Number of Pools</span>
                    <input style={inp} type="number" placeholder="1" value={prop.poolCount} onChange={e => updateProp('poolCount', e.target.value)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={lbl}>Pool Capacity (max persons)</span>
                    <input style={inp} type="number" placeholder="15" value={prop.poolCapacity} onChange={e => updateProp('poolCapacity', e.target.value)} />
                  </div>
                </div>
                {prop.poolCapacity && prop.roomCount && (
                  <div style={{ fontSize: '12px', color: C.muted }}>
                    1 pool space per {Math.round(prop.roomCount / prop.poolCapacity)} rooms
                    {Math.round(prop.roomCount / prop.poolCapacity) > 10 && <span style={{ color: C.warn, marginLeft: '6px' }}>· High demand risk</span>}
                  </div>
                )}
              </div>
            )}
            {prop.hasRestaurant && (
              <div style={{ paddingTop: '14px', borderTop: `1px solid ${C.border}` }}>
                <div style={{ marginBottom: '14px' }}>
                  <span style={lbl}>Seating Capacity</span>
                  <input style={{ ...inp, width: '40%' }} type="number" placeholder="80" value={prop.fbCapacity} onChange={e => updateProp('fbCapacity', e.target.value)} />
                </div>
                <div style={{ marginBottom: '14px' }}>
                  <span style={lbl}>Menu Variety</span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {MENU_VARIETY.map(v => {
                      const active = prop.menuVariety === v;
                      return <button key={v} onClick={() => updateProp('menuVariety', active ? '' : v)} style={{ flex: 1, padding: '9px 4px', borderRadius: '7px', cursor: 'pointer', border: `1px solid ${active ? C.gold : C.border}`, background: active ? C.goldBg : 'transparent', color: active ? C.gold : C.dim, fontSize: '12px', fontWeight: '600' }}>{v}</button>;
                    })}
                  </div>
                </div>
                <div style={{ marginBottom: '14px' }}>
                  <span style={lbl}>Menu Complexity</span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {MENU_COMPLEXITY.map(v => {
                      const active = prop.menuComplexity === v;
                      return <button key={v} onClick={() => updateProp('menuComplexity', active ? '' : v)} style={{ flex: 1, padding: '9px 4px', borderRadius: '7px', cursor: 'pointer', border: `1px solid ${active ? C.gold : C.border}`, background: active ? C.goldBg : 'transparent', color: active ? C.gold : C.dim, fontSize: '12px', fontWeight: '600' }}>{v}</button>;
                    })}
                  </div>
                </div>
                <div onClick={() => updateProp('authenticCuisine', !prop.authenticCuisine)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', cursor: 'pointer', borderTop: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: '14px', color: prop.authenticCuisine ? C.text : C.dim }}>Authentic local cuisine</span>
                  <div style={{ width: '42px', height: '24px', borderRadius: '12px', background: prop.authenticCuisine ? C.gold : C.border, position: 'relative', flexShrink: 0 }}>
                    <div style={{ position: 'absolute', top: '3px', width: '18px', height: '18px', borderRadius: '50%', left: prop.authenticCuisine ? '21px' : '3px', background: prop.authenticCuisine ? '#0C0C0F' : C.muted }} />
                  </div>
                </div>
                <div onClick={() => updateProp('hasWineList', !prop.hasWineList)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', cursor: 'pointer', borderTop: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: '14px', color: prop.hasWineList ? C.text : C.dim }}>Dedicated wine list</span>
                  <div style={{ width: '42px', height: '24px', borderRadius: '12px', background: prop.hasWineList ? C.gold : C.border, position: 'relative', flexShrink: 0 }}>
                    <div style={{ position: 'absolute', top: '3px', width: '18px', height: '18px', borderRadius: '50%', left: prop.hasWineList ? '21px' : '3px', background: prop.hasWineList ? '#0C0C0F' : C.muted }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <button disabled={!canStart} onClick={async () => {
            const sys = SHIFT_SYSTEMS[prop.shiftCount] || SHIFT_SYSTEMS['3'];
            setActiveShiftId(sys.shifts[0].id);
            const nextIds = await ensureRemoteAudit();
            persist(prop, audit, nextIds);
            setScreen('home');
          }} style={{ width: '100%', padding: '14px', borderRadius: '10px', border: 'none', background: canStart ? C.gold : C.surface2, color: canStart ? '#0C0C0F' : C.muted, fontSize: '14px', fontWeight: '700', letterSpacing: '0.06em', cursor: canStart ? 'pointer' : 'default' }}>
            BEGIN AUDIT
          </button>
          {!session && (
            <div style={{ textAlign: 'center', marginTop: '10px' }}>
              <button onClick={() => setScreen('login')} style={{ background: 'none', border: 'none', color: C.muted, fontSize: '12px', cursor: 'pointer' }}>Sign in to sync this audit across devices</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- reviewer: browse ----------
  if (screen === 'review') {
    return (
      <div style={appStyle}>
        <div style={headerStyle}>
          <span style={logoStyle}>A · H · P</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {session && (
              <span style={{ fontSize: '11px', color: C.dim, maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={session.user.email}>
                {session.user.email}
              </span>
            )}
            <button onClick={signOut} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: '12px', padding: 0 }}>Sign out</button>
          </div>
        </div>
        <ReviewBar />
        <div style={bodyStyle}>
          {accessExpired ? (
            <div style={{ padding: '48px 0', textAlign: 'center' }}>
              <div style={{ fontSize: '15px', fontWeight: '600', marginBottom: '10px' }}>Your review access is no longer active.</div>
              <div style={{ fontSize: '13px', color: C.dim, lineHeight: '1.6' }}>Please contact Specula if you believe this is an error.</div>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '11px', color: C.gold, letterSpacing: '0.1em', fontWeight: '600', marginBottom: '5px' }}>AUDIT REVIEW</div>
                <h1 style={{ fontSize: '19px', fontWeight: '700', margin: '0 0 3px' }}>All audits</h1>
                <div style={{ fontSize: '12px', color: C.dim }}>
                  {browseLoading ? 'Loading…' : `${auditsList.length} audit${auditsList.length === 1 ? '' : 's'}`}
                </div>
              </div>

              {openError && (
                <div style={{ marginBottom: '12px', padding: '12px 14px', borderRadius: '8px', background: C.warnBg, border: '1px solid rgba(245,166,35,0.25)' }}>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: C.warn, marginBottom: '3px' }}>That audit could not be opened.</div>
                  <div style={{ fontSize: '12px', color: C.dim, lineHeight: '1.5' }}>Please try again. If it keeps happening, contact Specula.</div>
                </div>
              )}

              {browseError && (
                <div style={{ padding: '32px 0', textAlign: 'center' }}>
                  <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px' }}>Those audits could not be loaded.</div>
                  <div style={{ fontSize: '13px', color: C.dim }}>Please contact Specula if this continues.</div>
                </div>
              )}

              {!browseLoading && !browseError && auditsList.length === 0 && (
                <div style={{ padding: '32px 0', textAlign: 'center' }}>
                  <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px' }}>No audits are available to review.</div>
                  <div style={{ fontSize: '13px', color: C.dim }}>Please contact Specula if you were expecting to see audits here.</div>
                </div>
              )}

              {!browseError && auditsList.map(a => {
                const p = a.properties || {};
                const place = [p.city, p.country].filter(Boolean).join(', ');
                const published = a.status === 'published';
                return (
                  <div key={a.id} onClick={() => openAuditForReview(a)}
                    style={card({ display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer' })}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '10px', color: C.muted, letterSpacing: '0.08em', fontWeight: '600' }}>{a.ref}</span>
                        <span style={{
                          fontSize: '10px', fontWeight: '600', letterSpacing: '0.04em', padding: '1px 6px', borderRadius: '4px',
                          color: published ? '#4DC87A' : C.dim,
                          background: published ? 'rgba(77,200,122,0.12)' : 'transparent',
                          border: `1px solid ${published ? 'rgba(77,200,122,0.35)' : C.border}`,
                        }}>{published ? 'Published' : 'Draft'}</span>
                        {a.tier && <span style={{ fontSize: '10px', color: C.muted, letterSpacing: '0.04em' }}>{a.tier}</span>}
                      </div>
                      <div style={{ fontWeight: '600', fontSize: '14px', marginBottom: '3px' }}>{p.name || 'Unnamed property'}</div>
                      <div style={{ fontSize: '12px', color: C.dim }}>
                        {place}{place && a.date ? ' · ' : ''}{fmtDate(a.date)}
                      </div>
                    </div>
                    <span style={{ color: C.muted, fontSize: '20px', flexShrink: 0 }}>›</span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    );
  }

  if (screen === 'home') {
    const { total, done } = getOverallProgress();
    const pct = total ? Math.round((done / total) * 100) : 0;
    const totalInconsistent = visibleSections.reduce((acc, s) => acc + getSectionStats(s).inconsistent, 0);
    return (
      <div style={appStyle}>
        <div style={headerStyle}>
          <span style={logoStyle}>A · H · P</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {session && (
              <span style={{ fontSize: '11px', color: C.dim, maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={session.user.email}>
                {session.user.email}
              </span>
            )}
            <span style={{ fontSize: '10px', fontWeight: '600', letterSpacing: '0.06em', color: !session ? C.muted : syncState === 'synced' ? '#4DC87A' : syncState === 'error' ? C.warn : C.muted }}>
              {!session ? 'OFFLINE' : syncState === 'synced' ? 'SYNCED' : syncState === 'error' ? 'SYNC ERROR' : 'LOCAL'}
            </span>
            {readOnly ? (
              <button onClick={closeReviewAudit} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: '13px', padding: 0 }}>All audits</button>
            ) : (
              <button onClick={() => setScreen('setup')} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: '13px', padding: 0 }}>Edit</button>
            )}
            {session && (
              <button onClick={signOut} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: '12px', padding: 0 }}>Sign out</button>
            )}
          </div>
        </div>
        {readOnly && <ReviewBar />}
        <ShiftBar />
        <div style={bodyStyle}>
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '11px', color: C.gold, letterSpacing: '0.1em', fontWeight: '600', marginBottom: '5px' }}>{prop.category} · {prop.city}{prop.country ? ', ' + prop.country : ''}</div>
            <h1 style={{ fontSize: '19px', fontWeight: '700', margin: '0 0 3px' }}>{prop.name}</h1>
            {readOnly && reviewMeta && (
              <div style={{ fontSize: '11px', color: C.muted, letterSpacing: '0.06em', marginBottom: '4px' }}>
                {reviewMeta.ref}{reviewMeta.date ? ' · ' + fmtDate(reviewMeta.date) : ''}
                {reviewMeta.status ? ' · ' + (reviewMeta.status === 'published' ? 'Published' : 'Draft') : ''}
                {reviewMeta.tier ? ' · ' + reviewMeta.tier : ''}
              </div>
            )}
            <div style={{ fontSize: '12px', color: C.dim }}>
              {prop.chain ? (prop.chainName || 'Chain') : 'Independent'} · {prop.roomCount} rooms{prop.roomTypes.length ? ' (' + prop.roomTypes.join(', ') + ')' : ''} · {(SHIFT_SYSTEMS[prop.shiftCount] || SHIFT_SYSTEMS['3']).label}{prop.rotationPattern ? ' · ' + prop.rotationPattern : ''}
            </div>
          </div>

          <div style={card({ padding: '16px 18px', marginBottom: '14px' })}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ fontSize: '13px', color: C.dim }}>Overall Progress</span>
              <span style={{ fontSize: '13px', fontWeight: '600', color: pct === 100 ? C.gold : C.text }}>{done}/{total} · {pct}%</span>
            </div>
            <div style={{ height: '3px', background: C.border, borderRadius: '2px' }}>
              <div style={{ height: '100%', width: pct + '%', background: C.gold, borderRadius: '2px', transition: 'width 0.3s' }} />
            </div>
            {totalInconsistent > 0 && (
              <div style={{ marginTop: '12px', padding: '8px 12px', borderRadius: '7px', background: C.warnBg, border: '1px solid rgba(245,166,35,0.25)', fontSize: '12px', color: C.warn }}>
                {totalInconsistent} item{totalInconsistent > 1 ? 's' : ''} inconsistent across shifts
              </div>
            )}
          </div>

          {visibleSections.map(section => {
            const { total: st, done: sd, missed, inconsistent } = getSectionStats(section);
            const allDone = sd === st && st > 0;
            return (
              <div key={section.id} onClick={() => { setActiveSection(section.id); setScreen('section'); }}
                style={card({ display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer', borderColor: allDone ? 'rgba(77,200,122,0.3)' : C.border })}>
                <div style={{ width: '38px', height: '38px', borderRadius: '9px', background: C.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px', color: C.gold, flexShrink: 0 }}>{section.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: '600', fontSize: '14px', marginBottom: '3px' }}>{section.label}</div>
                  <div style={{ fontSize: '12px', color: C.dim }}>
                    {sd}/{st} complete
                    {missed > 0 && <span style={{ color: '#E05555', marginLeft: '8px' }}>· {missed} missed</span>}
                    {inconsistent > 0 && <span style={{ color: C.warn, marginLeft: '8px' }}>· {inconsistent} inconsistent</span>}
                    {allDone && <span style={{ color: '#4DC87A', marginLeft: '8px' }}>✓</span>}
                  </div>
                </div>
                <span style={{ color: C.muted, fontSize: '20px', flexShrink: 0 }}>›</span>
              </div>
            );
          })}

          {!readOnly && (
            <button onClick={() => setScreen('finish')} style={{ width: '100%', marginTop: '8px', padding: '14px', borderRadius: '10px', border: `1px solid ${C.goldBorder}`, background: 'transparent', color: C.gold, fontSize: '13px', fontWeight: '700', letterSpacing: '0.05em', cursor: 'pointer' }}>
              FINISH AUDIT →
            </button>
          )}
        </div>
      </div>
    );
  }

  if (screen === 'finish') {
    const failures = getCriticalFailures();
    const scorePct = getScorePct();
    const willPass = auditTier !== 'desk' && failures.length === 0 && scorePct !== null && scorePct >= PASS_THRESHOLD;
    return (
      <div style={appStyle}>
        <div style={headerStyle}>
          <span style={logoStyle}>A · H · P</span>
          <button onClick={() => setScreen('home')} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: '13px', padding: 0 }}>Back</button>
        </div>
        <div style={bodyStyle}>
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '11px', color: C.gold, letterSpacing: '0.1em', fontWeight: '600', marginBottom: '5px' }}>FINISH & PUBLISH</div>
            <h1 style={{ fontSize: '19px', fontWeight: '700', margin: 0 }}>{prop.name}</h1>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <span style={lbl}>Audit Package</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[{ id: 'desk', label: 'Desk Review' }, { id: 'spot', label: 'Spot Audit' }, { id: 'full', label: 'Full Audit' }].map(t => {
                const active = auditTier === t.id;
                return <button key={t.id} onClick={() => setAuditTier(t.id)} style={{ flex: 1, padding: '10px 6px', borderRadius: '8px', cursor: 'pointer', border: `1px solid ${active ? C.gold : C.border}`, background: active ? C.goldBg : 'transparent', color: active ? C.gold : C.dim, fontSize: '12px', fontWeight: '600' }}>{t.label}</button>;
              })}
            </div>
            {auditTier === 'desk' && <div style={{ fontSize: '11px', color: C.muted, marginTop: '8px' }}>Desk reviews are internal only — no public seal is issued, regardless of score.</div>}
          </div>

          {scorePct !== null && (
            <div style={{ marginBottom: '20px', padding: '14px 16px', borderRadius: '10px', background: willPass ? 'rgba(77,200,122,0.1)' : C.surface2, border: `1px solid ${willPass ? 'rgba(77,200,122,0.35)' : C.border}` }}>
              <div style={{ fontSize: '13px', fontWeight: '700', color: willPass ? '#4DC87A' : C.dim }}>
                {auditTier === 'desk' ? `${scorePct}% — no seal (Desk Review)` : willPass ? `${scorePct}% — meets the standard` : `${scorePct}% — below ${PASS_THRESHOLD}% threshold`}
              </div>
              {failures.length > 0 && auditTier !== 'desk' && <div style={{ fontSize: '12px', color: C.warn, marginTop: '4px' }}>{failures.length} critical failure{failures.length > 1 ? 's' : ''} also blocks the seal, regardless of score.</div>}
            </div>
          )}

          <div style={{ marginBottom: '20px' }}>
            <span style={lbl}>Critical Failures ({failures.length})</span>
            {failures.length === 0 && (
              <div style={{ fontSize: '13px', color: C.dim, padding: '12px 0' }}>None flagged. Use "Flag critical" on any item during the audit to record one here.</div>
            )}
            {failures.map((f, i) => {
              const scfg = f.status ? STATUS[f.status] : null;
              return (
                <div key={i} style={card({ marginBottom: '8px', borderColor: 'rgba(224,85,85,0.35)' })}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '600' }}>{f.label}</span>
                    {scfg && <span style={{ fontSize: '11px', color: scfg.color }}>{scfg.label}</span>}
                  </div>
                  {f.note && <div style={{ fontSize: '12px', color: C.dim }}>{f.note}</div>}
                </div>
              );
            })}
          </div>

          <div style={{ marginBottom: '24px' }}>
            <span style={lbl}>Auditor Summary</span>
            <textarea rows={6} placeholder="Overall impression, standout moments, and anything the report should lead with..."
              value={summaryDraft} onChange={e => setSummaryDraft(e.target.value)}
              style={{ width: '100%', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '9px', padding: '12px 14px', color: C.text, fontSize: '14px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', lineHeight: '1.5', fontFamily: 'inherit' }}
            />
          </div>

          {!session && (
            <div style={{ marginBottom: '16px', padding: '10px 14px', borderRadius: '8px', background: C.warnBg, border: '1px solid rgba(245,166,35,0.25)', fontSize: '12px', color: C.warn }}>
              Sign in to publish — this audit is currently offline-only.
            </div>
          )}

          <button disabled={!session || publishState === 'saving'} onClick={async () => {
            setPublishState('saving');
            const res = await publishAudit(summaryDraft, auditTier);
            setPublishState(res.ok ? 'done' : 'error');
          }} style={{ width: '100%', padding: '14px', borderRadius: '10px', border: 'none', background: session ? C.gold : C.surface2, color: session ? '#0C0C0F' : C.muted, fontSize: '14px', fontWeight: '700', letterSpacing: '0.06em', cursor: session ? 'pointer' : 'default' }}>
            {publishState === 'saving' ? 'PUBLISHING…' : publishState === 'done' ? 'PUBLISHED ✓' : 'PUBLISH AUDIT'}
          </button>
          {publishState === 'error' && <div style={{ marginTop: '10px', fontSize: '12px', color: '#E05555' }}>Couldn't publish — check your connection and try again.</div>}
          {publishState === 'done' && (
            <div style={{ marginTop: '14px' }}>
              <div style={{ fontSize: '12px', color: '#4DC87A', marginBottom: '8px' }}>This audit is now live for {prop.name}.</div>
              {ids.auditRef && (
                <div style={{ padding: '12px 14px', borderRadius: '8px', background: C.surface2, border: `1px solid ${C.border}`, fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: C.dim, wordBreak: 'break-all' }}>
                  speculaone.com/report.html?ref={ids.auditRef}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (screen === 'section') {
    const section = SECTIONS.find(s => s.id === activeSection);
    if (!section) { setScreen('home'); return null; }
    return (
      <div style={appStyle}>
        <div style={headerStyle}>
          <button onClick={() => setScreen('home')} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: '22px', lineHeight: 1, padding: 0 }}>&#8249;</button>
          <span style={logoStyle}>A · H · P</span>
          <div style={{ width: '32px' }} />
        </div>
        {readOnly && <ReviewBar />}
        <ShiftBar />
        <div style={bodyStyle}>
          <div style={{ marginBottom: '22px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: '700', margin: '0 0 4px' }}>{section.label}</h2>
            <div style={{ fontSize: '12px', color: C.dim }}>{prop.name} · {prop.category}</div>
          </div>

          {section.items.map(item => {
            const applicable = item.minStars <= rank;
            const activeData = getActiveData(item.id);
            const cfg = activeData.status ? STATUS[activeData.status] : null;
            const noteVisible = openNotes[item.id] || activeData.note;
            const inconsistent = isInconsistent(item.id);
            const anyDone = shifts.some(sh => getShiftData(item.id, sh.id).status);

            return (
              <div key={item.id} style={card({ opacity: applicable ? 1 : 0.45, borderColor: activeData.critical ? 'rgba(224,85,85,0.5)' : inconsistent ? 'rgba(245,166,35,0.4)' : (cfg ? cfg.border : C.border) })}>
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '5px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '10px', color: C.muted, letterSpacing: '0.08em', fontWeight: '600' }}>{item.id}</span>
                    {!applicable && <span style={{ fontSize: '10px', fontWeight: '600', color: C.gold, background: C.goldBg, border: `1px solid ${C.goldBorder}`, padding: '1px 6px', borderRadius: '4px' }}>{item.minStars === 6 ? 'Ultra only' : '5★+'}</span>}
                    {inconsistent && <span style={{ fontSize: '10px', fontWeight: '600', color: C.warn, background: C.warnBg, border: '1px solid rgba(245,166,35,0.3)', padding: '1px 6px', borderRadius: '4px' }}>Inconsistent across shifts</span>}
                    {readOnly ? (
                      activeData.critical ? (
                        <span style={{
                          fontSize: '10px', fontWeight: '700', letterSpacing: '0.04em',
                          color: '#E05555', background: 'rgba(224,85,85,0.12)',
                          border: '1px solid rgba(224,85,85,0.4)', padding: '1px 6px', borderRadius: '4px',
                        }}>⚑ Critical</span>
                      ) : null
                    ) : (
                      <button onClick={() => toggleCritical(item.id)} style={{
                        fontSize: '10px', fontWeight: '700', letterSpacing: '0.04em', cursor: 'pointer',
                        color: activeData.critical ? '#E05555' : C.muted,
                        background: activeData.critical ? 'rgba(224,85,85,0.12)' : 'transparent',
                        border: `1px solid ${activeData.critical ? 'rgba(224,85,85,0.4)' : C.border}`,
                        padding: '1px 6px', borderRadius: '4px',
                      }}>⚑ {activeData.critical ? 'Critical' : 'Flag critical'}</button>
                    )}
                    {activeData.time && <span style={{ fontSize: '10px', color: C.muted, marginLeft: 'auto' }}>{activeData.time}</span>}
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: '500', lineHeight: '1.45' }}>{item.label}</div>
                </div>

                {anyDone && (
                  <div style={{ display: 'flex', gap: '5px', marginBottom: '12px' }}>
                    {shifts.map(sh => {
                      const d = getShiftData(item.id, sh.id);
                      const scfg = d.status ? STATUS[d.status] : null;
                      const isActive = sh.id === activeShiftId;
                      return (
                        <button key={sh.id} onClick={() => setActiveShiftId(sh.id)} style={{
                          display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 8px', borderRadius: '5px',
                          border: `1px solid ${isActive ? (scfg ? scfg.color : C.border) : C.border}`,
                          background: isActive ? (scfg ? scfg.bg : C.surface2) : 'transparent',
                          cursor: 'pointer', fontSize: '11px', color: scfg ? scfg.color : C.muted,
                        }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: scfg ? scfg.color : C.border, flexShrink: 0 }} />
                          {sh.label}
                        </button>
                      );
                    })}
                  </div>
                )}

                {readOnly ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: noteVisible ? '12px' : 0 }}>
                    {cfg ? (
                      <span style={{
                        padding: '5px 12px', borderRadius: '7px',
                        border: `1px solid ${cfg.color}`, background: cfg.bg, color: cfg.color,
                        fontSize: '11px', fontWeight: '700', letterSpacing: '0.04em',
                      }}>{cfg.label}</span>
                    ) : (
                      <span style={{ fontSize: '11px', color: C.muted, letterSpacing: '0.04em' }}>Not recorded</span>
                    )}
                  </div>
                ) : (
                <div style={{ display: 'flex', gap: '6px', marginBottom: noteVisible ? '12px' : 0 }}>
                  {Object.entries(STATUS).map(([key, scfg]) => {
                    const active = activeData.status === key;
                    return (
                      <button key={key} onClick={() => applicable && setStatus(item.id, key)} style={{
                        flex: 1, padding: '8px 4px', borderRadius: '7px',
                        border: `1px solid ${active ? scfg.color : C.border}`,
                        background: active ? scfg.bg : 'transparent',
                        color: active ? scfg.color : C.muted,
                        fontSize: '11px', fontWeight: '700', letterSpacing: '0.04em',
                        cursor: applicable ? 'pointer' : 'default',
                      }}>{scfg.label}</button>
                    );
                  })}
                </div>
                )}

                {readOnly ? (
                  activeData.note ? (
                    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '7px', padding: '10px 12px', fontSize: '13px', color: C.text, lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                      {activeData.note}
                    </div>
                  ) : null
                ) : (applicable && activeData.status && activeData.status !== 'na' && (
                  <>
                    {!noteVisible && (
                      <button onClick={() => setOpenNotes(p => ({ ...p, [item.id]: true }))} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: '12px', padding: '4px 0' }}>+ Add note</button>
                    )}
                    {noteVisible && (
                      <textarea rows={2} autoFocus={!activeData.note} placeholder="Describe what you observed..."
                        value={activeData.note || ''} onChange={e => setNote(item.id, e.target.value)}
                        style={{ width: '100%', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '7px', padding: '10px 12px', color: C.text, fontSize: '13px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', lineHeight: '1.5' }}
                      />
                    )}
                  </>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return null;
}
