import { useMemo } from "react";
import { Link } from "react-router";
import { curveLabel, type PowerAnalysis } from "../../lib/analysis/power";
import type { Analysis } from "../../lib/analysis/types";
import { formatDuration } from "../../lib/format/format";
import { useTheme } from "../../state/theme";
import { type Band, Chart, type RefLine } from "../Chart";
import { Card, Explain, Help, Stat, Tag } from "../ui";
import { shares } from "./math";
import { useStretch } from "./stretch";

/** Seven power zones, recovery → neuromuscular (the five HR-zone hues plus gold and violet). */
const POWER_RAMP = {
  light: ["#8a97a8", "#3d7fbf", "#2e9e5e", "#c9a227", "#d98a16", "#d23f3a", "#8e4ad1"],
  dark: ["#8e9aab", "#5b9ee0", "#45c27a", "#e0c04a", "#f0a43a", "#f2605a", "#b07cf0"],
};

/** Stable, so Chart doesn't rebuild its plot each render; the top sprint spike shouldn't flatten the line. */
const CLIP: [number, number] = [0, 0.995];

const watts = (v: number) => `${Math.round(v)} W`;
const zoneRange = (z: PowerAnalysis["zones"][number]) =>
  z.zone === 1 ? `< ${Math.round(z.high)}` : !Number.isFinite(z.high) ? `≥ ${Math.round(z.low)}` : `${Math.round(z.low)}–${Math.round(z.high) - 1}`;

function FtpTag({ p }: { p: PowerAnalysis }) {
  return p.ftpEstimated ? (
    <Tag tone="warning" title="FTP estimated as 95% of your best 20 minutes in this ride">
      FTP estimated
    </Tag>
  ) : null;
}

/** Power over the activity (10 s average), with the zones tinted behind it once FTP is known. */
export function PowerChart({ a }: { a: Analysis }) {
  const p = a.power!;
  const theme = useTheme((s) => s.theme);
  const bands = useMemo<Band[]>(
    () =>
      p.zones.map((z, k) => ({
        low: z.low,
        high: Number.isFinite(z.high) ? z.high : Math.max(p.max, z.low * 1.25),
        label: `Z${z.zone}`,
        color: POWER_RAMP[theme][k],
      })),
    [p, theme],
  );
  const refLines = useMemo<RefLine[]>(() => [{ value: p.np, label: `NP ${Math.round(p.np)}` }], [p]);
  const fmt = useMemo(() => ({ value: watts, tick: (v: number) => String(Math.round(v)) }), []);
  return (
    <Chart
      title="Power"
      unit="W"
      values={p.series}
      color="--series-power"
      bands={bands}
      refLines={refLines}
      clip={CLIP}
      formatValue={fmt.value}
      formatTick={fmt.tick}
      aside={
        <span className="tabular">
          avg {Math.round(p.avg)} · NP {Math.round(p.np)} W
        </span>
      }
    />
  );
}

const perKg = (w: number, kg: number) => `${(w / kg).toFixed(2)} W/kg`;

/** W′ balance over the ride: full at the top, drained by efforts above FTP. */
export function WBalanceChart({ a }: { a: Analysis }) {
  const wb = a.power!.wbal!;
  const values = useMemo(() => Float64Array.from(wb.series, (j) => j / 1000), [wb]);
  const range = useMemo<[number, number]>(() => [Math.min(0, wb.min / 1000) - 1, (wb.wPrime / 1000) * 1.04], [wb]);
  const fmt = useMemo(() => ({ value: (v: number) => `${v.toFixed(1)} kJ`, tick: (v: number) => v.toFixed(0) }), []);
  return (
    <Chart
      title="W′ balance"
      unit="kJ"
      values={values}
      color="--series-power"
      area
      height={150}
      range={range}
      formatValue={fmt.value}
      formatTick={fmt.tick}
      aside={
        <span className="tabular">
          lowest {(wb.min / 1000).toFixed(1)} of {wb.wPrime / 1000} kJ
          {wb.wPrimeEstimated && (
            <>
              {" "}
              <Tag tone="warning" title={`W′ assumed to be a typical ${wb.wPrime / 1000} kJ`}>
                W′ assumed
              </Tag>
            </>
          )}
        </span>
      }
      footer={
        <Explain>
          The work you can still do above FTP ({a.power!.ftp} W). Efforts above it drain the tank; riding below it refills it, faster the emptier it is.
          Near zero means you were close to cracking.
          {wb.min < 0 && " It dips below zero here, which the body can't do: your FTP or W′ is probably higher than the values used, so enter yours on the Check step."}
        </Explain>
      }
    />
  );
}

