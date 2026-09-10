// Phase 6.6. Presentational only, same contract as AuditSummary and
// AuditIntelligencePanel: receives an already-computed report and renders
// it, never grades or writes anything.
//
// This is the first thing on REVIEW & PUBLISH that answers "how did we
// do," ahead of AuditSummary's full certification/score/findings detail
// and AuditIntelligencePanel's single-item preview below it. It exists to
// be read in seconds, not studied — a headline, four summary lines, a
// metric row, and capped top-N lists. Every list item that traces to a
// real finding stays clickable into the section it came from.

const SEVERITY_TONE = { zero_tolerance: '#E05555', critical: '#E05555', major: '#F5A623', minor: '#8B8B95' };

export default function ExecutiveReport({ report, palette: C, onOpenFinding }) {
  const {
    headline, executiveSummary, performance, priorities, urgentIssues, improvementAreas,
    patterns, strengths, keyMetrics, sectionsToWatch,
  } = report;

  const section = { marginBottom: '22px' };
  const label = {
    fontSize: '11px', fontWeight: '600', letterSpacing: '0.1em', textTransform: 'uppercase',
    color: C.muted, marginBottom: '10px', display: 'block',
  };
  const panel = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '18px 20px' };

  const openPriority = (p) => {
    if (onOpenFinding && p.sectionIds[0] && p.findingIds[0]) onOpenFinding(p.sectionIds[0], p.findingIds[0]);
  };
  const openPattern = (p) => {
    if (onOpenFinding && p.sectionIds[0] && p.findingIds[0]) onOpenFinding(p.sectionIds[0], p.findingIds[0]);
  };
  const openStrength = (s) => {
    if (onOpenFinding && s.sectionId && s.itemIds[0]) onOpenFinding(s.sectionId, s.itemIds[0]);
  };
  const openSection = (s) => {
    if (onOpenFinding && s.sectionId && s.itemId) onOpenFinding(s.sectionId, s.itemId);
  };

  return (
    <div style={{ marginBottom: '10px' }}>
      <span style={label}>Executive Report</span>

      {/* ── Headline + structured summary ──────────────────────────────── */}
      <div style={{ ...panel, marginBottom: '14px' }}>
        <div style={{ fontSize: '16px', fontWeight: '700', color: C.text, lineHeight: '1.4', marginBottom: '14px' }}>
          {headline}
        </div>
        <SummaryLine C={C} label="Overall performance" value={executiveSummary.overallPerformance} />
        {executiveSummary.primaryConcern && (
          <SummaryLine C={C} label="Primary concern" value={executiveSummary.primaryConcern} tone={C.warn} />
        )}
        {executiveSummary.operationalPattern && (
          <SummaryLine C={C} label="Operational pattern" value={executiveSummary.operationalPattern} />
        )}
        {executiveSummary.positiveSignal && (
          <SummaryLine C={C} label="Positive signal" value={executiveSummary.positiveSignal} tone="#4DC87A" last />
        )}
      </div>

      {/* ── Key metrics ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <Metric C={C} value={pct(keyMetrics.overallScore)} caption="Overall score" />
        <Metric C={C} value={pct(keyMetrics.coverage)} caption="Coverage" />
        <Metric
          C={C} value={keyMetrics.urgentIssueCount} caption="Urgent issues"
          accent={keyMetrics.urgentIssueCount > 0 ? '#E05555' : undefined}
        />
        {keyMetrics.certificationLabel && (
          <Metric C={C} value={keyMetrics.certificationLabel} caption="Certification" accent={C.gold} word />
        )}
      </div>

      {/* ── Urgent attention: a flag, not a repeat of the detail below ──── */}
      {urgentIssues.length > 0 && (
        <div style={{ ...panel, marginBottom: '14px', borderColor: 'rgba(224,85,85,0.4)', background: 'rgba(224,85,85,0.07)' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', letterSpacing: '0.08em', color: '#E05555', marginBottom: '8px' }}>
            URGENT ATTENTION · {urgentIssues.length}
          </div>
          {urgentIssues.map((p) => (
            <div key={`${p.type}-${p.findingIds[0]}`} style={{ fontSize: '12.5px', color: C.text, padding: '3px 0' }}>
              {p.title}
            </div>
          ))}
        </div>
      )}

      {/* ── Top priorities: the one place the full reason lives ────────── */}
      {priorities.length > 0 && (
        <div style={section}>
          <span style={label}>Top Priorities</span>
          <div style={panel}>
            {priorities.slice(0, 3).map((p, i) => (
              <PriorityRow key={`${p.type}-${p.findingIds[0]}`} C={C} p={p} onClick={() => openPriority(p)} last={i === Math.min(2, priorities.length - 1)} />
            ))}
            {priorities.length > 3 && (
              <div style={{ fontSize: '11px', color: C.muted, marginTop: '10px' }}>
                +{priorities.length - 3} more below.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Improvement areas: a count, detail already stated above ─────── */}
      {improvementAreas.length > 0 && (
        <div style={{ ...panel, marginBottom: '14px' }}>
          <div style={{ fontSize: '11px', fontWeight: '600', letterSpacing: '0.08em', color: C.muted, marginBottom: '6px' }}>
            IMPROVEMENT AREAS · {improvementAreas.length}
          </div>
          <div style={{ fontSize: '12.5px', color: C.dim, lineHeight: '1.5' }}>
            {improvementAreas.slice(0, 2).map((p) => p.title).join(' · ')}
            {improvementAreas.length > 2 ? ` and ${improvementAreas.length - 2} more.` : '.'}
          </div>
        </div>
      )}

      {/* ── Patterns detected ────────────────────────────────────────────── */}
      {patterns.length > 0 && (
        <div style={section}>
          <span style={label}>Patterns Detected</span>
          <div style={panel}>
            {patterns.slice(0, 3).map((p, i) => (
              <ExplainedRow
                key={p.id} C={C} title={p.explanation} tone={SEVERITY_TONE[p.severity]}
                onClick={() => openPattern(p)} last={i === Math.min(2, patterns.length - 1)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Top strengths ─────────────────────────────────────────────── */}
      {strengths.length > 0 && (
        <div style={section}>
          <span style={label}>Top Strengths</span>
          <div style={panel}>
            {strengths.map((s, i) => (
              <ExplainedRow
                key={s.sectionId} C={C} title={s.title} detail={s.reason} tone="#4DC87A"
                onClick={() => openStrength(s)} last={i === strengths.length - 1}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Sections to watch ─────────────────────────────────────────── */}
      {sectionsToWatch.length > 0 && (
        <div style={section}>
          <span style={label}>Sections to Watch</span>
          <div style={panel}>
            {sectionsToWatch.map((s, i) => (
              <div
                key={s.sectionId}
                onClick={() => openSection(s)}
                role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSection(s); } }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
                  padding: '10px 0', borderTop: i === 0 ? 'none' : `1px solid ${C.border}`, cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: SEVERITY_TONE[s.worstSeverity], flexShrink: 0 }} />
                  <span style={{ fontSize: '13px', fontWeight: '600', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.sectionLabel}
                  </span>
                  {s.hasPattern && <span style={{ fontSize: '10px', color: C.muted, flexShrink: 0 }}>pattern</span>}
                </div>
                <span style={{ fontSize: '11px', color: C.muted, flexShrink: 0 }}>
                  {s.findingCount} finding{s.findingCount === 1 ? '' : 's'} ›
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────

const NOT_SCORED = 'Not scored';
const pct = (v) => (v === null || v === undefined ? NOT_SCORED : `${v}%`);

function SummaryLine({ C, label, value, tone, last }) {
  return (
    <div style={{ display: 'flex', gap: '10px', marginBottom: last ? 0 : '8px', fontSize: '13px' }}>
      <span style={{ color: C.muted, flexShrink: 0, minWidth: '130px' }}>{label}</span>
      <span style={{ color: tone || C.text, fontWeight: tone ? '600' : '400', lineHeight: '1.4' }}>{value}</span>
    </div>
  );
}

function Metric({ C, value, caption, accent, word }) {
  return (
    <div style={{ flex: '1 1 100px', minWidth: '100px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '12px 14px' }}>
      <div style={{
        fontSize: word ? '14px' : '20px', fontWeight: '700', color: accent || C.text,
        fontFamily: word ? 'inherit' : "'IBM Plex Mono', monospace",
      }}>
        {value}
      </div>
      <div style={{ fontSize: '10.5px', color: C.muted, marginTop: '3px' }}>{caption}</div>
    </div>
  );
}

function PriorityRow({ C, p, onClick, last }) {
  return (
    <div
      onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{ paddingBottom: last ? 0 : '13px', marginBottom: last ? 0 : '13px', borderBottom: last ? 'none' : `1px solid ${C.border}`, cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '3px' }}>
        <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: SEVERITY_TONE[p.severity], flexShrink: 0 }} />
        <span style={{ fontSize: '13px', fontWeight: '600', color: C.text, lineHeight: '1.4' }}>{p.title}</span>
      </div>
      <div style={{ fontSize: '11.5px', color: C.dim, marginLeft: '13px', lineHeight: '1.5' }}>{p.reason}</div>
    </div>
  );
}

function ExplainedRow({ C, title, detail, tone, onClick, last }) {
  return (
    <div
      onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{ paddingBottom: last ? 0 : '13px', marginBottom: last ? 0 : '13px', borderBottom: last ? 'none' : `1px solid ${C.border}`, cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: tone, flexShrink: 0, marginTop: '6px' }} />
        <span style={{ fontSize: '12.5px', color: C.text, lineHeight: '1.5' }}>{title}</span>
      </div>
      {detail && <div style={{ fontSize: '11.5px', color: C.dim, marginLeft: '13px', marginTop: '3px', lineHeight: '1.5' }}>{detail}</div>}
    </div>
  );
}
