import {
  MapPin, Navigation, Siren, Droplets, Wallet, Bike,
  CheckCircle2, Trees, Coffee, Zap, Loader2, QrCode, ScanLine, X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { RiderLanguage } from "./i18n";
import { riderText } from "./i18n";
import type { IScannerControls } from "@zxing/browser";
import L from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./Rider.css";

// ─── fix Leaflet default icon paths (broken by Vite) ─────────────────────────
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ─── helpers ─────────────────────────────────────────────────────────────────
const lerp  = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpPt = (a: [number,number], b: [number,number], t: number): [number,number] =>
  [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

// Walk t (0..1) along a multi-point polyline
const interpolateRoute = (pts: [number,number][], t: number): [number,number] => {
  if (!pts.length) return [18.5204, 73.8567];
  if (t <= 0) return pts[0];
  if (t >= 1) return pts[pts.length - 1];
  const seg = t * (pts.length - 1);
  const i   = Math.floor(seg);
  return lerpPt(pts[i], pts[Math.min(i + 1, pts.length - 1)], seg - i);
};

const hubCodeFor = (name: string) => name.toLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

const parseRestHubQr = (payload: string): string | null => {
  try {
    const url = new URL(payload);
    if (url.protocol !== "pausepay:" || url.hostname !== "hub") return null;
    const hubId = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(hubId) ? hubId : null;
  } catch {
    return null;
  }
};

// OSRM public router — real road geometry, no API key needed
const fetchRoadRoute = async (
  from: [number,number], to: [number,number]
): Promise<[number,number][]> => {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from[1]},${from[0]};${to[1]},${to[0]}` +
    `?overview=full&geometries=geojson`;
  const res  = await fetch(url);
  const json = await res.json() as {
    routes?: { geometry: { coordinates: [number,number][] } }[];
  };
  // OSRM returns [lng, lat]; Leaflet needs [lat, lng]
  return (json.routes?.[0]?.geometry.coordinates ?? []).map(
    ([lng, lat]) => [lat, lng] as [number,number]
  );
};

// ─── icons ────────────────────────────────────────────────────────────────────
const placeIcon = (type: string) => L.divIcon({
  className: "",
  html: `<div style="
    width:34px;height:34px;border-radius:50%;
    background:${type==="rest"?"#16805f":type==="water"?"#1a73e8":"#7b5ea7"};
    display:flex;align-items:center;justify-content:center;
    border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,0.28);
    font-size:16px;
  ">${type==="rest"?"☕":type==="water"?"💧":"🌳"}</div>`,
  iconSize:   [34, 34],
  iconAnchor: [17, 17],
});

const riderIcon = (color: string) => L.divIcon({
  className: "",
  html: `<div style="
    width:42px;height:42px;border-radius:50%;
    background:${color};
    display:flex;align-items:center;justify-content:center;
    border:3px solid #fff;box-shadow:0 4px 16px rgba(0,0,0,0.32);
    font-size:22px;
  ">🛵</div>`,
  iconSize:   [42, 42],
  iconAnchor: [21, 21],
});

const destinationIcon = (emoji: string) => L.divIcon({
  className: "",
  html: `<div style="
    width:36px;height:36px;border-radius:50%;
    background:#fff;border:3px solid #222;
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 2px 10px rgba(0,0,0,0.25);font-size:18px;
  ">${emoji}</div>`,
  iconSize:   [36, 36],
  iconAnchor: [18, 18],
});

// ─── smooth-follow camera ────────────────────────────────────────────────────
const SmoothCamera = ({ center }: { center: [number,number] }) => {
  const map     = useMap();
  const raf     = useRef<number>(0);
  const current = useRef<[number,number]>(center);

  useEffect(() => {
    const target = center;
    const tick = () => {
      current.current = lerpPt(current.current, target, 0.08);
      const zoom = map.getZoom();
      const visibleCenter = map.unproject(
        map.project(current.current, zoom).add([0, map.getSize().y * 0.12]),
        zoom,
      );
      map.panTo(visibleCenter, { animate: false });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [map, center]);

  return null;
};

const ObserveMapSize = () => {
  const map = useMap();

  useEffect(() => {
    let frame = 0;
    const invalidateSize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    };
    const observer = new ResizeObserver(invalidateSize);
    observer.observe(map.getContainer());
    window.addEventListener("resize", invalidateSize);
    invalidateSize();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", invalidateSize);
    };
  }, [map]);

  return null;
};

