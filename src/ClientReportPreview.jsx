// Phase 6.7. Presentational only — receives an already-built clientReport
// (src/framework/clientReport.js) and renders it. No grading, no scoring,
// no network calls of its own; evidence resolution (a signed URL) is
// handed back to the caller via onViewEvidence, the same lightbox
// mechanism the capture screens already use.
//
// Deliberately editorial rather than dashboard-styled: one column, generous
// whitespace, thin dividers instead of a card per fact. A hotel executive
// reads top to bottom and stops whenever they have what they need — nothing
// here demands attention it has not earned.

const SEVERITY_TONE = { zero_tolerance: '#E05555', critical: '#E05555', major: '#F5A623', minor: '#8B8B95' };
const NOT_SCORED = 'Not scored';
const pct = (v) => (v === null || v === undefined ? NOT_SCORED : `${v}%`);

export default function ClientReportPreview({ report, palette: C, onOpenFinding, onViewEvidence, onBack }) {
  const {
    clientReady, metadata, executiveOverview, performance, priorities, urgentIssues,
    improvementAreas, patterns, strengths, findings, evidence, certification, methodology,
  } = report;

  const page = { maxWidth: '640px', margin: '0 auto', padding: '0 20px 60px' };
  const rule = { height: '1px', background: C.border, margin: '34px 0' };
  const eyebrow = {
    fontSize: '11px', fontWeight: '600', letterSpacing: '0.12em', textTransform: 'uppercase',
    color: C.muted, marginBottom: '14px', display: 'block',
  };

  const open = (sectionId, itemId) => { if (onOpenFinding && sectionId && itemId) onOpenFinding(sectionId, itemId); };

  return (
    <div style={page}>
      {!clientReady && (
        <div style={{
          margin: '18px 0 28px', padding: '10px 14px', borderRadius: '8px',
          background: C.warnBg, border: '1px solid rgba(245,166,35,0.3)',
          fontSize: '12px', color: C.warn, fontWeight: '600',
        }}>
          DRAFT — internal preview only. This audit has not been published; a client would never see this.
        </div>
      )}

      {/* ── Masthead ─────────────────────────────────────────────────── */}
      <div style={{ padding: '36px 0 8px' }}>
        <div style={{ fontSize: '11px', letterSpacing: '0.14em', color: C.gold, fontWeight: '600', marginBottom: '10px' }}>
          SPECULA {metadata.auditTypeLabel ? metadata.auditTypeLabel.toUpperCase() : 'REPORT'}
        </div>
        <h1 style={{ fontSize: '26px', fontWeight: '700', margin: 0, letterSpacing: '-0.01em' }}>{metadata.propertyName}</h1>
        <div style={{ fontSize: '13px', color: C.dim, marginTop: '6px' }}>
          {[metadata.city, metadata.country].filter(Boolean).join(', ')}
          {metadata.category ? ` · ${metadata.category}` : ''}
        </div>
        <div style={{ fontSize: '11.5px', color: C.muted, marginTop: '10px' }}>
          {metadata.auditedOn ? `Assessed ${metadata.auditedOn}` : null}
          {metadata.reportId ? `${metadata.auditedOn ? ' · ' : ''}Report ${metadata.reportId}` : ''}
        </div>
      </div>

      <div style={rule} />

      {/* ── Executive overview ───────────────────────────────────────── */}
      <div>
        <span style={eyebrow}>Executive Overview</span>
        <div style={{ fontSize: '19px', fontWeight: '700', lineHeight: '1.4', marginBottom: '20px' }}>
          {executiveOverview.headline}
        </div>
        <div style={{ display: 'flex', gap: '28px', flexWrap: 'wrap', marginBottom: '22px' }}>
          <BigStat C={C} value={pct(executiveOverview.overallScore)} caption="Overall score" />
          <BigStat C={C} value={pct(executiveOverview.coverage)} caption="Coverage" />
          {metadata.certificationLabel && <BigStat C={C} value={metadata.certificationLabel} caption="Certification" accent={C.gold} word />}
          <BigStat
            C={C} value={executiveOverview.urgentCount} caption="Urgent issues"
            accent={executiveOverview.urgentCount > 0 ? '#E05555' : undefined}
          />
        </div>
        {executiveOverview.summary && (
          <div>
            <SummaryLine C={C} label="Primary concern" value={executiveOverview.summary.primaryConcern} tone={C.warn} />
            <SummaryLine C={C} label="Operational pattern" value={executiveOverview.summary.operationalPattern} />
            <SummaryLine C={C} label="Positive signal" value={executiveOverview.summary.positiveSignal} tone="#4DC87A" />
          </div>
        )}
      </div>

      {/* ── Urgent attention ─────────────────────────────────────────── */}
      {urgentIssues.length > 0 && (
        <>
          <div style={rule} />
          <div>
            <span style={{ ...eyebrow, color: '#E05555' }}>Urgent Attention</span>
            {urgentIssues.map((p) => (
              <PriorityEntry key={p.title} C={C} p={p} onClick={() => open(p.sectionIds[0], p.findingIds[0])} />
            ))}
          </div>
        </>
      )}

      {/* ── Top priorities ───────────────────────────────────────────── */}
      {priorities.length > 0 && (
        <>
          <div style={rule} />
          <div>
            <span style={eyebrow}>Priorities</span>
            {priorities.map((p, i) => (
              <PriorityEntry key={p.title} C={C} p={p} index={i + 1} onClick={() => open(p.sectionIds[0], p.findingIds[0])} />
            ))}
          </div>
        </>
      )}

      {/* ── Improvement areas ────────────────────────────────────────── */}
      {improvementAreas.length > 0 && (
        <>
          <div style={rule} />
          <div>
            <span style={eyebrow}>Improvement Areas</span>
            <div style={{ fontSize: '13.5px', color: C.dim, lineHeight: '1.7' }}>
              {improvementAreas.map((p) => p.title).join(' · ')}
            </div>
          </div>
        </>
      )}

      {/* ── Patterns ──────────────────────────────────────────────────── */}
      {patterns.length > 0 && (
        <>
          <div style={rule} />
          <div>
            <span style={eyebrow}>Patterns Identified</span>
            {patterns.map((p) => (
              <TextEntry key={p.id} C={C} tone={SEVERITY_TONE[p.severity]} text={p.explanation} onClick={() => open(p.sectionIds[0], p.findingIds[0])} />
            ))}
          </div>
        </>
      )}

      {/* ── Strengths ─────────────────────────────────────────────────── */}
      {strengths.length > 0 && (
        <>
          <div style={rule} />
          <div>
            <span style={eyebrow}>Key Strengths</span>
            {strengths.map((s, i) => (
              <div key={s.sectionId} style={{ marginBottom: i === strengths.length - 1 ? 0 : '16px' }}>
                <div style={{ fontSize: '14px', fontWeight: '600', color: C.text }}>{s.title}</div>
                <div style={{ fontSize: '12.5px', color: C.dim, marginTop: '3px', lineHeight: '1.55' }}>{s.reason}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Section performance ──────────────────────────────────────── */}
      {performance.sections.length > 0 && (
        <>
          <div style={rule} />
          <div>
            <span style={eyebrow}>Section Performance</span>
            {performance.sections.map((s) => (
              <div key={s.sectionId} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '7px 0' }}>
                <span style={{ fontSize: '13px', color: C.text, flex: 1 }}>{s.sectionLabel}</span>
                <div style={{ width: '90px', height: '3px', background: C.surface2, borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${s.score}%`, height: '100%', background: s.score >= 85 ? '#4DC87A' : s.score >= 60 ? C.gold : '#E05555' }} />
                </div>
                <span style={{ fontSize: '12.5px', fontFamily: "'IBM Plex Mono', monospace", color: C.dim, width: '42px', textAlign: 'right' }}>{s.score}%</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Detailed findings & evidence ─────────────────────────────── */}
      {findings.length > 0 && (
        <>
          <div style={rule} />
          <div>
            <span style={eyebrow}>Detailed Findings</span>
            {findings.map((f) => (
              <div
                key={f.itemId} onClick={() => open(f.sectionId, f.itemId)} role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(f.sectionId, f.itemId); } }}
                style={{ padding: '13px 0', borderTop: `1px solid ${C.border}`, cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '9px', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '13.5px', fontWeight: '600', color: C.text }}>{f.label}</span>
                  <span style={{ fontSize: '10.5px', fontWeight: '700', letterSpacing: '0.05em', color: SEVERITY_TONE[f.severity], flexShrink: 0 }}>
                    {f.severity.replace('_', ' ').toUpperCase()}
                  </span>
                </div>
                <div style={{ fontSize: '11.5px', color: C.muted, marginTop: '4px' }}>{f.sectionLabel}</div>
                {f.note && <div style={{ fontSize: '12px', color: C.dim, marginTop: '5px', lineHeight: '1.5' }}>{f.note}</div>}
                {f.evidenceCount > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <EvidenceRow C={C} itemId={f.itemId} photos={evidence.byItemId[f.itemId] || []} onView={onViewEvidence} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Certification ─────────────────────────────────────────────── */}
      {certification && (
        <>
          <div style={rule} />
          <div>
            <span style={eyebrow}>Certification</span>
            {certification.eligible && (
              <div style={{ fontSize: '15px', fontWeight: '700', color: C.gold, marginBottom: '8px' }}>
                CERTIFIED BY SPECULA — {certification.label}
              </div>
            )}
            <div style={{ fontSize: '13px', color: C.dim, lineHeight: '1.6' }}>{certification.statement}</div>
          </div>
        </>
      )}

      {/* ── Methodology ───────────────────────────────────────────────── */}
      {methodology.length > 0 && (
        <>
          <div style={rule} />
          <div>
            <span style={eyebrow}>Methodology</span>
            {methodology.map((m, i) => (
              <div key={m.title} style={{ marginBottom: i === methodology.length - 1 ? 0 : '14px' }}>
                <div style={{ fontSize: '12.5px', fontWeight: '600', color: C.text, marginBottom: '3px' }}>{m.title}</div>
                <div style={{ fontSize: '12px', color: C.muted, lineHeight: '1.6' }}>{m.text}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────

function BigStat({ C, value, caption, accent, word }) {
  return (
    <div>
      <div style={{
        fontSize: word ? '16px' : '24px', fontWeight: '700', color: accent || C.text,
        fontFamily: word ? 'inherit' : "'IBM Plex Mono', monospace",
      }}>
        {value}
      </div>
      <div style={{ fontSize: '11px', color: C.muted, marginTop: '3px' }}>{caption}</div>
    </div>
  );
}

function SummaryLine({ C, label, value, tone }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', gap: '14px', marginBottom: '9px', fontSize: '13px' }}>
      <span style={{ color: C.muted, flexShrink: 0, minWidth: '140px' }}>{label}</span>
      <span style={{ color: tone || C.text, lineHeight: '1.5' }}>{value}</span>
    </div>
  );
}

function PriorityEntry({ C, p, index, onClick }) {
  return (
    <div
      onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{ padding: '14px 0', borderTop: `1px solid ${C.border}`, cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
        {index && (
          <span style={{ fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace", color: C.muted, flexShrink: 0 }}>
            {String(index).padStart(2, '0')}
          </span>
        )}
        <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.06em', color: SEVERITY_TONE[p.severity] }}>
          {p.severity.replace('_', ' ').toUpperCase()}
        </span>
      </div>
      <div style={{ fontSize: '14.5px', fontWeight: '600', color: C.text, marginTop: '5px', lineHeight: '1.4' }}>{p.title}</div>
      <div style={{ fontSize: '12.5px', color: C.dim, marginTop: '5px', lineHeight: '1.55' }}>{p.reason}</div>
      <div style={{ fontSize: '11px', color: C.muted, marginTop: '7px' }}>
        {p.findingCount} supporting finding{p.findingCount === 1 ? '' : 's'}
        {p.evidenceCount > 0 ? ` · ${p.evidenceCount} piece${p.evidenceCount === 1 ? '' : 's'} of evidence` : ''}
      </div>
    </div>
  );
}

function TextEntry({ C, tone, text, onClick }) {
  return (
    <div
      onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{ display: 'flex', gap: '10px', padding: '10px 0', borderTop: `1px solid ${C.border}`, cursor: 'pointer' }}
    >
      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: tone, flexShrink: 0, marginTop: '7px' }} />
      <span style={{ fontSize: '13px', color: C.text, lineHeight: '1.55' }}>{text}</span>
    </div>
  );
}

/** Finding -> evidence count -> "View evidence" -> photo + caption. Never every photo at once. */
function EvidenceRow({ C, itemId, photos, onView }) {
  return (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      {photos.map((p) => (
        <button
          key={p.photoId}
          onClick={(e) => { e.stopPropagation(); onView && onView(p, itemId); }}
          style={{
            fontSize: '11px', color: C.gold, background: 'none', border: `1px solid ${C.border}`,
            borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          View evidence{p.caption ? ` — ${p.caption}` : ''}
        </button>
      ))}
    </div>
  );
}
