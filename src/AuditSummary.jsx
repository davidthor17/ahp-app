// Framework v1 scoring summary.
//
// Presentational only. It receives an already-computed result from
// src/framework and renders it; it never grades, never writes, and never
// touches Supabase, so it is safe in reviewer read-only mode.
//
// Phase 2 showed this alongside the legacy score. Phase 3A reworks the
// findings and certification presentation: Critical and Major are read on
// sight, Minor collapses to a count that opens on request, and every finding
// links to the item that raised it.

import { useState } from 'react';

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
    line: 'This audit does not meet the requirements set out below.',
  },
};

const AUDIT_TYPE_COPY = { desk: 'Desk Review', spot: 'Spot Audit', full: 'Full Audit' };

const NOT_SCORED = 'Not scored';
const pct = (v) => (v === null || v === undefined ? NOT_SCORED : `${v}%`);

export default function AuditSummary({ result, certification, palette: C, onOpenFinding }) {
  const [showMinor, setShowMinor] = useState(false);

  const achieved = certification.eligible;
  const copy = LEVEL_COPY[certification.level] || LEVEL_COPY.none;
  const isDesk = certification.auditType === 'desk';
  // "Reviewed by Specula" is a completion badge, not a scored level. It has no
  // thresholds: it records that the assessment took place.
  const showReviewedBadge = isDesk || certification.auditType === 'spot';

  const counts = result.findingCounts || {};
  const zeroTolerance = result.zeroToleranceTriggered;
  const all = result.findings || [];
  const critical = all.filter((f) => f.severity === 'zero_tolerance' || f.severity === 'critical');
  const major = all.filter((f) => f.severity === 'major');
  const minor = all.filter((f) => f.severity === 'minor');

  const scoreAccent = zeroTolerance ? C.warn : achieved ? C.gold : C.text;

  const section = { marginBottom: '26px' };
  const label = {
    fontSize: '11px', fontWeight: '600', letterSpacing: '0.1em', textTransform: 'uppercase',
    color: C.muted, marginBottom: '10px', display: 'block',
  };
  const panel = {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: '12px',
    padding: '18px 20px',
  };
  const rule = { height: '1px', background: C.border, margin: '16px -20px' };

  // Requirements the audit misses, and blockers it cannot outscore, read as one
  // list because to an auditor they are one question: what is standing in the way.
  const obstacles = [
    ...certification.blockers.map((text) => ({ text, hard: true })),
    ...(achieved ? [] : certification.reasons.map((text) => ({ text, hard: false }))),
  ];

  return (
    <div>
      {/* ── Certification ────────────────────────────────────────────────── */}
      <div style={section}>
        <span style={label}>Framework v1 result</span>

        <div style={{
          ...panel,
          padding: '24px 20px',
          borderColor: achieved ? C.goldBorder : C.border,
          background: achieved ? C.goldBg : C.surface,
        }}>
          {showReviewedBadge && !isDesk && (
            <div style={badge(C)}>REVIEWED BY SPECULA</div>
          )}

          <div style={{
            fontSize: '18px', fontWeight: '700', letterSpacing: '0.09em',
            color: achieved ? C.gold : C.text, marginBottom: '7px',
          }}>
            {isDesk && !achieved ? 'REVIEWED BY SPECULA' : copy.title}
          </div>

          <div style={{ fontSize: '13px', color: C.dim, lineHeight: '1.6' }}>
            {isDesk && !achieved
              ? 'A Desk Review records that the property was assessed. No certification level is issued for this audit type.'
              : copy.line}
          </div>

          {obstacles.length > 0 && (
            <>
              <div style={rule} />
              <div style={{ fontSize: '11px', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, marginBottom: '10px' }}>
                {obstacles.some((o) => o.hard) ? 'Standing in the way' : 'Still required'}
              </div>
              {obstacles.map((o, i) => (
                <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: i === obstacles.length - 1 ? 0 : '9px' }}>
                  <span style={{
                    flexShrink: 0, marginTop: '6px', width: '5px', height: '5px', borderRadius: '50%',
                    background: o.hard ? '#E05555' : C.muted,
                  }} />
                  <span style={{ fontSize: '13px', lineHeight: '1.55', color: o.hard ? C.text : C.dim }}>
                    {o.text}
                  </span>
                </div>
              ))}
            </>
          )}

          {achieved && certification.reasons.length > 1 && (
            <>
              <div style={rule} />
              <div style={{ fontSize: '12px', color: C.dim, lineHeight: '1.6' }}>
                {certification.reasons.slice(1).join(' ')}
              </div>
            </>
          )}

          {!achieved && !isDesk && certification.ceilingLabel && (
            <>
              <div style={rule} />
              <div style={{ fontSize: '12px', color: C.muted, lineHeight: '1.5' }}>
                Highest level available to a {AUDIT_TYPE_COPY[certification.auditType] || 'audit'}
                {certification.category ? ` at ${certification.category}` : ''}: {certification.ceilingLabel}.
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Score and coverage ───────────────────────────────────────────── */}
      <div style={section}>
        <span style={label}>Score and coverage</span>
        <div style={{ display: 'flex', gap: '10px' }}>
          <Metric
            C={C}
            value={pct(result.overall)}
            caption="Overall score"
            hint="of what was assessed"
            accent={scoreAccent}
          />
          <Metric
            C={C}
            value={pct(result.coverage)}
            caption="Coverage"
            hint="of the applicable audit"
            accent={C.text}
          />
        </div>
        {result.naShare > 0 && (
          <div style={{ fontSize: '11px', color: C.muted, marginTop: '9px', lineHeight: '1.5' }}>
            {result.naShare}% of the audit was marked not applicable and is excluded from both figures.
          </div>
        )}
      </div>

      {/* ── Quality layers ───────────────────────────────────────────────── */}
      <div style={section}>
        <span style={label}>Quality layers</span>
        <div style={panel}>
          <Bar C={C} name="Foundation" note="The non-negotiable fundamentals" score={result.byClass.foundation.score} emphasis />
          <Bar C={C} name="Standard" note="Expected for the category" score={result.byClass.standard.score} />
          <Bar C={C} name="Distinction" note="What elevates the stay" score={result.byClass.distinction.score} last />
        </div>
      </div>

      {/* ── Dimensions ───────────────────────────────────────────────────── */}
      <div style={section}>
        <span style={label}>Dimensions</span>
        <div style={panel}>
          <Bar C={C} name="Condition" score={result.byDimension.condition.score} />
          <Bar C={C} name="Service" score={result.byDimension.service.score} />
          <Bar C={C} name="Product" score={result.byDimension.product.score} />
          <Bar C={C} name="Experience" score={result.byDimension.experience.score} last />
        </div>
      </div>

      {/* ── Findings ─────────────────────────────────────────────────────── */}
      <div style={section}>
        <span style={label}>Findings</span>

        {zeroTolerance && (
          <div style={{ ...panel, borderColor: 'rgba(245,166,35,0.45)', background: C.warnBg, marginBottom: '14px' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', letterSpacing: '0.08em', color: C.warn, marginBottom: '5px' }}>
              ZERO TOLERANCE RECORDED
            </div>
            <div style={{ fontSize: '13px', color: C.text, lineHeight: '1.55' }}>
              This audit cannot be certified and should be escalated before any report is issued.
            </div>
          </div>
        )}

        {all.length === 0 && (
          <div style={{ ...panel, color: C.dim, fontSize: '13px' }}>
            No findings recorded. Every item assessed so far was met.
          </div>
        )}

        <FindingGroup
          C={C}
          title="Critical"
          blurb="Prevents certification on its own."
          tone="#E05555"
          findings={critical}
          onOpenFinding={onOpenFinding}
        />

        <FindingGroup
          C={C}
          title="Major"
          blurb="Reported prominently. Does not block certification on its own."
          tone={C.warn}
          findings={major}
          onOpenFinding={onOpenFinding}
        />

        {minor.length > 0 && (
          <div style={{ ...panel, padding: '14px 20px' }}>
            <button
              onClick={() => setShowMinor((v) => !v)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit',
                fontFamily: 'inherit', textAlign: 'left',
              }}
            >
              <span style={{ fontSize: '13px', color: C.dim }}>
                <b style={{ color: C.text, fontWeight: '600' }}>{minor.length}</b>
                {' '}minor observation{minor.length === 1 ? '' : 's'}
              </span>
              <span style={{ fontSize: '12px', color: C.gold, fontWeight: '600' }}>
                {showMinor ? 'Hide' : 'Show'}
              </span>
            </button>

            {showMinor && (
              <div style={{ marginTop: '14px', borderTop: `1px solid ${C.border}`, paddingTop: '4px' }}>
                {minor.map((f) => (
                  <FindingRow key={f.itemId} C={C} finding={f} tone={C.muted} onOpenFinding={onOpenFinding} compact />
                ))}
              </div>
            )}
          </div>
        )}

        {(counts.critical || counts.major || counts.minor) ? (
          <div style={{ fontSize: '11px', color: C.muted, marginTop: '12px', lineHeight: '1.5' }}>
            Findings are derived from what was recorded against each item. Nothing is flagged by hand.
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function FindingGroup({ C, title, blurb, tone, findings, onOpenFinding }) {
  if (!findings.length) return null;
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '9px', marginBottom: '8px' }}>
        <span style={{ fontSize: '12px', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase', color: tone }}>
          {findings.length} {title}
        </span>
        <span style={{ fontSize: '11px', color: C.muted, lineHeight: '1.4' }}>{blurb}</span>
      </div>
      {findings.map((f) => (
        <FindingRow key={f.itemId} C={C} finding={f} tone={tone} onOpenFinding={onOpenFinding} />
      ))}
    </div>
  );
}

function FindingRow({ C, finding: f, tone, onOpenFinding, compact }) {
  const clickable = Boolean(onOpenFinding);
  const open = () => clickable && onOpenFinding(f.sectionId, f.itemId);
  return (
    <div
      onClick={open}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } : undefined}
      style={{
        background: compact ? 'transparent' : C.surface,
        border: compact ? 'none' : `1px solid ${C.border}`,
        borderTop: compact ? `1px solid ${C.border}` : undefined,
        borderLeft: compact ? 'none' : `2px solid ${tone}`,
        borderRadius: compact ? 0 : '10px',
        padding: compact ? '12px 0' : '14px 16px',
        marginBottom: compact ? 0 : '8px',
        cursor: clickable ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' }}>
        <span style={{ fontSize: '13px', fontWeight: compact ? '400' : '600', lineHeight: '1.45', color: compact ? C.dim : C.text }}>
          {f.label}
        </span>
        <span style={{ fontSize: '10px', color: C.muted, fontWeight: '600', letterSpacing: '0.06em', flexShrink: 0 }}>
          {f.itemId}
        </span>
      </div>

      {f.note && (
        <div style={{ fontSize: '12px', color: C.dim, marginTop: '7px', lineHeight: '1.5' }}>{f.note}</div>
      )}

      <div style={{ fontSize: '11px', color: C.muted, marginTop: '7px' }}>
        {f.sectionLabel}
        {' · '}
        {statusWord(f.status)}
        {clickable && <span style={{ color: C.gold, marginLeft: '6px' }}>Open &#8250;</span>}
      </div>
    </div>
  );
}

function Metric({ C, value, caption, hint, accent }) {
  // A word instead of a number needs to sit at reading size, not display size.
  const isWord = typeof value === 'string' && !/\d/.test(value);
  return (
    <div style={{
      flex: 1, background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: '12px', padding: '18px 16px',
    }}>
      <div style={{
        fontSize: isWord ? '15px' : '27px',
        fontWeight: isWord ? '600' : '700',
        letterSpacing: '-0.015em',
        color: isWord ? C.dim : accent,
        fontFamily: isWord ? 'inherit' : "'IBM Plex Mono', monospace",
        paddingTop: isWord ? '10px' : 0,
        paddingBottom: isWord ? '10px' : 0,
      }}>
        {value}
      </div>
      <div style={{ fontSize: '11.5px', color: C.dim, marginTop: '5px' }}>{caption}</div>
      {hint && <div style={{ fontSize: '10.5px', color: C.muted, marginTop: '2px' }}>{hint}</div>}
    </div>
  );
}

function Bar({ C, name, note, score, emphasis, last }) {
  const value = score === null || score === undefined ? null : score;
  return (
    <div style={{ marginBottom: last ? 0 : '15px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', marginBottom: '6px' }}>
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
      {note && <div style={{ fontSize: '10.5px', color: C.muted, marginTop: '5px' }}>{note}</div>}
    </div>
  );
}

const badge = (C) => ({
  display: 'inline-block', fontSize: '10px', fontWeight: '700', letterSpacing: '0.12em',
  color: C.dim, border: `1px solid ${C.border}`, borderRadius: '4px',
  padding: '3px 8px', marginBottom: '13px',
});

const statusWord = (s) => (s === 'missed' ? 'Missed' : s === 'partial' ? 'Partial' : s || 'Not assessed');
