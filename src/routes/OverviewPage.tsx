import { ColorModePicker } from "../components/ColorModePicker";
import { RouteMap } from "../components/RouteMap";
import { SummaryHeader, startLine } from "../components/analysis/SummaryHeader";
import { Card, NextStep, Page, Value, stagger } from "../components/ui";
import { useStore } from "../state/store";

const FEATURED = 3;

export function OverviewPage() {
  const a = useStore((s) => s.analysis)!;
  const featured = a.insights.slice(0, FEATURED);
  const rest = a.insights.slice(FEATURED);

  return (
    <Page title={a.settings.name} subtitle={`${startLine(a)} · ${a.activity.sport}${a.activity.device ? ` · ${a.activity.device}` : ""}`} wide>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start">
        <SummaryHeader a={a} showName={false} />

        <div className="min-w-0 space-y-3 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <RouteMap className="h-[300px] sm:h-[440px] lg:h-[min(560px,calc(100dvh-16rem))]" />
          <ColorModePicker />
        </div>

        {a.insights.length > 0 && (
          <Card title="Highlights">
            <ul className="space-y-2.5">
              {featured.map((h, k) => (
                <li key={h.title} style={stagger(k + 3)} className="enter flex items-start justify-between gap-4 rounded-control bg-surface-2 px-4 py-3.5">
                  <div className="min-w-0">
                    <h3 className="font-semibold">{h.title}</h3>
                    <p className="mt-0.5 text-sm leading-relaxed text-ink-2">{h.text}</p>
                  </div>
                  {h.value && <Value text={h.value} className="shrink-0 text-[1.375rem] leading-tight" />}
                </li>
              ))}
            </ul>
            {rest.length > 0 && (
              <>
                <h3 className="mt-6 text-label font-semibold text-muted">Also noted</h3>
                <ul className="mt-1 divide-y divide-grid">
                  {rest.map((h) => (
                    <li key={h.title} className="flex items-baseline gap-3 py-2.5 text-[15px]">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-ink">{h.title}.</span> <span className="text-ink-2">{h.text}</span>
                      </span>
                      {h.value && <span className="shrink-0 font-semibold tabular text-ink">{h.value}</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        )}
      </div>
      <NextStep to="/analysis" label="Dig into the analysis" back={{ to: "/check", label: "Check" }} />
    </Page>
  );
}