// ─── sub-components ──────────────────────────────────────────────────────────
const PlaceMarker = ({
  place,
  language,
}: {
  place: { id: number; type: string; lat: number; lng: number; name: string; time: string; credit: number };
  language: RiderLanguage;
}) => (
  <Marker position={[place.lat, place.lng]} icon={placeIcon(place.type)}>
    <Popup closeButton={false}>
      <div style={{ minWidth: 150, fontFamily: "DM Sans, sans-serif", padding: 4 }}>
        <strong style={{ fontSize: 15 }}>{place.name}</strong>
        <p style={{ margin: "4px 0 2px", color: "#555", fontSize: 13 }}>🚶 {place.time} {riderText[language].walk}</p>
        {place.credit > 0 && (
          <p style={{ margin: 0, color: "#16805f", fontWeight: 700, fontSize: 13 }}>
            {riderText[language].pauseCredit}: ₹{place.credit}
          </p>
        )}
      </div>
    </Popup>
  </Marker>
);

// ─── main component ──────────────────────────────────────────────────────────
export const Rider = ({
  riderId,
  language,
  setLanguage,
}: {
  riderId: string;
  language: RiderLanguage;
  setLanguage: (l: RiderLanguage) => void;
}) => {
  const t = riderText[language];
  const [dose, setDose]           = useState(38);
  const [earnings, setEarnings]   = useState(450);
  const [status, setStatus]       = useState<"ACTIVE" | "RESTING" | "OFFLINE">("ACTIVE");
  const [restTimer, setRestTimer] = useState(300);
  const [task, setTask]           = useState<"IDLE" | "PICKUP" | "DROPOFF">("IDLE");
  const [progress, setProgress]   = useState(0);
  const [toast, setToast]         = useState<string | null>(null);
  const [orderSeed, setOrderSeed] = useState(0);
  const [routeLoading, setRouteLoading] = useState(false);
  const [restCheckedIn, setRestCheckedIn] = useState(false);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
  const [scannedHubId, setScannedHubId] = useState<string | null>(null);
  const [mapLayout, setMapLayout] = useState("initial");
  const [isSendingSos, setIsSendingSos] = useState(false);
  
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scanCompletedRef = useRef(false);

  // The backend owns AWS credentials; the rider app only requests an emergency alert.
  const fireEmergencyEmail = async () => {
    setIsSendingSos(true);
    showToast("Triggering AWS Emergency Protocol...");
    try {
      const response = await fetch(`/api/v1/alerts/emergency/${encodeURIComponent(riderId)}`, { method: "POST" });
      if (!response.ok) throw new Error("Emergency alert delivery failed");
      showToast("Emergency alert sent to Fleet Manager!");
    } catch (error) {
      console.error("Failed to send AWS SNS SOS:", error);
      showToast("Error: Could not send AWS Alert.");
    }
    setIsSendingSos(false);
  };

  // real road polylines fetched from OSRM
  const [pickupRoad,  setPickupRoad]  = useState<[number,number][]>([]);
  const [dropoffRoad, setDropoffRoad] = useState<[number,number][]>([]);
  const [restRoad,    setRestRoad]    = useState<[number,number][]>([]);
  const [restOrigin, setRestOrigin] = useState<[number,number] | null>(null);
  const [restDestinationId, setRestDestinationId] = useState<number | null>(null);

  // deterministic rider base location
  const idHash = useMemo(() =>
    riderId ? riderId.split("").reduce((a, b) => a + b.charCodeAt(0), 0) : 100,
  [riderId]);
  const baseLat = 18.5204 + (idHash % 100 - 50) / 4000;
  const baseLng = 73.8567 + ((idHash * 3) % 100 - 50) / 4000;

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const nextLayout = `${Math.round(width)}x${Math.round(height)}`;
      setMapLayout(current => current === nextLayout ? current : nextLayout);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // order waypoints (deterministic per orderSeed)
  const { pickupPt, dropoffPt, customerPt, restaurantName, orderNum, restPlace } = useMemo(() => {
    const s = idHash + orderSeed * 17;
    const rnames = ["Vaishali", "Cafe Goodluck", "Burger King", "Kalyani Veg", "Le Plaisir", "Blue Nile", "Wadeshwar", "Roopali"];
    const rPlace = ["Cool Cafe", "Akbar Park Shade", "PMC Water Point", "Kalmadi Shaded Spot", "Shivaji Bridge Rest"][s % 5];

    const off = (n: number, scale = 8000) => ((n % 120 - 60) / scale);
    const pLat = baseLat + off(s);
    const pLng = baseLng + off(s * 7);
    const dLat = baseLat + off(s * 13);
    const dLng = baseLng + off(s * 19);

    return {
      pickupPt:      [baseLat, baseLng]   as [number,number],
      dropoffPt:     [pLat, pLng]         as [number,number],
      customerPt:    [dLat, dLng]         as [number,number],
      restaurantName: rnames[s % rnames.length],
      orderNum:       (s * 13 + 1000) % 9000 + 1000,
      restPlace:      rPlace,
    };
  }, [idHash, orderSeed, baseLat, baseLng]);
  // rest + helper place markers
  const places = useMemo(() => {
    const s = idHash + orderSeed;
    const off = (n: number) => ((n % 60 - 30) / 10000);
    return [
      { id: 1, type: "rest",  lat: baseLat + off(s * 7),  lng: baseLng + off(s * 11), name: restPlace,           time: "3 min", credit: 20 },
      { id: 2, type: "water", lat: baseLat + off(s * 13), lng: baseLng - off(s * 17), name: "PMC Water Point",   time: "2 min", credit: 5  },
      { id: 3, type: "shade", lat: baseLat - off(s * 19), lng: baseLng + off(s * 23), name: "Banyan Tree Shade", time: "1 min", credit: 10 },
    ];
  }, [idHash, orderSeed, baseLat, baseLng, restPlace]);
  const activeRestPlace = places.find(place => place.id === restDestinationId) ?? places[0];
  const activeRestName = activeRestPlace.name;
  const expectedHubId = useMemo(() => hubCodeFor(activeRestName), [activeRestName]);

  // ── fetch REAL road routes whenever order changes ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    setRouteLoading(true);
    setPickupRoad([]);
    setDropoffRoad([]);
    setRestRoad([]);

    Promise.all([
      fetchRoadRoute(pickupPt,  dropoffPt),
      fetchRoadRoute(dropoffPt, customerPt),
    ]).then(([pr, dr]) => {
      if (cancelled) return;
      setPickupRoad(pr.length  ? pr : [pickupPt,  dropoffPt]);   // fallback to straight line if OSRM fails
      setDropoffRoad(dr.length ? dr : [dropoffPt, customerPt]);
      setRouteLoading(false);
    }).catch(() => {
      if (cancelled) return;
      // graceful fallback to straight lines
      setPickupRoad([pickupPt,  dropoffPt]);
      setDropoffRoad([dropoffPt, customerPt]);
      setRouteLoading(false);
    });

    return () => { cancelled = true; };
  }, [orderSeed, pickupPt, dropoffPt, customerPt, places]);

  useEffect(() => {
    if (status !== "RESTING" || !restOrigin || !activeRestPlace) return;
    let cancelled = false;
    const destination: [number, number] = [activeRestPlace.lat, activeRestPlace.lng];
    setRestRoad([restOrigin, destination]);
    void fetchRoadRoute(restOrigin, destination).then(route => {
      if (!cancelled && route.length) setRestRoad(route);
    }).catch(() => {
      if (!cancelled) setRestRoad([restOrigin, destination]);
    });
    return () => { cancelled = true; };
  }, [status, restOrigin, activeRestPlace]);

  // current road path being driven
  const activeRoad =
    task === "PICKUP"  ? pickupRoad  :
    task === "DROPOFF" ? dropoffRoad :
    status === "RESTING" ? restRoad  : null;

  // rider position = interpolated along road
  const riderPos: [number,number] = activeRoad?.length
    ? interpolateRoute(activeRoad, progress)
    : pickupPt;

  // ── animate progress along road ───────────────────────────────────────────
  useEffect(() => {
    if (!activeRoad?.length) return;
    const id = setInterval(() => setProgress(p => Math.min(1, p + 0.006)), 80);
    return () => clearInterval(id);
  }, [activeRoad, task, status]);

  // ── dose ticker ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (status === "ACTIVE") {
      const id = setInterval(() => setDose(d => Math.min(110, d + 4)), 6000);
      return () => clearInterval(id);
    }
    if (status === "RESTING" && restCheckedIn) {
      const id = setInterval(() => {
        setDose(d => Math.max(0, d - 6));
        setRestTimer(r => Math.max(0, r - 1));
      }, 1000);
      return () => clearInterval(id);
    }
  }, [status, restCheckedIn]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const doseColor =
    dose > 100 ? "#8B0000" :
    dose >= 80 ? "#cf5543" :
    dose >= 50 ? "#d99543" :
                 "#16805f";

  const acceptOrder = () => { setTask("PICKUP"); setProgress(0); showToast(`${t.headingTo} ${restaurantName}`); };
  const arrivedPickup = () => { setTask("DROPOFF"); setProgress(0); showToast(t.pickedUp); };
  const completeDelivery = () => {
    setTask("IDLE"); setProgress(0);
    setEarnings(e => e + 45);
    setOrderSeed(s => s + 1);
    showToast(`₹45 ${t.earned}`);
  };
  const startRest = () => {
    const nearestPlace = places.reduce((nearest, place) => {
      const distance = (place.lat - riderPos[0]) ** 2 + (place.lng - riderPos[1]) ** 2;
      const nearestDistance = (nearest.lat - riderPos[0]) ** 2 + (nearest.lng - riderPos[1]) ** 2;
      return distance < nearestDistance ? place : nearest;
    });
    setRestOrigin(riderPos);
    setRestDestinationId(nearestPlace.id);
    setRestRoad([riderPos, [nearestPlace.lat, nearestPlace.lng]]);
    setStatus("RESTING");
    setTask("IDLE");
    setProgress(0);
    setRestCheckedIn(false);
    showToast(`${t.restShared}: ${nearestPlace.name}`);
  };
  const checkInAtRest = useCallback((hubId: string) => {
    setScannedHubId(hubId);
    setRestCheckedIn(true);
    setRestTimer(300);
    setShowQrScanner(false);
    showToast(t.demoCheckin);
  }, [showToast, t]);

  const openQrScanner = () => {
    scanCompletedRef.current = false;
    setScannedHubId(null);
    setScanMessage(t.cameraStarting);
    setShowQrScanner(true);
  };

  useEffect(() => {
    if (!showQrScanner) return;
    let cancelled = false;
    let controls: IScannerControls | null = null;
    scanCompletedRef.current = false;
    const video = videoRef.current;
    if (!video) {
      setScanMessage(t.cameraUnavailable);
      return;
    }

    const startCameraScanner = async () => {
      try {
        if (navigator.permissions?.query) {
          const cameraPermission = await navigator.permissions.query({ name: "camera" as PermissionName });
          if (cameraPermission.state === "denied") {
            setScanMessage(t.cameraUnavailable);
            return;
          }
        }
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (cancelled) return;
        const startedControls = await new BrowserQRCodeReader().decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: "environment" } } },
          video,
          (result, _error, activeControls) => {
            controls = activeControls;
            scannerControlsRef.current = activeControls;
            if (cancelled || !result || scanCompletedRef.current) return;
            const scannedId = parseRestHubQr(result.getText());
            if (!scannedId) {
              setScanMessage(t.qrInvalid);
              return;
            }
            if (scannedId !== expectedHubId) {
              setScanMessage(`${t.qrWrongHub} ${t.expectedCode}: pausepay://hub/${expectedHubId}`);
              return;
            }

            scanCompletedRef.current = true;
            activeControls.stop();
            checkInAtRest(scannedId);
          },
        );
        controls = startedControls;
        scannerControlsRef.current = startedControls;
        if (cancelled) startedControls.stop();
        else setScanMessage(t.cameraScanning);
      } catch {
        if (!cancelled) setScanMessage(t.cameraUnavailable);
      }
    };
    void startCameraScanner();

    return () => {
      cancelled = true;
      controls?.stop();
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
    };
  }, [showQrScanner, expectedHubId, checkInAtRest, t]);

  const routeColor =
    task === "PICKUP"  ? "#1a73e8" :
    task === "DROPOFF" ? "#f59e0b" :
    dose >= 80 ? "#cf5543" : "#16805f";

  // ETA estimate based on progress
  const pickupETA  = Math.max(1, Math.round((1 - progress) * 6));
  const dropoffETA = Math.max(1, Math.round((1 - progress) * 10));

  return (
    <div className="rider-screen">
      {toast && <div className="app-toast" key={toast}>{toast}</div>}

      {showQrScanner && (
        <div className="qr-scanner" role="dialog" aria-modal="true" aria-label={t.scanDialog}>
            <div className="scanner-top"><button onClick={() => setShowQrScanner(false)} aria-label={t.closeScanner}><X size={20}/></button><strong>{t.scanHub}</strong><span/></div>
          <div className="scanner-view">
            <div className="scan-frame">
              <video ref={videoRef} className="scanner-video" autoPlay muted playsInline />
              <div className="scan-target"><i/><i/><i/><i/><ScanLine size={34}/></div>
            </div>
            <p role="status" aria-live="polite">{scanMessage}</p>
            <p className="expected-qr">{t.expectedCode}: <code>pausepay://hub/{expectedHubId}</code></p>
            <p className="scanner-local-note">{t.serverNotVerified}</p>
          </div>
          </div>
      )}

      {/* ── full-bleed map ── */}
      <div className="rider-map-container" ref={mapContainerRef}>
        <MapContainer
          key={`${baseLat.toFixed(5)}-${baseLng.toFixed(5)}-${mapLayout}`}
          center={riderPos}
          zoom={14}
          zoomControl
          scrollWheelZoom
          className="rider-map"
          attributionControl={false}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <ObserveMapSize />
          <SmoothCamera center={riderPos} />

          {/* real road route polyline */}
          {activeRoad && activeRoad.length > 1 && (
            <Polyline
              positions={activeRoad}
              pathOptions={{ color: routeColor, weight: 6, opacity: 0.85, lineCap: "round", lineJoin: "round" }}
            />
          )}

          {/* destination marker */}
          {task === "PICKUP" && (
            <Marker position={dropoffPt} icon={destinationIcon("🏪")} />
          )}
          {task === "DROPOFF" && (
            <Marker position={customerPt} icon={destinationIcon("📦")} />
          )}

          {/* helper place markers */}
          {places.map(p => <PlaceMarker key={p.id} place={p} language={language} />)}

          {/* rider */}
          <Marker position={riderPos} icon={riderIcon(doseColor)} zIndexOffset={1000} />
        </MapContainer>

        {/* loading badge */}
        {routeLoading && (
          <div className="route-loading-badge">
            <Loader2 size={14} className="spin-icon" /> {t.fetchingRoad}
          </div>
        )}
      </div>

      {/* ── floating glass header ── */}
      <header className="rider-header">
        <div className="rider-top">
          <label className="language-switch">
            <select value={language} onChange={e => setLanguage(e.target.value as RiderLanguage)}>
              <option value="en">EN</option>
              <option value="hi">हिंदी</option>
              <option value="mr">मराठी</option>
            </select>
          </label>
          <div className="earnings-pill"><Wallet size={15} /> ₹{earnings}</div>
        </div>
        <div className="dose-header">
          <div
            className="circular-dose"
            style={{ "--dose": `${Math.min(100, dose)}%`, "--dose-color": doseColor } as CSSProperties}
          >
            <strong>{Math.round(dose)}%</strong>
          </div>
          <p>{t.heatDose}</p>
        </div>
      </header>

      {/* ── bottom sheet ── */}
      <div className="rider-bottom-card">
        <div className="drag-handle" />

        {status === "OFFLINE" ? (
          <div className="card-state">
            <h3>{t.offline}</h3>
            <p><MapPin size={15} /> {t.lastLocation}</p>
            <button className="btn-primary" onClick={() => setStatus("ACTIVE")}>{t.goOnline}</button>
          </div>

        ) : status === "RESTING" ? (
          <div className="card-state">
            <h3>{t.restingAt} {activeRestName}</h3>
            {restCheckedIn ? <>
              <p><Droplets size={15} /> {t.checkinVerified} · {scannedHubId} · {Math.floor(restTimer / 60)}:{String(restTimer % 60).padStart(2, "0")} {t.left}</p>
              <div className="progress-bar"><div style={{ width: `${Math.max(0, (300 - restTimer) / 300 * 100)}%`, background: doseColor }} /></div>
              <button className="btn-secondary" style={{ marginTop: 12 }} onClick={() => { setStatus("ACTIVE"); setRestTimer(300); }}>{t.goOnline}</button>
            </> : <>
              <p><MapPin size={15} /> {t.followRoute} <strong>{activeRestName}</strong>. {t.qrAtHub}</p>
              <button className="btn-primary nav-btn" onClick={openQrScanner}><QrCode size={17} /> {t.atHub}</button>
              <button className="btn-secondary" style={{ marginTop: 10 }} onClick={() => setStatus("ACTIVE")}>{t.cannotReach}</button>
            </>}
          </div>

        ) : task === "PICKUP" ? (
          <div className="card-state">
            <div className="task-pill blue"><Zap size={13} /> {t.onWayPickup}</div>
            <h3>{restaurantName}</h3>
            <p><Navigation size={15} /> {pickupETA} {t.away}</p>
            <div className="progress-bar"><div style={{ width: `${progress * 100}%`, background: "#1a73e8" }} /></div>
            <button className="btn-primary blue-btn" style={{ marginTop: 14 }} onClick={arrivedPickup}>
              {t.arrivedRestaurant}
            </button>
          </div>

        ) : task === "DROPOFF" ? (
          <div className="card-state">
            <div className="task-pill amber"><Bike size={13} /> {t.delivering}</div>
            <h3>{t.order} #{orderNum}</h3>
            <p><Navigation size={15} /> {dropoffETA} {t.away}</p>
            <div className="progress-bar"><div style={{ width: `${progress * 100}%`, background: "#f59e0b" }} /></div>
            <button className="btn-primary amber-btn" style={{ marginTop: 14 }} onClick={completeDelivery}>
              <CheckCircle2 size={18} /> {t.markDelivered}
            </button>
          </div>

        ) : dose < 50 ? (
          <div className="card-state">
            <div className="task-pill green"><Zap size={13} /> {t.newOrder}</div>
            <h3>{t.order} #{orderNum}</h3>
            <p><MapPin size={15} /> {t.pickup}: {restaurantName} · 1.2 km</p>
            <button className="btn-primary accept-btn" onClick={acceptOrder}>{t.accept} (₹45)</button>
          </div>

        ) : dose < 80 ? (
          <div className="card-state">
            <div className="task-pill amber"><Trees size={13} /> {t.shadedRoute}</div>
            <h3>{t.order} #{orderNum}</h3>
            <p><MapPin size={15} /> {t.pickup}: {restaurantName} · {t.shadedRoute}</p>
            <button className="btn-primary accept-btn" onClick={acceptOrder}>{t.accept} (₹45)</button>
          </div>

        ) : dose <= 100 ? (
          <div className="card-state">
            <div className="task-pill red"><Droplets size={13} /> {t.heatLimitReached}</div>
            <h3>{t.breakTime}</h3>
            <p><Coffee size={15} /> {restPlace} · {t.pauseCredit} ₹20</p>
            <button className="btn-primary nav-btn" onClick={startRest}><Navigation size={17} /> {t.navigateRest}</button>
            <button className="btn-secondary" onClick={acceptOrder}>{t.skipBreak}</button>
          </div>

        ) : (
          <div className="card-state">
            <div className="task-pill dark"><Siren size={13} /> {t.critical}</div>
            <h3>{t.stopNow}</h3>
            <p><Siren size={15} /> {t.seriousRisk}</p>
            <button className="btn-primary critical-btn" onClick={startRest}><Droplets size={17} /> {t.forceBreak}</button>
            <button className="btn-text warning-text" onClick={acceptOrder}>{t.ignoreRisk}</button>
          </div>
        )}

        <div className="rider-safety-actions">
          {status === "ACTIVE" && <button className="request-rest-btn" onClick={startRest}><Coffee size={16} /> {t.requestBreak}</button>}
          <button className="emergency-btn" onClick={fireEmergencyEmail} disabled={isSendingSos}>
            {isSendingSos ? <Loader2 size={17} className="spin" /> : <Siren size={17} />}
            {isSendingSos ? "Sending SOS..." : t.emergency}
          </button>
        </div>
      </div>
    </div>
  );
};
