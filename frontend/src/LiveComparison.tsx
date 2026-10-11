import { AlertTriangle, Pause, Play, RefreshCw, ShieldCheck, ThermometerSun, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./LiveComparison.css";

type Mode = "BASELINE" | "HEAT_AWARE";
const start: [number, number] = [18.525, 73.85];
const rest: [number, number] = [18.515, 73.86];
const end: [number, number] = [18.505, 73.855];
type RoadRoutes = { baseline: [number, number][]; toRest: [number, number][]; fromRest: [number, number][] };
const fallbackRoutes: RoadRoutes = { baseline: [start, end], toRest: [start, rest], fromRest: [rest, end] };

const fetchRoadRoute = async (from: [number, number], to: [number, number], signal: AbortSignal): Promise<[number, number][]> => {
  const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`, { signal });
  if (!response.ok) throw new Error("Road route unavailable");
  const body = await response.json() as { routes?: { geometry?: { coordinates?: [number, number][] } }[] };
  const coordinates = body.routes?.[0]?.geometry?.coordinates;
  if (!coordinates?.length) throw new Error("Road route unavailable");
  return coordinates.map(([longitude, latitude]) => [latitude, longitude]);
};

const pointAt = (points: [number, number][], progress: number): [number, number] => {
  const safeProgress = Math.max(0, Math.min(1, progress));
  const segments = points.length - 1;
  const segment = Math.min(segments - 1, Math.floor(safeProgress * segments));
  const local = safeProgress * segments - segment;
  const from = points[segment];
  const to = points[segment + 1];
  return [from[0] + (to[0] - from[0]) * local, from[1] + (to[1] - from[1]) * local];
};

const MapCard = ({ mode, tick, temperature, routes, loadingRoutes }: { mode: Mode; tick: number; temperature: number; routes: RoadRoutes; loadingRoutes: boolean }) => {
  const heatAware = mode === "HEAT_AWARE";
  const resting = heatAware && tick >= 45 && tick < 65;
  const dose = heatAware
    ? tick < 45 ? tick * 0.9 : tick < 65 ? 40 - (tick - 45) * 1.5 : 10 + (tick - 65) * 0.65
    : Math.min(100, tick * 1.15);
  const route = heatAware ? [...routes.toRest, ...routes.fromRest.slice(1)] : routes.baseline;
  const rider = !heatAware ? pointAt(routes.baseline, tick / 100)
    : resting ? rest
      : tick < 45 ? pointAt(routes.toRest, tick / 45)
        : pointAt(routes.fromRest, (tick - 65) / 35);
  const routeColor = heatAware ? "#16805f" : "#718096";

  return <article className={`sim-map-card ${heatAware ? "heatbudget-card" : "baseline-card"}`}>
    <header className={heatAware ? "map-header-heatbudget" : "map-header-baseline"}>
      <div className="map-header-left">
        {heatAware ? <><ShieldCheck size={15} /><span>Pause Pay — heat aware</span></> : <><AlertTriangle size={15} /><span>Baseline — no protection</span></>}
      </div>
      <span className={heatAware ? "safe-badge" : "danger-badge"}>{resting ? "Stopped at rest hub" : `${Math.round(dose)}% heat dose`}</span>
    </header>
    <div className="osm-map-wrap">
      <MapContainer center={[18.515, 73.855]} zoom={14} className="sim-map" scrollWheelZoom={false} attributionControl={false}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Polyline positions={route} pathOptions={{ color: routeColor, weight: 5, opacity: .8, dashArray: heatAware ? undefined : "7 6" }} />
        {heatAware && <CircleMarker center={rest} radius={10} pathOptions={{ color: "#0b57d0", fillColor: "#d2e3fc", fillOpacity: 1, weight: 3 }}><Popup><strong>Cool Cafe rest hub</strong><br />Shade · water · paid break</Popup></CircleMarker>}
        <CircleMarker center={start} radius={6} pathOptions={{ color: "#c56b23", fillColor: "#f7b267", fillOpacity: 1 }}><Popup>Current pickup</Popup></CircleMarker>
        <CircleMarker center={end} radius={6} pathOptions={{ color: "#146c4f", fillColor: "#62b58d", fillOpacity: 1 }}><Popup>Delivery destination</Popup></CircleMarker>
        <CircleMarker center={rider} radius={resting ? 11 : 8} pathOptions={{ color: "#fff", fillColor: resting ? "#16805f" : dose >= 80 ? "#cf5543" : "#d99543", fillOpacity: 1, weight: 3 }}><Popup>{resting ? "Rider resting safely" : "Rider on route"}</Popup></CircleMarker>
      </MapContainer>
      <div className="map-legend"><span><i style={{ background: routeColor }} />{loadingRoutes ? "Finding road route…" : heatAware ? "Road route via rest hub" : "Direct road route"}</span>{heatAware && <span><i style={{ background: "#1a73e8", borderRadius: 2 }} />Rest hub</span>}<span>{temperature.toFixed(1)}°C</span></div>
    </div>
  </article>;
};

export const LiveComparison = () => {
  const [playing, setPlaying] = useState(false);
  const [tick, setTick] = useState(0);
  const [temperature, setTemperature] = useState(42);
  const [routes, setRoutes] = useState<RoadRoutes>(fallbackRoutes);
  const [loadingRoutes, setLoadingRoutes] = useState(true);

  useEffect(() => {
    void fetch("https://api.open-meteo.com/v1/forecast?latitude=18.5204&longitude=73.8567&current=temperature_2m")
      .then(response => response.ok ? response.json() as Promise<{ current?: { temperature_2m?: number } }> : null)
      .then(weather => { if (weather?.current?.temperature_2m) setTemperature(weather.current.temperature_2m); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetchRoadRoute(start, end, controller.signal),
      fetchRoadRoute(start, rest, controller.signal),
      fetchRoadRoute(rest, end, controller.signal),
    ]).then(([baseline, toRest, fromRest]) => setRoutes({ baseline, toRest, fromRest }))
      .catch(() => undefined)
      .finally(() => { if (!controller.signal.aborted) setLoadingRoutes(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setTick(value => value >= 100 ? 0 : value + 1), 130);
    return () => window.clearInterval(timer);
  }, [playing]);

  const baselineDose = Math.min(100, tick * 1.15);
  const heatDose = tick < 45 ? tick * .9 : tick < 65 ? 40 - (tick - 45) * 1.5 : 10 + (tick - 65) * .65;
  const onBreak = tick >= 45 && tick < 65;
  const baselineEarnings = Math.floor(tick / 20) * 45;
  const heatEarnings = Math.floor(tick / 20) * 45 + (onBreak || tick >= 65 ? 40 : 0);

  return <section className="live-comparison">
    <div className="top-bar-new">
      <div className="title-area"><h2>Live comparison</h2><p className="subtitle-note">Pune rider shift · live weather from Open-Meteo · maps from OpenStreetMap</p></div>
      <div className="clock-bar-new">
        <button onClick={() => setPlaying(value => !value)} className="play-btn">{playing ? <Pause size={16} /> : <Play size={16} fill="currentColor" />}{playing ? "Pause" : "Play"}</button>
        <button onClick={() => { setPlaying(false); setTick(0); }} className="scenario-btn"><RefreshCw size={14} /> Reset</button>
        <strong className="clock-time">{String(12 + Math.floor(tick * 4 / 100)).padStart(2, "0")}:{String(Math.floor((tick * 240 / 100) % 60)).padStart(2, "0")}</strong>
        <span className="temp-chip">🌡 {temperature.toFixed(1)}°C · Open-Meteo</span>
      </div>
    </div>
    <div className="hero-strip">
      <div className="hero-metric"><span className="metric-label"><ThermometerSun size={14} /> Heat dose</span><div className="hero-metric-values"><div className="b-val"><small>Baseline</small><strong>{Math.round(baselineDose)}%</strong></div><div className="h-val"><small>Pause Pay</small><strong>{Math.round(heatDose)}%</strong></div></div></div>
      <div className="hero-metric"><span className="metric-label"><Wallet size={14} /> Earnings protected</span><div className="hero-metric-values"><div className="b-val"><small>Baseline</small><strong>₹{baselineEarnings}</strong></div><div className="h-val"><small>Pause Pay</small><strong>₹{heatEarnings}</strong></div></div></div>
      <div className="hero-metric"><span className="metric-label"><ShieldCheck size={14} /> Rider status</span><strong className={onBreak ? "comparison-status resting" : "comparison-status"}>{onBreak ? "Cooling down with paid break" : baselineDose >= 95 ? "Baseline rider at critical risk" : "Delivering"}</strong></div>
    </div>
    <div className="dual-map"><MapCard mode="BASELINE" tick={tick} temperature={temperature} routes={routes} loadingRoutes={loadingRoutes} /><MapCard mode="HEAT_AWARE" tick={tick} temperature={temperature} routes={routes} loadingRoutes={loadingRoutes} /></div>
  </section>;
};
