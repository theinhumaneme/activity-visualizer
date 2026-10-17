import { type ReactNode, useEffect, useRef, useState } from "react";
import { Badge, Card, Chevron, GroupHeading, Help, NextStep, Page, Segmented, Spinner, Tag } from "../components/ui";
import type { QualityItem, QualityLevel } from "../lib/analysis/types";
import { formatDateTime, formatDistance, formatDuration, formatUtcOffset } from "../lib/format/format";
import { useStore } from "../state/store";

const LEVEL: Record<QualityLevel, { label: string; tone: "warning" | "neutral" | "good"; path: string }> = {
  warn: { label: "Warning", tone: "warning", path: "M12 8v5m0 3h.01" },
  info: { label: "Note", tone: "neutral", path: "M12 8h.01M11 12h1v5h1" },
  ok: { label: "OK", tone: "good", path: "M5 12.5 10 17 19 7" },
};
const ORDER: QualityLevel[] = ["warn", "info", "ok"];

const PRIVACY_OPTIONS = [0, 100, 200, 400];

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function LevelIcon({ level, className = "h-4 w-4" }: { level: QualityLevel; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" aria-hidden>
      <path d={LEVEL[level].path} />
    </svg>
  );
}

function AuditItem({ q }: { q: QualityItem }) {
  const lvl = LEVEL[q.level];
  return (
    <li>
      <details className="group">
        <summary className="flex items-start gap-3 rounded-control px-2 py-2.5 transition-colors hover:bg-surface-2">
          <span className="mt-0.5 w-[5.75rem] shrink-0">
            <Badge tone={lvl.tone} icon={<LevelIcon level={q.level} className="h-3 w-3" />}>
              {lvl.label}
            </Badge>
          </span>
          <span className="min-w-0 flex-1 font-medium break-words tabular">{q.title}</span>
          <Chevron className="mt-1 text-muted" />
        </summary>
        <p className="disclosure-body pb-3 pl-2 pr-8 text-[15px] leading-relaxed text-ink-2 break-words sm:pl-[7.25rem]">{q.detail}</p>
      </details>
    </li>
  );
}

function Field({ label, children, aside }: { label: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 flex items-center justify-between gap-2 text-sm font-medium text-ink-2">
        <span className="flex items-center gap-1.5">{label}</span>
        {aside}
      </span>
      {children}
    </label>
  );
}