/** The headline numbers: normalized power, intensity and stress against FTP, work. */
export function PowerSummary({ a }: { a: Analysis }) {
  const p = a.power!;
  const kg = a.settings.weight;
  return (
    <Card title="Power" aside={<FtpTag p={p} />}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
        <Stat label="Normalized power" value={watts(p.np)} sub="what the effort cost" />
        <Stat label="Average power" value={watts(p.avg)} sub={`max ${Math.round(p.max)} W`} />
        <Stat label="Variability" value={p.vi.toFixed(2)} sub={p.vi < 1.05 ? "steady, like a time trial" : p.vi < 1.15 ? "some surges" : "very surgy"} />
        {p.intensity !== undefined && <Stat label="Intensity" value={p.intensity.toFixed(2)} sub={`of FTP ${p.ftp} W`} />}
        {p.tss !== undefined && <Stat label="Training stress" value={String(Math.round(p.tss))} sub="TSS · 100 = an hour at FTP" />}
        <Stat label="Work" value={`${Math.round(p.work).toLocaleString()} kJ`} sub={`≈ ${Math.round(p.work).toLocaleString()} kcal burned`} />
        {kg > 0 && <Stat label="Watts per kilo" value={perKg(p.np, kg)} sub={p.ftp > 0 ? `normalized · FTP ${perKg(p.ftp, kg)}` : "normalized power"} />}
        {p.wbal && (
          <Stat
            label="Lowest W′ balance"
            value={`${(p.wbal.min / 1000).toFixed(1)} kJ`}
            sub={
              p.wbal.min < 0
                ? "below empty, so your FTP or W′ is likely higher than set"
                : `${Math.round((p.wbal.min / p.wbal.wPrime) * 100)}% of ${p.wbal.wPrime / 1000} kJ left`
            }
          />
        )}
      </div>
      <Help label="What these mean">
        <p>
          Normalized power weights hard efforts more than easy ones (a 4th-power average of the 30-second rolling power), so a surgy ride scores higher
          than a steady one at the same average. Variability is NP ÷ average.
        </p>
        <p>Intensity is NP ÷ FTP. Training stress combines intensity and duration: an hour flat out at FTP is 100.</p>
        <p>Work is total energy delivered to the pedals; at typical efficiency it is close to the calories you burned.</p>
        <p>
          {kg > 0 ? (
            "Watts per kilo divides power by the weight you entered on the Check step: it's what decides how fast you climb."
          ) : (
            <>
              <Link to="/check" className="font-medium text-ink underline underline-offset-2">
                Enter your weight on the Check step
              </Link>{" "}
              to see watts per kilo.
            </>
          )}
        </p>
        {p.wbal && (
          <p>
            W′ balance treats FTP as the line between sustainable and not, and tracks how much of your {p.wbal.wPrime / 1000} kJ above it is left
            {p.wbal.wPrimeEstimated ? " (a typical value; enter yours on the Check step)" : ""}.
          </p>
        )}
        <p>
          {p.ftpEstimated ? (
            p.ftp > 0 ? (
              <>
                FTP is estimated at {p.ftp} W (95% of your best 20 minutes here).{" "}
                <Link to="/check" className="font-medium text-ink underline underline-offset-2">
                  Enter yours on the Check step
                </Link>{" "}
                for zones and stress you can trust.
              </>
            ) : (
              <>
                This ride is too short to estimate FTP.{" "}
                <Link to="/check" className="font-medium text-ink underline underline-offset-2">
                  Enter yours on the Check step
                </Link>{" "}
                to see intensity, stress and zones.
              </>
            )
          ) : (
            "FTP is the one you entered on the Check step."
          )}
        </p>
      </Help>
    </Card>
  );
}

