// Phase 6.5. Presentational only, same contract as AuditSummary: it receives
// an already-computed result and renders it, never grades or writes anything.
//
// Deliberately compact and deliberately not a second findings list —
// AuditSummary already shows every finding grouped by severity. What this
// adds is the three things nothing else on this screen says: what to
// address first (ranked, not just grouped), what repeats or connects across
// findings, and — new to this console — what the property genuinely got
// right.

export default function AuditIntelligencePanel({ intelligence, palette: C, onOpenFinding }) {
  const { priorities, patterns, strengths } = intelligence;
  if (priorities.length === 0 && patterns.length === 0 && strengths.length === 0) return null;

  const topPriority = priorities[0] || null;
  const topPattern = patterns[0] || null;
  const topStrength = strengths[0] || null;

  const section = { marginBottom: '26px' };
  const label = {
    fontSize: '11px', fontWeight: '600', letterSpacing: '0.1em', textTransform: 'uppercase',
    color: C.muted, marginBottom: '10px', display: 'block',
  };
  const panel = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '16px 18px' };

  const open = (sectionId, itemId) => {
    if (onOpenFinding && sectionId && itemId) onOpenFinding(sectionId, itemId);
  };

  return (
    <div style={section}>
      <span style={label}>Audit Intelligence</span>
      <div style={panel}>
        <div style={{ display: 'flex', gap: '18px', marginBottom: (topPriority || topPattern || topStrength) ? '16px' : 0 }}>
          <Stat C={C} value={priorities.length} singular="priority" plural="priorities" />
          <Stat C={C} value={patterns.length} singular="pattern" plural="patterns" />
          <Stat C={C} value={strengths.length} singular="strength" plural="strengths" />
        </div>

        {topPriority && (
          <Row
            C={C}
            eyebrow="Top priority"
            title={topPriority.title}
            detail={topPriority.reason}
            tone={PRIORITY_TONE[topPriority.severity] || C.dim}
            onClick={() => open(topPriority.sectionIds[0], topPriority.findingIds[0])}
          />
        )}
        {topPattern && (
          <Row
            C={C}
            eyebrow="Repeated pattern"
            title={topPattern.title}
            detail={topPattern.reason}
            tone={C.warn}
            onClick={() => open(topPattern.sectionIds[0], topPattern.findingIds[0])}
          />
        )}
        {topStrength && (
          <Row
            C={C}
            eyebrow="Strength"
            title={topStrength.title}
            detail={topStrength.reason}
            tone="#4DC87A"
            onClick={() => open(topStrength.sectionId, topStrength.itemIds[0])}
            last
          />
        )}
      </div>
    </div>
  );
}

const PRIORITY_TONE = { zero_tolerance: '#E05555', critical: '#E05555', major: '#F5A623', minor: '#8B8B95' };

function Stat({ C, value, singular, plural }) {
  return (
    <div>
      <div style={{ fontSize: '20px', fontWeight: '700', fontFamily: "'IBM Plex Mono', monospace", color: C.text }}>{value}</div>
      <div style={{ fontSize: '10.5px', color: C.muted, marginTop: '2px' }}>{value === 1 ? singular : plural}</div>
    </div>
  );
}

function Row({ C, eyebrow, title, detail, tone, onClick, last }) {
  const clickable = Boolean(onClick);
  return (
    <div
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      style={{
        paddingTop: '13px', marginTop: '13px', borderTop: `1px solid ${C.border}`,
        marginBottom: last ? 0 : undefined, cursor: clickable ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' }}>
        <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: tone, flexShrink: 0 }} />
        <span style={{ fontSize: '10.5px', fontWeight: '600', letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted }}>{eyebrow}</span>
      </div>
      <div style={{ fontSize: '13px', fontWeight: '600', color: C.text, lineHeight: '1.45' }}>{title}</div>
      {detail && <div style={{ fontSize: '11.5px', color: C.dim, marginTop: '4px', lineHeight: '1.5' }}>{detail}</div>}
    </div>
  );
}
