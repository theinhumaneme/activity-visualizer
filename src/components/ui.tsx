import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";
import { splitUnit } from "./analysis/units";

export function Page({
  title,
  subtitle,
  children,
  wide,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  /** Controls aligned with the title on wide screens. */
  actions?: ReactNode;
}) {
  return (
    <div className={`mx-auto px-4 py-8 sm:px-6 sm:py-10 ${wide ? "max-w-7xl" : "max-w-5xl"}`}>
      <div className="enter flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[1.75rem] font-bold leading-tight tracking-[-0.025em] sm:text-title">{title}</h1>
          {subtitle && <div className="mt-2 max-w-3xl text-base text-ink-2">{subtitle}</div>}
        </div>
        {actions}
      </div>
      <div className="enter mt-6 sm:mt-8" style={stagger(1)}>
        {children}
      </div>
    </div>
  );
}

/** Delay for the `enter` animation: the nth item of a group arrives a beat after the one before. */
export function stagger(i: number): CSSProperties {
  return { "--i": i } as CSSProperties;
}

/** Stand-in while a page's code loads: the page's shape, not a bare "Loading…". */
export function PageSkeleton({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="fade-in-late mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="skeleton h-9 w-56 rounded-control sm:h-10 sm:w-72" />
      <div className="skeleton mt-3 h-4 w-full max-w-md rounded-full" />
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-6">
          <div className="skeleton h-40 rounded-card" />
          <div className="skeleton h-56 rounded-card" />
        </div>
        <div className="skeleton h-[300px] rounded-card sm:h-[440px]" />
      </div>
    </div>
  );
}

type CardVariant = "default" | "summary" | "chart" | "settings" | "inset";

const CARD: Record<CardVariant, string> = {
  // Generic content card.
  default: "rounded-card border border-grid bg-surface p-4 sm:p-5",
  // Headline numbers: the most padding and a raised edge.
  summary: "rounded-card border border-grid bg-surface p-5 shadow-[var(--shadow-raised)] sm:p-6",
  // Charts: tighter so the plot gets the width.
  chart: "rounded-card border border-grid bg-surface px-3 pb-4 pt-4 sm:px-5 sm:pt-5",
  // Forms: sits on the page tone, so it reads as "controls", not "results".
  settings: "rounded-card border border-grid bg-page p-5 sm:p-6",
  // Nested inside another card.
  inset: "rounded-control bg-surface-2 p-3 sm:p-4",
};

