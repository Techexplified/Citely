import { useState } from "react";
import { Link } from "react-router";

export function CyPage({ children }) {
  return (
    <div className="cy-shell">
      <div className="cy-page">{children}</div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  meta,
  actions,
}) {
  return (
    <div className="cy-topbar">
      <div>
        <h1 className="cy-title">{title}</h1>
        {subtitle ? <p className="cy-subtitle">{subtitle}</p> : null}
        {meta ? <div className="cy-topbar__meta">{meta}</div> : null}
      </div>
      {actions ? <div className="cy-actions">{actions}</div> : null}
    </div>
  );
}

export function Card({ label, action, children, className = "" }) {
  return (
    <section className={`cy-card ${className}`.trim()}>
      {(label || action) && (
        <div className="cy-card__head">
          {label ? <p className="cy-label">{label}</p> : <span />}
          {action || null}
        </div>
      )}
      {children}
    </section>
  );
}

export function Metric({ value, hint, tone }) {
  return (
    <div className="cy-metric">
      <div className={`cy-metric__value ${tone === "alert" ? "cy-alert" : ""}`}>
        {value}
      </div>
      {hint ? <div className="cy-metric__hint">{hint}</div> : null}
    </div>
  );
}

export function MetricRow({ children, columns = 4 }) {
  return (
    <div className={columns === 3 ? "cy-grid-3" : "cy-grid-4"}>{children}</div>
  );
}

export function ScoreRing({ score = 0, max = 100 }) {
  const pct = Math.max(0, Math.min(100, Math.round((score / max) * 100)));
  return (
    <div className="cy-ring" style={{ ["--pct"]: pct }}>
      <div className="cy-ring__inner">
        {score}
        <span style={{ fontSize: 10, color: "#6b7280", fontWeight: 600 }}>
          /{max}
        </span>
      </div>
    </div>
  );
}

