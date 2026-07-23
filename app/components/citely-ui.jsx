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
  if (!rows.length) {
    return <div className="cy-empty">No standings yet. Run a scan.</div>;
  }

  return (
    <div className="cy-standings">
      {rows.map((row, index) => (
        <div className="cy-stand-row" key={row.name}>
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