export function Card({
  title,
  children,
  aside,
  className = "",
  id,
  caps,
  variant = "default",
  description,
}: {
  title?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
  id?: string;
  /** Small uppercase title, for cards that are a label more than a heading. */
  caps?: boolean;
  variant?: CardVariant;
  description?: ReactNode;
}) {
  return (
    <section id={id} className={`min-w-0 scroll-mt-32 ${CARD[variant]} ${className}`}>
      {(title || aside) && (
        <div
          className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 ${description ? "mb-1" : "mb-4"} ${variant === "chart" ? "px-1 sm:px-0" : ""}`}
        >
          {title && <h2 className={caps ? "label-caps text-muted" : "text-base font-semibold text-ink"}>{title}</h2>}
          {aside && <div className="text-label text-ink-2">{aside}</div>}
        </div>
      )}
      {description && <p className="mb-4 text-sm text-ink-2">{description}</p>}
      {children}
    </section>
  );
}

/** A heading that groups several cards (Analysis sections, settings groups). */
export function SectionHeading({ id, title, description, aside }: { id?: string; title: ReactNode; description?: ReactNode; aside?: ReactNode }) {
  return (
    <div
      id={id}
      className="mb-4 flex scroll-mt-[calc(var(--header-h)+8rem)] flex-wrap lg:scroll-mt-[calc(var(--header-h)+4.5rem)] items-end justify-between gap-x-4 gap-y-2"
    >
      <div className="min-w-0">
        <h2 className="text-section font-semibold tracking-[-0.01em]">{title}</h2>
        {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
      </div>
      {aside}
    </div>
  );
}

/** Subheading inside a card (settings groups). */
export function GroupHeading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="text-[15px] font-semibold text-ink">{children}</h3>
      {aside}
    </div>
  );
}

export function Explain({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-ink-2">{children}</p>;
}

function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`chevron h-4 w-4 shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/** Methodology and other long explanations, closed until asked for. */
export function Help({ children, label = "How this is calculated", className = "mt-3" }: { children: ReactNode; label?: ReactNode; className?: string }) {
  return (
    <details className={`group text-sm ${className}`}>
      <summary className="inline-flex items-center gap-1 rounded-md py-1 pr-1 font-medium text-ink-2 transition-colors hover:text-ink">
        <Chevron />
        {label}
      </summary>
      <div className="disclosure-body mt-1 max-w-prose space-y-2 pl-5 leading-relaxed text-ink-2">{children}</div>
    </details>
  );
}

export { Chevron };

/** A value with its unit set smaller and lighter: "7:08 /km", "2.56 km", "163 bpm". */
export function Value({ text, className = "" }: { text: ReactNode; className?: string }) {
  if (typeof text !== "string") return <span className={`num ${className}`}>{text}</span>;
  const [num, unit] = splitUnit(text);
  return (
    <span className={`num whitespace-nowrap ${className}`}>
      {num}
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}

export function Stat({ label, value, sub, big }: { label: string; value: ReactNode; sub?: ReactNode; big?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-label font-medium text-muted">{label}</div>
      <Value text={typeof value === "number" ? String(value) : value} className={`mt-0.5 block leading-tight ${big ? "text-[2rem]" : "text-[1.375rem]"}`} />
      {sub && <div className="mt-0.5 text-label text-ink-2">{sub}</div>}
    </div>
  );
}

export function NextStep({ to, label, back }: { to: string; label: string; back?: { to: string; label: string } }) {
  return (
    <div className="mt-10 flex flex-wrap-reverse items-center justify-between gap-3 border-t border-grid pt-6">
      {back ? (
        <Link to={back.to} className="btn btn-quiet">
          <span aria-hidden className="nudge nudge-back">
            ←
          </span>{" "}
          {back.label}
        </Link>
      ) : (
        <span />
      )}
      <Link to={to} className="btn btn-primary btn-lg">
        {label}{" "}
        <span aria-hidden className="nudge">
          →
        </span>
      </Link>
    </div>
  );
}

function Check({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-3.5 w-3.5 shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12.5 10 17 19 7" />
    </svg>
  );
}
export { Check };

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  // Up to four options sit in one track; longer lists wrap, so each option becomes its own chip
  // (same size and selected state) instead of a track that folds into a two-line blob.
  const chips = options.length > 4;
  return (
    <div
      role="group"
      aria-label={label}
      className={
        chips ? "flex max-w-full flex-wrap gap-1.5" : "inline-flex max-w-full flex-wrap gap-0.5 rounded-full border border-grid bg-surface-2 p-0.5"
      }
    >
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={o.disabled}
            aria-pressed={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
              size === "sm" ? "min-h-7 px-2.5 text-[13px]" : "min-h-8 px-3.5 text-sm"
            } ${
              chips
                ? on
                  ? "border border-ink bg-ink text-page"
                  : "border border-grid bg-surface-2 text-ink-2 hover:border-line hover:text-ink"
                : on
                  ? "bg-ink text-page shadow-[var(--shadow-raised)]"
                  : "text-ink-2 hover:bg-surface-3 hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A labeled row of controls: label on the left on wide screens, above on phones. */
export function ControlRow({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    // Baseline-aligned, so the label lines up with the first row of controls even when they wrap.
    <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:items-baseline">
      <div className="text-label font-medium text-ink-2">{label}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        {children}
        {hint && <span className="text-label text-muted">{hint}</span>}
      </div>
    </div>
  );
}

type Tone = "neutral" | "accent" | "warning" | "good" | "critical";

const BADGE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2 ring-grid",
  accent: "bg-accent/10 text-accent-ink ring-accent/25",
  warning: "bg-warning/10 text-warning ring-warning/25",
  good: "bg-good/10 text-good ring-good/25",
  critical: "bg-critical/10 text-critical ring-critical/25",
};

/** Labeled status pill ("Warning", "Fastest", "Estimated"): sentence case, led by an icon or a status dot. */
export function Badge({ children, tone = "neutral", title, icon }: { children: ReactNode; tone?: Tone; title?: string; icon?: ReactNode }) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full py-0.5 pl-2 pr-2.5 align-middle text-[12.5px] font-medium leading-[1.125rem] tracking-[-0.005em] ring-1 ring-inset ${BADGE[tone]}`}
    >
      {icon ?? <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      <span className={tone === "neutral" ? "" : "text-ink"}>{children}</span>
    </span>
  );
}

const TAG = {
  muted: "text-muted",
  accent: "text-accent-ink",
  warning: "text-warning",
};

/**
 * A caveat or distinction set inline with text ("Estimated", "Fastest"): an icon and a word, no pill,
 * so it reads as a note on the value rather than a status. With a title, a dotted underline says there's more.
 */
export function Tag({ children, tone = "muted", title }: { children: ReactNode; tone?: "muted" | "accent" | "warning"; title?: string }) {
  return (
    <span title={title} className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap align-middle text-[13px] font-medium leading-5 ${TAG[tone]}`}>
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
        {tone === "accent" ? (
          // Fastest: a spark.
          <path fill="currentColor" stroke="none" d="M9.2 1.5 3.6 9h3.6l-.9 5.5L12.4 7H8.6l.6-5.5Z" />
        ) : (
          // Estimated: a dashed ring (not measured) around an "≈".
          <>
            <circle cx="8" cy="8" r="6.25" strokeDasharray="2.4 1.9" />
            <path d="M5.2 7c.9-.8 1.9-.8 2.8 0s1.9.8 2.8 0M5.2 9.8c.9-.8 1.9-.8 2.8 0s1.9.8 2.8 0" strokeWidth="1.25" />
          </>
        )}
      </svg>
      <span className={title ? "underline decoration-current/40 decoration-dotted underline-offset-[3px]" : ""}>{children}</span>
    </span>
  );
}

export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`spinner ${className}`} fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Centered loading message, for maps and panels. `overlay` lays it over its positioned parent. */
export function Loading({ label, overlay, dark }: { label: ReactNode; overlay?: boolean; dark?: boolean }) {
  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center gap-3 p-6 text-center text-sm font-medium ${
        overlay ? `fade-in-late absolute inset-0 z-10 ${dark ? "bg-[#101214]/70 text-white/90" : "bg-surface/80 text-ink-2"} backdrop-blur-[2px]` : "text-ink-2"
      }`}
    >
      <Spinner className="h-6 w-6 text-accent" />
      {label}
    </div>
  );
}

/** A failure with what went wrong and a labeled way to try again. */
export function Failure({
  title,
  message,
  onRetry,
  retryLabel = "Try again",
  overlay,
  dark,
}: {
  title: ReactNode;
  message?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  overlay?: boolean;
  dark?: boolean;
}) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center gap-2 p-6 text-center ${
        overlay ? `absolute inset-0 z-10 ${dark ? "bg-[#101214]/85 text-white" : "bg-surface/90 text-ink"}` : ""
      }`}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-critical/15 text-critical">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
          <path d="M12 7v6m0 4h.01" />
        </svg>
      </span>
      <p className="font-semibold">{title}</p>
      {message && <p className={`max-w-md text-sm ${dark ? "text-white/75" : "text-ink-2"}`}>{message}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn btn-secondary btn-sm mt-2">
          {retryLabel}
        </button>
      )}
    </div>
  );
}

/** Inline error under a form or action. */
export function ErrorNote({ children, onRetry, retryLabel = "Try again" }: { children: ReactNode; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-control border border-critical/30 bg-critical/10 px-3 py-2.5 text-sm text-ink"
    >
      <svg
        viewBox="0 0 24 24"
        className="mt-0.5 h-4 w-4 shrink-0 text-critical"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4m0 4h.01" />
      </svg>
      <span className="min-w-0 flex-1">{children}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-semibold text-ink underline underline-offset-2 hover:text-accent-ink">
          {retryLabel}
        </button>
      )}
    </div>
  );
}
