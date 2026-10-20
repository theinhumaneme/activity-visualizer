import { useEffect, useState } from "react";
import { ColorModePicker } from "../components/ColorModePicker";
import { RouteMap } from "../components/RouteMap";
import { BestEfforts, CadenceChart, DriftChart, EffortCard, HoverReadout, PaceDistribution } from "../components/analysis/Cards";
import { ElevationProfile } from "../components/analysis/ElevationProfile";
import { HeartRateChart, ZoneBreakdown } from "../components/analysis/HeartRate";
import { IntervalsPanel } from "../components/analysis/IntervalsPanel";
import { PaceChart } from "../components/analysis/PaceChart";
import { PowerChart, PowerCurve, PowerSummary, PowerZones, WBalanceChart } from "../components/analysis/Power";
import { SplitsTable } from "../components/analysis/SplitsTable";
import { SummaryHeader } from "../components/analysis/SummaryHeader";
import { WindSection } from "../components/analysis/Wind";
import { NextStep, Page, SectionHeading, Segmented } from "../components/ui";
import { useStore } from "../state/store";
import { Comparisons } from "../components/analysis/Comparisons";

/** The section whose heading was scrolled past last (under the sticky bars), for the section links. */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  const key = ids.join();
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) + 120;
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      // At the very bottom, the last section counts even if its heading never reached the line.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = ids[ids.length - 1];
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}

/**
 * The linked dashboard: every chart, the splits, reps and climbs share one cursor and one
 * highlight with the map. Route-only files (no timestamps) keep just distance and elevation.
 */
