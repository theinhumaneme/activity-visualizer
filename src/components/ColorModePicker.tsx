import { COLOR_MODES, GRADE_SPAN, type MapTheme, RAMPS, ROUTE_COLORS, colorDomain, modeAvailable } from "../lib/map/route";
import { formatElevation, formatMotion } from "../lib/format/format";
import { useTheme } from "../state/theme";
import { useStore } from "../state/store";
import { Check, ControlRow, Segmented } from "./ui";

/** Whether a solid swatch is light enough to need a dark check mark. */
function isLight(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55;
}

/**
 * Route coloring: a solid color of your choice, or by pace (slow → fast gets brighter), HR zone
 * (five labeled colors), heart rate, grade (descent ↔ climb), elevation, cadence or progress. `theme` picks the ramp variant for
 * the map it's shown on; satellite and Night Run views pass "dark".
 */
export function ColorModePicker({ theme, bare }: { theme?: MapTheme; /** Without its own card (inside another panel). */ bare?: boolean }) {
  const a = useStore((s) => s.analysis)!;
  const mode = useStore((s) => s.colorMode);
  const setMode = useStore((s) => s.setColorMode);
  const routeColor = useStore((s) => s.routeColor);
  const setRouteColor = useStore((s) => s.setRouteColor);
  const appTheme = useTheme((s) => s.theme);
  const domain = colorDomain(a, mode);
  const kind = a.activity.kind;
  const u = a.settings.units;
  const t = theme ?? appTheme;
  const active = modeAvailable(a, mode) ? mode : "solid";

  let legend: { ramp: string[]; low: string; high: string; discrete?: string[] } | null = null;
  if (active === "pace" && domain)
    legend = { ramp: RAMPS.pace[t], low: `${formatMotion(domain[0], kind, u)} slower`, high: `faster ${formatMotion(domain[1], kind, u)}` };
  if (active === "zone") legend = { ramp: RAMPS.zone[t], low: "", high: "", discrete: ["Z1", "Z2", "Z3", "Z4", "Z5"] };
  if (active === "grade") legend = { ramp: RAMPS.grade[t], low: `−${GRADE_SPAN * 100}% descent`, high: `climb +${GRADE_SPAN * 100}%` };
  if (active === "elevation" && domain) legend = { ramp: RAMPS.elevation[t], low: formatElevation(domain[0], u), high: formatElevation(domain[1], u) };
  if (active === "hr" && domain) legend = { ramp: RAMPS.hr[t], low: `${Math.round(domain[0])} bpm`, high: `${Math.round(domain[1])} bpm` };
  if (active === "cadence" && domain) {
    const unit = kind === "ride" ? "rpm" : "spm";
    legend = { ramp: RAMPS.cadence[t], low: `${Math.round(domain[0])} ${unit}`, high: `${Math.round(domain[1])} ${unit}` };
  }
  if (active === "progress") legend = { ramp: RAMPS.progress[t], low: "Start", high: "Finish" };

  const modeLabel = (m: (typeof COLOR_MODES)[number]) => (m.mode === "pace" && kind === "ride" ? "Speed" : m.label);

  return (
    <div className={`space-y-2.5 ${bare ? "" : "rounded-card border border-grid bg-surface p-3 sm:p-4"}`} role="toolbar" aria-label="Route color">
      <ControlRow label="Color route by">
        <Segmented
          size="sm"
          label="Color route by"
          value={active}
          onChange={setMode}
          options={COLOR_MODES.map((m, i) => ({
            value: m.mode,
            label: modeLabel(m),
            title: `${modeLabel(m)} (key ${i + 1})`,
            disabled: !modeAvailable(a, m.mode),
          }))}
        />
      </ControlRow>
      <ControlRow label={active === "solid" ? "Color" : "Legend"}>
        {active === "solid" ? (
          <div role="radiogroup" aria-label="Route color" className="-ml-1 flex flex-wrap items-center">
            {ROUTE_COLORS.map((c) => {
              const on = routeColor === c.hex;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={c.label}
                  title={c.label}
                  onClick={() => setRouteColor(c.hex)}
                  className="group flex h-9 w-9 items-center justify-center rounded-full"
                >
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full ring-1 ring-black/15 transition-[transform,box-shadow] duration-150 ${
                      on ? "scale-110 shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--ink)]" : "group-hover:scale-110"
                    }`}
                    style={{ background: c.hex }}
                  >
                    {on && <Check className={`h-3 w-3 ${isLight(c.hex) ? "text-[#17202b]" : "text-white"}`} />}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          legend && (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-label text-ink-2" aria-label="Color legend">
              {legend.discrete ? (
                legend.discrete.map((z, i) => (
                  <span key={z} className="flex items-center gap-1.5 font-medium tabular">
                    <span className="h-3 w-3 rounded-full ring-1 ring-black/10" style={{ background: legend!.ramp[i] }} aria-hidden />
                    {z}
                  </span>
                ))
              ) : (
                <>
                  <span className="tabular">{legend.low}</span>
                  <span className="h-2.5 w-28 rounded-full ring-1 ring-black/10" aria-hidden style={{ background: `linear-gradient(90deg, ${legend.ramp.join(", ")})` }} />
                  <span className="tabular">{legend.high}</span>
                </>
              )}
            </div>
          )
        )}
      </ControlRow>
    </div>
  );
}