/** Best average power for each duration; hover a row to find that effort on the map and charts. */
export function PowerCurve({ a }: { a: Analysis }) {
  const p = a.power!;
  const stretch = useStretch();
  const top = p.curve[0]?.watts || 1;
  const kg = a.settings.weight;
  return (
    <Card title="Power curve" description="Your best average power for each duration, anywhere in the ride." aside={kg > 0 && <span className="tabular">W · W/kg</span>}>
      <ul className="space-y-1.5">
        {p.curve.map((c) => {
          return (
            <li
              key={c.seconds}
              tabIndex={0}
              className={`grid cursor-pointer ${kg > 0 ? "grid-cols-[3.75rem_minmax(0,1fr)_4.5rem_4.5rem]" : "grid-cols-[3.75rem_minmax(0,1fr)_4.5rem]"} items-center gap-x-3 rounded-md px-1 py-1 text-sm outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2`}
              {...stretch({ from: c.startIdx, to: c.endIdx, label: `Best ${curveLabel(c.seconds)} power` })}
            >
              <span className="font-medium text-ink-2 tabular">{curveLabel(c.seconds)}</span>
              <span className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <span className="block h-full rounded-full bg-series-power" style={{ width: `${(c.watts / top) * 100}%` }} />
              </span>
              <span className="text-right font-semibold text-ink tabular">{watts(c.watts)}</span>
              {kg > 0 && <span className="text-right text-ink-2 tabular">{(c.watts / kg).toFixed(2)}</span>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Time in each of the seven power zones, hardest first. */
export function PowerZones({ a }: { a: Analysis }) {
  const p = a.power!;
  const theme = useTheme((s) => s.theme);
  const ramp = POWER_RAMP[theme];
  const pct = shares(p.zones.map((z) => z.seconds));
  const top = Math.max(...pct, 0.0001);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          Time in power zones
          <FtpTag p={p} />
        </span>
      }
      aside={<span className="tabular">FTP {p.ftp} W</span>}
    >
      <div
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={p.zones.map((z, k) => `Zone ${z.zone} ${Math.round(pct[k] * 100)}%`).join(", ")}
      >
        {p.zones.map((z, k) =>
          pct[k] > 0 ? <div key={z.zone} style={{ width: `${pct[k] * 100}%`, background: ramp[k] }} title={`Z${z.zone} ${z.name}: ${Math.round(pct[k] * 100)}%`} /> : null,
        )}
      </div>
      <ul className="mt-4 space-y-2.5">
        {[...p.zones].reverse().map((z) => {
          const k = z.zone - 1;
          return (
            <li key={z.zone} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 text-sm sm:grid-cols-[2rem_10.5rem_minmax(0,1fr)_auto]">
              <span className="flex h-6 w-8 items-center justify-center rounded-md text-[12px] font-bold text-white tabular" style={{ background: ramp[k] }}>
                Z{z.zone}
              </span>
              <span className="min-w-0 truncate">
                <span className="font-medium text-ink">{z.name}</span> <span className="text-label text-muted tabular">{zoneRange(z)}</span>
              </span>
              <span
                className="col-span-2 col-start-2 row-start-2 mt-1 h-2 overflow-hidden rounded-full bg-surface-2 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:mt-0"
                aria-hidden
              >
                <span className="block h-full rounded-full" style={{ width: `${(pct[k] / top) * 100}%`, background: ramp[k] }} />
              </span>
              <span className="text-right tabular">
                <span className="font-semibold text-ink">{formatDuration(z.seconds)}</span>
                <span className="inline-block w-11 text-right text-muted">{Math.round(pct[k] * 100)}%</span>
              </span>
            </li>
          );
        })}
      </ul>
      <Help label="How zones are set">
        <p>The seven Coggan zones, as percentages of FTP: under 55%, 55–75, 75–90, 90–105, 105–120, 120–150 and above. Coasting counts as zone 1.</p>
      </Help>
    </Card>
  );
}
