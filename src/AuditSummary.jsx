// Framework v1 scoring summary.
//
// Presentational only. It receives an already-computed result from
// src/framework and renders it; it never grades, never writes, and never
// touches Supabase, so it is safe in reviewer read-only mode.
//
// Phase 2 shows this alongside the legacy score. The legacy number is still
// what gets published, and is labelled as such wherever both appear.

const LEVEL_COPY = {
  elite: {
    title: 'SPECULA ELITE',
    line: 'Outstanding performance across every evaluated dimension.',
  },
  exceptional: {
    title: 'SPECULA EXCEPTIONAL',
    line: 'Performance clearly above the standard for this category.',
  },
  certified: {
    title: 'SPECULA CERTIFIED',
    line: "Meets Specula's certification requirements.",
  },
  none: {
    title: 'NOT YET CERTIFIED',
    line: 'This audit does not currently meet the requirements below.',
  },
};

const AUDIT_TYPE_COPY = {
  desk: 'Desk Review',
  spot: 'Spot Audit',
  full: 'Full Audit',
};

const NOT_SCORED = 'Not scored';
const pct = (v) => (v === null || v === undefined ? NOT_SCORED : `${v}%`);

export default function AuditSummary({ result, certification, palette: C, onOpenSection, sectionLabels = {} }) {
  const achieved = certification.eligible;
  const copy = LEVEL_COPY[certification.level] || LEVEL_COPY.none;
  const isDesk = certification.auditType === 'desk';
  // "Reviewed by Specula" is a completion badge, not a scored level. It has no
  // thresholds: it simply records that the assessment took place.
  const showReviewedBadge = isDesk || certification.auditType === 'spot';

  const counts = result.findingCounts || {};
  const zeroTolerance = result.zeroToleranceTriggered;
  const reportable = (result.findings || [])
    .filter((f) => f.severity !== 'minor')
    .sort((a, b) => rank(b.severity) - rank(a.severity));

  // The overall score is the headline number and never reads as de-emphasised.
  // Gold once a level is achieved, amber where Zero Tolerance is in play,
  // otherwise the same weight as coverage beside it.
  const accent = zeroTolerance ? C.warn : achieved ? C.gold : C.text;

  const wrap = { marginBottom: '22px' };
  const label = {
    fontSize: '11px', fontWeight: '600', letterSpacing: '0.1em', textTransform: 'uppercase',
    color: C.muted, marginBottom: '10px', display: 'block',
  };
  const panel = {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: '12px',
    padding: '18px 20px', marginBottom: '10px',
  };

  return (
    <div>
      {/* ── Certification result ─────────────────────────────────────────── */}
      <div style={wrap}>
        <span style={label}>Framework v1 result</span>
        <div style={{
          ...panel,
          borderColor: achieved ? C.goldBorder : C.border,
          background: achieved ? C.goldBg : C.surface,
          padding: '22px 20px',
        }}>
          {showReviewedBadge && (
            <div style={{
              display: 'inline-block', fontSize: '10px', fontWeight: '700', letterSpacing: '0.12em',
              color: C.dim, border: `1px solid ${C.border}`, borderRadius: '4px',
              padding: '3px 8px', marginBottom: '12px',
            }}>
              REVIEWED BY SPECULA
            </div>
          )}
          <div style={{
            fontSize: '17px', fontWeight: '700', letterSpacing: '0.08em',
            color: achieved ? C.gold : C.text, marginBottom: '6px',
          }}>
            {isDesk && !achieved ? 'REVIEWED BY SPECULA' : copy.title}
          </div>
          <div style={{ fontSize: '13px', color: C.dim, lineHeight: '1.55' }}>
            {isDesk && !achieved
              ? 'A Desk Review records that the property was assessed. No certification level is issued for this audit type.'
              : copy.line}
          </div>

          {certification.ceilingLabel && !achieved && !isDesk && (
            <div style={{ fontSize: '12px', color: C.muted, marginTop: '10px' }}>
              Highest level available to this {AUDIT_TYPE_COPY[certification.auditType] || 'audit'}
              {certification.category ? ` at ${certification.category}` : ''}: {certification.ceilingLabel}.
            </div>
          )}
        </div>

        {/* Blockers first: these cannot be outscored. */}
        {certification.blockers.length > 0 && (
          <div style={{ ...panel, borderColor: 'rgba(224,85,85,0.35)' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#E05555', marginBottom: '8px' }}>
              {certification.blockers.length === 1
                ? 'This prevents certification'
                : `${certification.blockers.length} issues prevent certification`}
            </div>
            {certification.blockers.map((b, i) => (
              <div key={i} style={{ fontSize: '13px', color: C.text, lineHeight: '1.6' }}>{b}</div>
            ))}
          </div>
        )}

        {certification.reasons.length > 0 && (
          <div style={panel}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: C.dim, marginBottom: '8px' }}>
              {achieved ? 'Assessment' : 'Missing requirements'}
            </div>
            {certification.reasons.map((r, i) => (
              <div key={i} style={{
                fontSize: '13px', color: i === 0 && achieved ? C.text : C.dim,
                lineHeight: '1.6', marginBottom: '4px',
              }}>
                {r}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Primary numbers ──────────────────────────────────────────────── */}
      <div style={wrap}>
        <span style={label}>Score and coverage</span>
        <div style={{ display: 'flex', gap: '10px' }}>
          <Metric C={C} value={pct(result.overall)} caption="Overall score" hint="of what was assessed" accent={accent} big />
          <Metric C={C} value={pct(result.coverage)} caption="Coverage" hint="of the applicable audit" accent={C.text} big />
        </div>
        {result.naShare > 0 && (
          <div style={{ fontSize: '11px', color: C.muted, marginTop: '8px' }}>
            {result.naShare}% of the audit was marked not applicable and is excluded from both figures.
          </div>
        )}
      </div>

      {/* ── Quality layers ───────────────────────────────────────────────── */}
      <div style={wrap}>
        <span style={label}>Quality layers</span>
        <div style={panel}>
          <Bar C={C} name="Foundation" score={result.byClass.foundation.score} emphasis />
          <Bar C={C} name="Standard" score={result.byClass.standard.score} />
          <Bar C={C} name="Distinction" score={result.byClass.distinction.score} last />
        </div>
      </div>

      {/* ── Dimensions ───────────────────────────────────────────────────── */}
      <div style={wrap}>
        <span style={label}>Dimensions</span>
        <div style={panel}>
          <Bar C={C} name="Condition" score={result.byDimension.condition.score} />
          <Bar C={C} name="Service" score={result.byDimension.service.score} />
          <Bar C={C} name="Product" score={result.byDimension.product.score} />
          <Bar C={C} name="Experience" score={result.byDimension.experience.score} last />
        </div>
      </div>

      {/* ── Findings ─────────────────────────────────────────────────────── */}
      <div style={wrap}>
        <span style={label}>Findings</span>

        {zeroTolerance && (
          <div style={{
            ...panel, borderColor: 'rgba(245,166,35,0.45)', background: C.warnBg, marginBottom: '10px',
          }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: C.warn, marginBottom: '4px' }}>
              ZERO TOLERANCE RECORDED
            </div>
            <div style={{ fontSize: '13px', color: C.text, lineHeight: '1.55' }}>
              This audit cannot be certified and should be escalated before the report is issued.
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', marginBottom: reportable.length ? '10px' : 0 }}>
          <Metric C={C} value={counts.critical || 0} caption="Critical" accent={counts.critical ? '#E05555' : C.muted} />
          <Metric C={C} value={counts.major || 0} caption="Major" accent={counts.major ? C.warn : C.muted} />
          <Metric C={C} value={counts.minor || 0} caption="Minor" accent={C.dim} />
        </div>

        {reportable.length === 0 ? (
          <div style={{ fontSize: '13px', color: C.dim, padding: '4px 0' }}>
            {counts.minor
              ? `No Critical or Major findings. ${counts.minor} minor observation${counts.minor === 1 ? '' : 's'} recorded.`
              : 'No findings recorded.'}
          </div>
        ) : (
          reportable.map((f) => (
            <div
              key={f.itemId}
              onClick={onOpenSection ? () => onOpenSection(f.sectionId) : undefined}
              style={{
                ...panel,
                marginBottom: '8px',
                cursor: onOpenSection ? 'pointer' : 'default',
                borderColor: f.severity === 'critical' || f.severity === 'zero_tolerance'
                  ? 'rgba(224,85,85,0.35)' : C.border,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' }}>
                <span style={{ fontSize: '13px', fontWeight: '600', lineHeight: '1.45' }}>{f.label}</span>
                <span style={{
                  fontSize: '10px', fontWeight: '700', letterSpacing: '0.08em', flexShrink: 0,
                  color: severityColour(f.severity, C),
                }}>
                  {severityLabel(f.severity)}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: C.muted, marginTop: '5px' }}>
                {sectionLabels[f.sectionId] || f.sectionLabel}
                {onOpenSection ? ' ›' : ''}
              </div>
              {f.note && <div style={{ fontSize: '12px', color: C.dim, marginTop: '6px' }}>{f.note}</div>}
            </div>
          ))
        )}

        {counts.major > 0 && (
          <div style={{ fontSize: '11px', color: C.muted, marginTop: '8px', lineHeight: '1.5' }}>
            Major findings are reported but do not block certification on their own.
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ C, value, caption, hint, accent, big }) {
  // A word instead of a number needs to sit at reading size, not display size.
  const isWord = typeof value === 'string' && !/\d/.test(value);
  return (
    <div style={{
      flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: '12px',
      padding: big ? '18px 16px' : '14px 12px', textAlign: big ? 'left' : 'center',
    }}>
      <div style={{
        fontSize: isWord ? '15px' : big ? '26px' : '20px',
        fontWeight: isWord ? '600' : '700',
        letterSpacing: '-0.01em',
        color: isWord ? C.dim : accent,
        fontFamily: isWord ? 'inherit' : "'IBM Plex Mono', monospace",
        paddingTop: isWord && big ? '9px' : 0,
        paddingBottom: isWord && big ? '9px' : 0,
      }}>
        {value}
      </div>
      <div style={{ fontSize: '11px', color: C.dim, marginTop: '4px', letterSpacing: '0.03em' }}>{caption}</div>
      {hint && <div style={{ fontSize: '10px', color: C.muted, marginTop: '2px' }}>{hint}</div>}
    </div>
  );
}

function Bar({ C, name, score, emphasis, last }) {
  const value = score === null || score === undefined ? null : score;
  return (
    <div style={{ marginBottom: last ? 0 : '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
        <span style={{ fontSize: '13px', fontWeight: emphasis ? '600' : '400', color: emphasis ? C.text : C.dim }}>
          {name}
        </span>
        <span style={{
          fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace",
          color: value === null ? C.muted : emphasis ? C.gold : C.text,
        }}>
          {value === null ? 'not assessed' : `${value}%`}
        </span>
      </div>
      <div style={{ height: '3px', background: C.surface2, borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${value === null ? 0 : value}%`,
          background: emphasis ? C.gold : C.dim, borderRadius: '2px', transition: 'width 0.3s',
        }} />
      </div>
    </div>
  );
}

const rank = (s) => ({ zero_tolerance: 4, critical: 3, major: 2, minor: 1 }[s] || 0);
const severityLabel = (s) => ({
  zero_tolerance: 'ZERO TOLERANCE', critical: 'CRITICAL', major: 'MAJOR', minor: 'MINOR',
}[s] || s.toUpperCase());
const severityColour = (s, C) =>
  s === 'zero_tolerance' || s === 'critical' ? '#E05555' : s === 'major' ? C.warn : C.muted;