export function AnalysisPage() {
  const a = useStore((s) => s.analysis)!;
  const xAxis = useStore((s) => s.xAxis);
  const setXAxis = useStore((s) => s.setXAxis);
  const routeOnly = a.activity.routeOnly;
  const hasZones = !routeOnly && a.zones.length > 0;

  const sections = [
    { id: "charts", label: "Charts" },
    ...(a.intervals ? [{ id: "intervals", label: "Intervals" }] : []),
    ...(!routeOnly || a.elev ? [{ id: "splits", label: "Splits" }] : []),
    ...(hasZones ? [{ id: "zones", label: "HR zones" }] : []),
    ...(a.power ? [{ id: "power", label: "Power" }] : []),
    ...(!routeOnly ? [{ id: "wind", label: "Wind" }] : []),
    ...(!routeOnly ? [{ id: "efforts", label: "Best efforts" }] : []),
    ...(!routeOnly ? [{ id: "efficiency", label: "Efficiency" }] : []),
  ];
  const active = useActiveSection(sections.map((s) => s.id));

  return (
    <Page
      title="Analysis"
      subtitle={routeOnly ? "Hover the profile or the map: they move together." : "Hover any chart, split or the map: everything moves together. Click a split, climb, rep or best effort to watch it in 3D."}
      wide
    >
      <SummaryHeader a={a} variant="strip" />
      <Comparisons a={a} className="mt-3" />

      <nav
        aria-label="Sections"
        className="sticky top-[var(--header-h)] z-20 -mx-4 mt-4 border-b border-grid bg-page/90 px-4 backdrop-blur-md sm:-mx-6 sm:px-6"
      >
        <ul className="no-scrollbar flex gap-1 overflow-x-auto py-2">
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={(e) => {
                  // Scroll even when the hash is already this section's.
                  e.preventDefault();
                  document.getElementById(s.id)?.scrollIntoView({ block: "start" });
                  history.replaceState(null, "", `#${s.id}`);
                }}
                aria-current={active === s.id ? "location" : undefined}
                className={`btn btn-sm ${active === s.id ? "bg-ink text-page" : "btn-quiet"}`}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.78fr)]">
        <div className="min-w-0 space-y-12">
          <section className="space-y-4" aria-labelledby="charts-h">
            <SectionHeading
              id="charts"
              title={<span id="charts-h">Charts</span>}
              aside={
                !routeOnly && (
                  <div className="flex items-center gap-2">
                    <span className="text-label font-medium text-ink-2">Plot over</span>
                    <Segmented
                      size="sm"
                      label="Chart x-axis"
                      value={xAxis}
                      onChange={setXAxis}
                      options={[
                        { value: "distance", label: "Distance" },
                        { value: "time", label: "Time" },
                      ]}
                    />
                  </div>
                )
              }
            />
            {!routeOnly && <PaceChart a={a} />}
            {a.elev && <ElevationProfile a={a} />}
            {hasZones && <HeartRateChart a={a} />}
            {a.power && <PowerChart a={a} />}
            {!routeOnly && a.cadence && <CadenceChart a={a} />}
          </section>

          {a.intervals && (
            <section aria-labelledby="intervals-h">
              <SectionHeading id="intervals" title={<span id="intervals-h">Intervals</span>} description="Your session broken into reps and recoveries." />
              <IntervalsPanel a={a} iv={a.intervals} />
            </section>
          )}

          {(!routeOnly || a.elev) && (
            <section aria-labelledby="splits-h">
              <SectionHeading id="splits" title={<span id="splits-h">Splits</span>} description="Hover a split to find it on the map and charts; click it to watch it in 3D." />
              <SplitsTable a={a} />
            </section>
          )}

          {hasZones && (
            <section aria-labelledby="zones-h">
              <SectionHeading id="zones" title={<span id="zones-h">Heart-rate zones</span>} />
              <ZoneBreakdown a={a} />
            </section>
          )}

          {a.power && (
            <section aria-labelledby="power-h" className="space-y-4">
              <SectionHeading id="power" title={<span id="power-h">Power</span>} />
              <PowerSummary a={a} />
              {a.power.wbal && <WBalanceChart a={a} />}
              <div className="grid gap-4 xl:grid-cols-2">
                <PowerCurve a={a} />
                {a.power.zones.length > 0 && <PowerZones a={a} />}
              </div>
            </section>
          )}

          {!routeOnly && (
            <section aria-labelledby="wind-h">
              <SectionHeading id="wind" title={<span id="wind-h">Wind</span>} />
              <WindSection a={a} />
            </section>
          )}

          {!routeOnly && (
            <section aria-labelledby="efforts-h">
              <SectionHeading id="efforts" title={<span id="efforts-h">Best efforts</span>} />
              <div className="grid gap-4 xl:grid-cols-2">
                <BestEfforts a={a} />
                <PaceDistribution a={a} />
              </div>
            </section>
          )}

          {!routeOnly && (
            <section aria-labelledby="efficiency-h">
              <SectionHeading id="efficiency" title={<span id="efficiency-h">Efficiency</span>} />
              <div className="space-y-4">
                <EffortCard a={a} />
                {hasZones && <DriftChart a={a} />}
              </div>
            </section>
          )}
        </div>

        {/* On phones a compact map leads; on desktop it rides along beside the charts with its readout. */}
        <aside className="order-first min-w-0 lg:order-none">
          <div className="space-y-3 lg:sticky lg:top-[calc(var(--header-h)+4.25rem)]">
            <RouteMap className="h-[220px] sm:h-[320px] lg:h-[max(300px,calc(100dvh-var(--header-h)-20rem))]" showStops />
            <div className="hidden lg:block">
              <HoverReadout a={a} />
            </div>
            <ColorModePicker />
          </div>
        </aside>
        {/* Phones: the readout stays pinned under the section links while you scroll the charts. */}
        <div className="sticky top-[calc(var(--header-h)+3rem)] z-10 order-first -mx-4 bg-page/90 px-4 pb-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:hidden">
          <HoverReadout a={a} compact />
        </div>
      </div>
      <NextStep to="/flyover" label="Watch the flyover" back={{ to: "/overview", label: "Overview" }} />
    </Page>
  );
}
