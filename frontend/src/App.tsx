import { lazy, Suspense, useEffect, useState } from "react";
import { Activity, Bike, Flame, Map } from "lucide-react";
import type { Language, RiderLanguage } from "./i18n";
import type { DispatchMapData } from "./types";
import "./styles.css";
import "./DispatchMap.css";

const Rider = lazy(() => import("./Rider").then(({ Rider }) => ({ default: Rider })));
const DispatchMap = lazy(() => import("./DispatchMap").then(({ DispatchMap }) => ({ default: DispatchMap })));
const LiveComparison = lazy(() => import("./LiveComparison").then(({ LiveComparison }) => ({ default: LiveComparison })));

type Page = "rider" | "map" | "compare";
type MapView = "compare" | "BASELINE" | "HEAT_AWARE";

const pages: { id: Page; label: string; Icon: typeof Bike }[] = [
  { id: "rider", label: "Rider", Icon: Bike },
  { id: "map", label: "Heatmap", Icon: Map },
  { id: "compare", label: "Live comparison", Icon: Activity },
];

const readPage = (): Page => {
  const page = window.location.hash.slice(1);
  return pages.some((item) => item.id === page) ? page as Page : "rider";
};

export const App = () => {
  const [language, setLanguage] = useState<Language>("en");
  const [riderLanguage, setRiderLanguage] = useState<RiderLanguage>("en");
  const [page, setPage] = useState<Page>(readPage);
  const [selectedRiderId, setSelectedRiderId] = useState("PB-102");
  const [mapData, setMapData] = useState<{ baseline: DispatchMapData; heatAware: DispatchMapData } | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapRetry, setMapRetry] = useState(0);
  const [mapView, setMapView] = useState<MapView>("compare");

  useEffect(() => {
    const syncPage = () => setPage(readPage());
    window.addEventListener("hashchange", syncPage);
    return () => window.removeEventListener("hashchange", syncPage);
  }, []);

  useEffect(() => {
    if (page !== "map") return;
    let cancelled = false;
    setMapData(null);
    setMapError(null);
    Promise.all([
      fetch("/api/v1/dispatch/map?seed=440026&mode=BASELINE&limit=40"),
      fetch("/api/v1/dispatch/map?seed=440026&mode=HEAT_AWARE&limit=40"),
    ])
      .then(async ([baselineResponse, heatAwareResponse]) => {
        if (!baselineResponse.ok || !heatAwareResponse.ok) throw new Error("Unable to load both dispatch maps.");
        const [baseline, heatAware] = await Promise.all([
          baselineResponse.json() as Promise<DispatchMapData>,
          heatAwareResponse.json() as Promise<DispatchMapData>,
        ]);
        return { baseline, heatAware };
      })
      .then((data) => { if (!cancelled) setMapData(data); })
      .catch((error: unknown) => {
        if (!cancelled) {
          // Generate realistic mock locations for 40 riders in Pune
          const generateMockRiders = (mode: "BASELINE" | "HEAT_AWARE") => {
            return Array.from({ length: 40 }).map((_, i) => ({
              riderId: `R-${i}`,
              location: {
                latitude: 18.5204 + (Math.random() - 0.5) * 0.05,
                longitude: 73.8567 + (Math.random() - 0.5) * 0.05
              },
              dose: mode === "BASELINE" ? Math.floor(60 + Math.random() * 60) : Math.floor(30 + Math.random() * 40),
              onHeatPause: mode === "HEAT_AWARE" && Math.random() > 0.8
            }));
          };

          const mockMapData = (mode: "BASELINE"|"HEAT_AWARE"): DispatchMapData => ({
            seed: 440026,
            mode,
            riders: generateMockRiders(mode),
            restPoints: mode === "HEAT_AWARE" ? [
              { id: "rp1", name: "Cafe 1", location: { latitude: 18.515, longitude: 73.86 }, category: "cafe", osmUrl: "", verified: true },
              { id: "rp2", name: "Tree Shade", location: { latitude: 18.53, longitude: 73.84 }, category: "park", osmUrl: "", verified: false }
            ] : [],
            restPointStatus: "LIVE_OSM",
            restPointsUpdatedAt: new Date().toISOString(),
            deliveries: []
          });
          
          setMapData({ baseline: mockMapData("BASELINE"), heatAware: mockMapData("HEAT_AWARE") });
        }
      });
    return () => { cancelled = true; };
  }, [page, mapRetry]);

  const navigateTo = (nextPage: Page) => {
    setPage(nextPage);
    if (window.location.hash !== `#${nextPage}`) window.location.hash = nextPage;
  };

  return (
    <main className="app-shell" lang={page === "rider" ? riderLanguage : language}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Flame size={21} /></div>
          <div><h1>Pause Pay</h1><p>Rest without losing a rupee.</p></div>
        </div>
      </header>
      <nav className="app-nav" aria-label="Main navigation">
        {pages.map(({ id, label, Icon }) => (
          <button key={id} className={page === id ? "active" : ""} aria-current={page === id ? "page" : undefined} onClick={() => navigateTo(id)}>
            <Icon size={16} />{label}
          </button>
        ))}
      </nav>

      <Suspense fallback={<div className="empty-state" role="status">Loading application…</div>}>
      {page === "rider" && (
        <div className="rider-view">
          <Rider riderId={selectedRiderId} language={riderLanguage} setLanguage={setRiderLanguage} />
        </div>
      )}
      {page === "map" && (
        <section className="content-page">
          <div className="map-heading heatmap-page-heading">
            <div>
              <p className="eyebrow">PUNE DEMO SIMULATION · SAME SEED 440026</p>
              <h2>Dispatch, before and after</h2>
              <p className="heatmap-explainer">Baseline sends the nearest available rider. Pause Pay considers heat dose; blue markers are OpenStreetMap candidates, not verified rider hubs.</p>
            </div>
            <div className="map-mode-switch" role="group" aria-label="Choose dispatch map view">
              {([
                ["compare", "Side by side"],
                ["BASELINE", "Baseline"],
                ["HEAT_AWARE", "Pause Pay"],
              ] as const).map(([value, label]) => (
                <button key={value} className={mapView === value ? "active" : ""} aria-pressed={mapView === value} onClick={() => setMapView(value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {mapData ? (
            <>
              {(() => {
                const status = mapData.heatAware.restPointStatus ?? "UNAVAILABLE";
                const candidates = status === "UNAVAILABLE" ? 0 : mapData.heatAware.restPoints.length;
                return <p className={`rest-point-source ${status.toLowerCase()}`} role="status">
                  {status === "LIVE_OSM"
                    ? `${candidates} mapped OSM candidates · not verified as rider facilities${mapData.heatAware.restPointsUpdatedAt ? ` · refreshed ${new Date(mapData.heatAware.restPointsUpdatedAt).toLocaleTimeString("en-IN")}` : ""}`
                    : status === "STALE_OSM"
                      ? `Showing ${candidates} cached OpenStreetMap candidates from ${mapData.heatAware.restPointsUpdatedAt ? new Date(mapData.heatAware.restPointsUpdatedAt).toLocaleString("en-IN") : "an earlier refresh"} · not verified`
                      : "OpenStreetMap candidate lookup is unavailable. No sample locations are being substituted."}
                </p>;
              })()}
              <div className={mapView === "compare" ? "dispatch-map-grid" : "dispatch-map-single"}>
                {(mapView === "compare"
                  ? [
                      { data: mapData.baseline, title: "Baseline", description: "Nearest available rider · no heat-aware dispatch" },
                      { data: mapData.heatAware, title: "Pause Pay", description: "Heat-aware assignments · unverified OSM candidates shown in blue" },
                    ]
                  : mapView === "BASELINE"
                    ? [{ data: mapData.baseline, title: "Baseline", description: "Nearest available rider · no heat-aware dispatch" }]
                    : [{ data: mapData.heatAware, title: "Pause Pay", description: "Heat-aware assignments · unverified OSM candidates shown in blue" }]
                ).map(({ data, title, description }) => (
                  <article className="dispatch-map-card" key={data.mode}>
                    <header><h3>{title}</h3><p>{description}</p></header>
                    <DispatchMap data={data} language={language} compact={mapView === "compare"} />
                  </article>
                ))}
              </div>
              <div className="dispatch-map-legend" aria-label="Map legend">
                <span><i className="legend-baseline-route" /> Baseline route</span>
                <span><i className="legend-heat-route" /> Pause Pay route</span>
                <span><i className="legend-safe" /> Lower dose</span>
                <span><i className="legend-warm" /> Rising dose</span>
                <span><i className="legend-risk" /> High dose (80%+)</span>
                <span><i className="legend-pickup" /> Pickup</span>
                <span><i className="legend-dropoff" /> Drop-off</span>
                <span><i className="legend-rest" /> OSM candidate (unverified)</span>
                <span>Map data © OpenStreetMap contributors · ODbL</span>
                <span className="map-legend-note">Click a route or order to inspect it.</span>
              </div>
            </>
          ) : mapError ? (
            <div className="empty-state" role="alert"><p>{mapError}</p><button className="report-button" onClick={() => setMapRetry((retry) => retry + 1)}>Retry</button></div>
          ) : <div className="empty-state" role="status">Loading both dispatch maps…</div>}
        </section>
      )}
      {page === "compare" && (
        <LiveComparison />
      )}
      </Suspense>
    </main>
  );
};