export function CheckPage() {
  const a = useStore((s) => s.analysis)!;
  const activity = useStore((s) => s.activity)!;
  const activities = useStore((s) => s.activities);
  const settings = useStore((s) => s.settings)!;
  const fileName = useStore((s) => s.fileName);
  const demStatus = useStore((s) => s.demStatus);
  const updateSettings = useStore((s) => s.updateSettings);
  const chooseActivity = useStore((s) => s.chooseActivity);
  const routeOnly = activity.routeOnly;
  const fullDuration = activity.samples[activity.samples.length - 1].t;
  const observedMax = activity.samples.reduce((m, s) => Math.max(m, s.hr ?? 0), 0);
  const privacyOptions = PRIVACY_OPTIONS.includes(settings.privacyRadius)
    ? PRIVACY_OPTIONS
    : [...PRIVACY_OPTIONS, settings.privacyRadius].sort((x, y) => x - y);
  const count = (l: QualityLevel) => a.quality.filter((q) => q.level === l).length;
  const warnings = count("warn");
  const notes = count("info");
  const passed = count("ok");
  const sorted = ORDER.flatMap((l) => a.quality.filter((q) => q.level === l));
  const issues = sorted.filter((q) => q.level !== "ok");
  const okItems = sorted.filter((q) => q.level === "ok");
  const trimMax = Math.max(0, Math.floor(fullDuration / 3));

  const facts: [string, string][] = [
    ["Sport", activity.sport],
    [
      "Started",
      `${formatDateTime(activity.startTime, activity.utcOffsetMin)}${activity.utcOffsetMin !== undefined ? ` (${formatUtcOffset(activity.utcOffsetMin)})` : ""}`,
    ],
    ["Device", activity.device ?? "Unknown"],
    ["Recorded", routeOnly ? "No timestamps" : formatDuration(fullDuration)],
    ["Distance", formatDistance(activity.samples[activity.samples.length - 1].dist, settings.units)],
    ["Laps", String(activity.laps.length)],
  ];

  return (
    <Page
      title="Check your data"
      subtitle={
        <>
          What's in <span className="break-all font-medium text-ink">{fileName}</span>, what was fixed, and how far to trust it.
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0 space-y-6">
          {activities.length > 1 && (
            <Card variant="settings" title="This file has several activities" description="Pick the one to visualize.">
              <select className="field" value={activities.indexOf(activity)} onChange={(e) => chooseActivity(Number(e.target.value))}>
                {activities.map((x, i) => (
                  <option key={i} value={i}>
                    {formatDateTime(x.startTime, x.utcOffsetMin)} · {x.sport} · {formatDistance(x.samples[x.samples.length - 1].dist, settings.units)}
                  </option>
                ))}
              </select>
            </Card>
          )}

          <Card variant="summary">
            <div className="flex items-start gap-3.5">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${warnings ? "bg-warning/15 text-warning" : "bg-good/15 text-good"}`}
                aria-hidden
              >
                <LevelIcon level={warnings ? "warn" : "ok"} className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-section font-semibold">{a.privacy.empty ? "Privacy zone hides the whole route" : "Ready to analyze"}</h2>
                <p className="mt-0.5 text-[15px] text-ink-2">
                  {[warnings && plural(warnings, "warning"), notes && plural(notes, "note"), passed && `${passed} passed`].filter(Boolean).join(" · ") ||
                    "Nothing to report"}
                  {demStatus === "loading" && (
                    <span className="ml-2 inline-flex items-center gap-1.5 text-muted">
                      <Spinner className="h-3.5 w-3.5" /> checking elevation against terrain
                    </span>
                  )}
                </p>
              </div>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-grid pt-5 sm:grid-cols-3">
              {facts.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-label font-medium text-muted">{k}</dt>
                  <dd className="mt-0.5 font-semibold break-words tabular">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title="Data audit" aside={issues.length ? "Select an item for details" : undefined}>
            {issues.length > 0 ? (
              <ul className="-mx-2 divide-y divide-grid">
                {issues.map((q) => (
                  <AuditItem key={q.title} q={q} />
                ))}
              </ul>
            ) : (
              <p className="text-[15px] text-ink-2">No warnings or notes.</p>
            )}
            {okItems.length > 0 && (
              <details className="group mt-3 border-t border-grid pt-3">
                <summary className="inline-flex items-center gap-1.5 rounded-md py-1 text-sm font-medium text-ink-2 hover:text-ink">
                  <Chevron />
                  {plural(okItems.length, "check")} passed
                </summary>
                <ul className="disclosure-body -mx-2 mt-1 divide-y divide-grid">
                  {okItems.map((q) => (
                    <AuditItem key={q.title} q={q} />
                  ))}
                </ul>
              </details>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card variant="settings" title="Settings" description="These change the analysis on every step.">
            <div className="space-y-7">
              <section>
                <GroupHeading>Activity details</GroupHeading>
                <div className="space-y-4">
                  <Field label="Activity name">
                    <input className="field" value={settings.name} onChange={(e) => updateSettings({ name: e.target.value })} />
                  </Field>
                  <div>
                    <div className="mb-1.5 text-sm font-medium text-ink-2">Units</div>
                    <Segmented
                      label="Units"
                      value={settings.units}
                      onChange={(units) => updateSettings({ units })}
                      options={[
                        { value: "metric", label: "Kilometers" },
                        { value: "imperial", label: "Miles" },
                      ]}
                    />
                  </div>
                </div>
              </section>

              {a.zones.length > 0 && (
                <section className="border-t border-grid pt-6">
                  <GroupHeading aside={settings.maxHrEstimated && <Tag tone="warning" title="Not reached in this file: set your real max for accurate zones">Estimated</Tag>}>Heart rate</GroupHeading>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Max">
                        <span className="relative block">
                          <input
                            type="number"
                            min={120}
                            max={230}
                            className="field pr-12 tabular"
                            value={settings.maxHr}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (v >= 120 && v <= 230) updateSettings({ maxHr: v });
                            }}
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-label text-muted">bpm</span>
                        </span>
                      </Field>
                      <Field label="Resting">
                        <span className="relative block">
                          <input
                            type="number"
                            min={30}
                            max={110}
                            className="field pr-12 tabular"
                            value={settings.restingHr}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (v >= 30 && v <= 110) updateSettings({ restingHr: v });
                            }}
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-label text-muted">bpm</span>
                        </span>
                      </Field>
                    </div>
                    <p className="text-sm text-ink-2">
                      Highest in this file: <span className="font-semibold text-ink tabular">{observedMax} bpm</span>
                    </p>
                    <div>
                      <div className="mb-1.5 text-sm font-medium text-ink-2">Zones based on</div>
                      <Segmented
                        label="Zone method"
                        value={settings.zoneMethod}
                        onChange={(zoneMethod) => updateSettings({ zoneMethod })}
                        options={[
                          { value: "max", label: "% of max" },
                          { value: "reserve", label: "HR reserve" },
                        ]}
                      />
                    </div>
                  </div>
                  <Help label="How zones are set">
                    <p>
                      One activity rarely reaches your true max, so the default is at least 190
                      {settings.maxHrEstimated ? " and zones are marked “estimated”" : ""}. If you know your real max, enter it: zones depend on it.
                    </p>
                    <p>
                      “% of max” splits zones by percentages of max heart rate. “HR reserve” (Karvonen) uses percentages of max − resting, added to resting.
                    </p>
                  </Help>
                </section>
              )}

              {!routeOnly && (
                <section className="border-t border-grid pt-6">
                  <GroupHeading>Trim</GroupHeading>
                  <p className="-mt-1 mb-4 text-sm text-ink-2">Cut time before you started or after you forgot to stop the watch.</p>
                  <div className="space-y-4">
                    {(
                      [
                        ["Trim start", "trimStart"],
                        ["Trim end", "trimEnd"],
                      ] as const
                    ).map(([label, key]) => (
                      <TrimSlider key={key} label={label} max={trimMax} value={settings[key]} onCommit={(v) => updateSettings({ [key]: v })} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          </Card>

          <Card
            variant="settings"
            title="Privacy"
            aside={<Badge tone={settings.privacyRadius ? "good" : "neutral"}>{settings.privacyRadius ? `${settings.privacyRadius} m hidden` : "Off"}</Badge>}
          >
            <div className="mb-1.5 text-sm font-medium text-ink-2">Hide start and finish</div>
            <Segmented
              label="Privacy radius"
              value={String(settings.privacyRadius)}
              onChange={(v) => updateSettings({ privacyRadius: Number(v) })}
              options={privacyOptions.map((r) => ({ value: String(r), label: r ? `${r} m` : "Off" }))}
            />
            <p className="mt-3 text-sm leading-relaxed text-ink-2">
              Hides the route near your start and finish on every map, the flyover and exports. Stats still use the whole activity.
            </p>
            {a.privacy.empty && (
              <p className="mt-2 text-sm font-medium text-warning">The whole route is inside the circle, so nothing will be drawn. Try a smaller radius.</p>
            )}
          </Card>
        </div>
      </div>
      <NextStep to="/overview" label="See overview" back={{ to: "/", label: "Different file" }} />
    </Page>
  );
}

/**
 * A trim slider whose label follows the thumb at once, while the full re-analysis it triggers
 * runs at most ~8 times a second (and once more on release), so dragging stays smooth on long files.
 */
function TrimSlider({ label, value, max, onCommit }: { label: string; value: number; max: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(value);
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current === null) return;
    const v = pending.current;
    pending.current = null;
    commit.current(v);
  };
  // Follow outside changes (another activity, a reset) unless a drag is in progress.
  useEffect(() => {
    if (pending.current === null) setDraft(value);
  }, [value]);
  useEffect(() => flush, []);
  const change = (v: number) => {
    setDraft(v);
    pending.current = v;
    timer.current ??= setTimeout(flush, 120);
  };
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="font-medium text-ink-2">{label}</span>
        <span className="font-semibold tabular text-ink">{formatDuration(draft)}</span>
      </div>
      <input
        type="range"
        className="w-full"
        aria-label={label}
        min={0}
        max={max}
        value={draft}
        onChange={(e) => change(Number(e.target.value))}
        onPointerUp={flush}
        onKeyUp={flush}
        onBlur={flush}
      />
    </div>
  );
}