export function ShareBar({ value = 0, you = false }) {
  return (
    <div className="cy-bar">
      <div
        className={`cy-bar__fill ${you ? "cy-bar__fill--you" : ""}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function StandingsList({ rows = [] }) {
  const clean = (rows || []).filter(
    (row) => row?.name && String(row.name).trim().length > 0,
  );

  if (!clean.length) {
    return <div className="cy-empty">No standings yet. Run a scan.</div>;
  }

  return (
    <div className="cy-standings">
      {clean.map((row, index) => (
        <div className="cy-stand-row" key={`${row.name}-${index}`}>
          <div className="cy-rank">{index + 1}</div>
          <div>
            <div className="cy-stand-meta">
              <span>{row.name}</span>
              {row.isYou ? <span className="cy-you">YOU</span> : null}
            </div>
            <ShareBar value={row.share} you={row.isYou} />
          </div>
          <div style={{ textAlign: "right", fontWeight: 700 }}>{row.share}%</div>
        </div>
      ))}
    </div>
  );
}

export function EnginePill({ children }) {
  return <span className="cy-pill">{children}</span>;
}

export function StatusPill({ tone = "neutral", children }) {
  const cls =
    tone === "ok" ? "cy-pill cy-pill--ok" : tone === "bad" ? "cy-pill cy-pill--bad" : "cy-pill";
  return <span className={cls}>{children}</span>;
}

export function EngineMeter({ mentions = [], engines = [] }) {
  const list =
    engines.length > 0
      ? engines
      : [...new Set(mentions.map((m) => m.engine))];

  if (!list.length) {
    return (
      <div className="cy-meter">
        {[0, 1, 2].map((i) => (
          <span key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="cy-meter" title={list.join(", ")}>
      {list.map((engine) => {
        const hit = mentions.some((m) => m.engine === engine && m.mentioned);
        return <span key={engine} className={hit ? "is-on" : ""} />;
      })}
    </div>
  );
}

export function DataTable({ columns, rows, empty }) {
  if (!rows?.length) {
    return <div className="cy-empty">{empty || "Nothing here yet."}</div>;
  }

  return (
    <div className="cy-table-wrap">
      <table className="cy-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((col) => (
                <td key={col.key}>
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FilterPills({ options, value, onChange }) {
  return (
    <div className="cy-filters">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={`cy-filter ${value === opt.id ? "is-active" : ""}`}
          onClick={() => onChange(opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Multi-select for AI engines used in visibility scans.
 * Controlled: pass selected ids + onChange(nextIds).
 * Also renders hidden inputs so parent forms submit `engines`.
 */
export function EngineSelect({
  engines = [],
  selected = [],
  onChange,
  name = "engines",
  label = "Scan engines",
  formId,
}) {
  const available = engines.filter((engine) => engine.available !== false);
  const selectedSet = new Set(selected);

  const toggle = (id) => {
    if (!onChange) return;
    if (selectedSet.has(id)) {
      if (selectedSet.size <= 1) return;
      onChange(selected.filter((value) => value !== id));
      return;
    }
    onChange([...selected, id]);
  };

  if (!available.length) {
    return (
      <div className="cy-engine-select">
        <span className="cy-engine-select__label">{label}</span>
        <span className="cy-engine-select__empty">No engines configured</span>
      </div>
    );
  }

  return (
    <div className="cy-engine-select">
      <span className="cy-engine-select__label">{label}</span>
      <div className="cy-engine-select__list" role="group" aria-label={label}>
        {available.map((engine) => {
          const active = selectedSet.has(engine.id);
          return (
            <button
              key={engine.id}
              type="button"
              className={`cy-engine-chip ${active ? "is-active" : ""}`}
              aria-pressed={active}
              onClick={() => toggle(engine.id)}
            >
              {engine.label || engine.id}
            </button>
          );
        })}
      </div>
      {selected.map((id) => (
        <input key={id} type="hidden" name={name} value={id} form={formId} />
      ))}
    </div>
  );
}

export function ScanBanner({
  scanning = false,
  progress = null,
  lastScanAt = null,
  error = null,
}) {
  if (scanning) {
    const completed = progress?.completed || 0;
    const total = progress?.total || 0;
    const engine = progress?.currentEngine;
    const prompt = progress?.currentPrompt;
    return (
      <div className="cy-scan cy-scan--running" role="status" aria-live="polite">
        <div className="cy-scan__pulse" />
        <div className="cy-scan__body">
          <strong>Scan running</strong>
          <p>
            {engine
              ? `Checking ${engine}${prompt ? ` · “${prompt}”` : ""}`
              : "Asking AI engines about your tracked buyer questions…"}
          </p>
          {total > 0 ? (
            <div className="cy-scan__bar">
              <span style={{ width: `${Math.round((completed / total) * 100)}%` }} />
            </div>
          ) : (
            <div className="cy-scan__bar cy-scan__bar--indeterminate">
              <span />
            </div>
          )}
          {total > 0 ? (
            <div className="cy-scan__meta">
              {completed} / {total} checks
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cy-scan cy-scan--error" role="status">
        <div className="cy-scan__body">
          <strong>Last scan failed</strong>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (lastScanAt) {
    return (
      <div className="cy-scan" role="status">
        <div className="cy-scan__body">
          <strong>Scan idle</strong>
          <p>
            Last completed {new Date(lastScanAt).toLocaleString()}. Run a scan to
            refresh mentions and sources.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="cy-scan" role="status">
      <div className="cy-scan__body">
        <strong>No scan yet</strong>
        <p>Run a scan to see which engines name you and which sources they used.</p>
      </div>
    </div>
  );
}

function sourceHost(source) {
  if (source?.url) {
    try {
      return new URL(source.url).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  }
  return null;
}

function sourceLabel(source) {
  if (source?.title) return source.title;
  return sourceHost(source) || source?.url || "Source";
}

function groupSourcesByHost(sources = []) {
  const groups = new Map();
  for (const source of sources) {
    const host = sourceHost(source) || "Other";
    const list = groups.get(host) || [];
    list.push(source);
    groups.set(host, list);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

export function SourceList({
  sources = [],
  empty = "No sources captured for this answer.",
  compact = false,
}) {
  const [open, setOpen] = useState(false);

  if (!sources?.length) {
    return <div className="cy-sources cy-sources--empty">{empty}</div>;
  }

  if (compact) {
    return (
      <ul className="cy-sources cy-sources--compact">
        {sources.slice(0, 4).map((source) => {
          const key = source.url || source.title;
          const label = sourceLabel(source);
          return (
            <li key={key}>
              {source.url ? (
                <a href={source.url} target="_blank" rel="noreferrer">
                  {label}
                </a>
              ) : (
                <span>{label}</span>
              )}
            </li>
          );
        })}
        {sources.length > 4 ? (
          <li className="cy-sources__more">+{sources.length - 4} more</li>
        ) : null}
      </ul>
    );
  }

  const groups = groupSourcesByHost(sources);
  const siteCount = groups.length;

  return (
    <div className="cy-sources-panel">
      <button
        type="button"
        className={`cy-sources-toggle ${open ? "is-open" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          <strong>{sources.length}</strong> source{sources.length === 1 ? "" : "s"}
          <span className="cy-sources-toggle__meta">
            · {siteCount} site{siteCount === 1 ? "" : "s"}
          </span>
        </span>
        <span className="cy-sources-toggle__chevron">{open ? "Hide" : "Show"}</span>
      </button>

      {open ? (
        <div className="cy-sources-groups">
          {groups.map(([host, items]) => (
            <div className="cy-sources-group" key={host}>
              <div className="cy-sources-group__head">
                <span>{host}</span>
                <span>{items.length}</span>
              </div>
              <ul className="cy-sources">
                {items.map((source) => {
                  const key = source.url || source.title;
                  const label = sourceLabel(source);
                  const showHostOnly = label === host;
                  return (
                    <li key={key}>
                      {source.url ? (
                        <a href={source.url} target="_blank" rel="noreferrer">
                          {showHostOnly ? source.url.replace(/^https?:\/\//, "") : label}
                        </a>
                      ) : (
                        <span>{label}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <div className="cy-sources-preview">
          {groups.slice(0, 5).map(([host]) => (
            <span className="cy-sources-chip" key={host}>
              {host}
            </span>
          ))}
          {groups.length > 5 ? (
            <span className="cy-sources-chip cy-sources-chip--more">
              +{groups.length - 5}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function InfoNote({ children, onDismiss }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className="cy-note">
      <div>{children}</div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          setOpen(false);
          onDismiss?.();
        }}
      >
        ×
      </button>
    </div>
  );
}

export function EmptyState({ children }) {
  return <div className="cy-empty">{children}</div>;
}

export function TextLink({ to, children }) {
  return (
    <Link className="cy-link" to={to}>
      {children}
    </Link>
  );
}

export function Button({
  children,
  variant = "primary",
  type = "button",
  href,
  disabled,
  onClick,
  form,
  target,
}) {
  const className =
    variant === "ghost"
      ? "cy-btn cy-btn--ghost"
      : variant === "quiet"
        ? "cy-btn cy-btn--quiet"
        : "cy-btn";

  if (href) {
    return (
      <a className={className} href={href} target={target} rel={target ? "noreferrer" : undefined}>
        {children}
      </a>
    );
  }

  return (
    <button
      className={className}
      type={type}
      disabled={disabled}
      onClick={onClick}
      form={form}
    >
      {children}
    </button>
  );
}
