import { useEffect, useRef, useState} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';

interface Warning {
  eventId: string;
  label: string;
  timestamp: string;
  eventTime: string;
}

interface Vehicle {
  id: string;
  regNo: string;
  transporter: string;
  assetName: string;
  status: 'Moving' | 'Idle' | 'Stationary' | 'Parked' | 'Inactive' | 'Offline';
  date: string;
  panic: boolean;
  warnings?: Warning[];
  position: {
    latitude: number;
    longitude: number;
    speed: number;
    heading: number;
    address: string;
  } | null;
}

interface Props {
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  statusFilter: string;
  onAcknowledge: (id: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  Moving: '#16a34a',
  Idle: '#d97706',
  Stationary: '#0d9488',
  Parked: '#ea580c',
  Inactive: '#2563eb',
  Offline: '#64748b',
  Panic: '#c8102e',
  Warning: '#d97706',
};

function createCircleIcon(color: string) {
  return L.divIcon({
    html: `<div style="
      width: 12px; height: 12px;
      border-radius: 50%;
      background: ${color};
      border: 2px solid #fff;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    "></div>`,
    className: '',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -10],
  });
}

function createFlagIcon(color: string, isPanic: boolean) {
  const height = isPanic ? 32 : 28;
  const svg = `
    <svg width="24" height="${height}" viewBox="0 0 24 ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="0" width="2.5" height="${height}" fill="${color}" rx="1"/>
      <path d="M4.5 1 L22 ${isPanic ? 9 : 8} L4.5 ${isPanic ? 17 : 15} Z" fill="${color}" stroke="#fff" stroke-width="1"/>
    </svg>
  `;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [24, height],
    iconAnchor: [2, height],
    popupAnchor: [10, -height],
  });
}

export default function MapView({ authFetch, statusFilter, onAcknowledge }: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const clusterGroupRef = useRef<any>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const prevPanicIds = useRef<Set<string>>(new Set());
  const prevWarningIds = useRef<Set<string>>(new Set());

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    mapRef.current = L.map(mapContainerRef.current, {
      center: [6.5244, 3.3792],
      zoom: 10,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(mapRef.current);

    clusterGroupRef.current = (L as any).markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: (cluster: any) => {
        const count = cluster.getChildCount();
        const hasChildPanic = cluster.getAllChildMarkers().some((m: any) => m.options.isPanic);
        const hasChildWarning = cluster.getAllChildMarkers().some((m: any) => m.options.isWarning);
        const bg = hasChildPanic ? '#c8102e' : hasChildWarning ? '#d97706' : '#334155';
        return L.divIcon({
          html: `<div style="
            width: 32px; height: 32px;
            border-radius: 50%;
            background: ${bg};
            border: 2px solid #fff;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            display: flex; align-items: center; justify-content: center;
            color: #fff; font-size: 12px; font-weight: 700;
          ">${count}</div>`,
          className: '',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
      },
    });

    mapRef.current.addLayer(clusterGroupRef.current);

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Load vehicle data
  useEffect(() => {
    const load = async () => {
      try {
        const res = await authFetch('/api/data');
        if (res.ok) {
          const data = await res.json();
          setVehicles(Array.isArray(data) ? data : []);
        }
      } catch {
        // ignore
      }
    };
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, []);

  // Expose acknowledge function globally for popup button
  useEffect(() => {
    (window as any).acknowledgeVehicle = (id: string) => {
      onAcknowledge(id);
      markersRef.current.get(id)?.closePopup();
    };
    return () => {
      delete (window as any).acknowledgeVehicle;
    };
  }, [onAcknowledge]);

  // Update markers and handle auto-pan
  useEffect(() => {
    if (!mapRef.current || !clusterGroupRef.current) return;

    const filtered = vehicles.filter(v => {
      if (!v.position?.latitude || !v.position?.longitude) return false;
      const matchesStatus = statusFilter === 'All' || v.status === statusFilter;
      const matchesSearch = searchTerm === '' ||
        v.regNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        v.assetName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        v.transporter.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesStatus && matchesSearch;
    });

    // Find new panics and warnings for auto-pan
    const currentPanicIds = new Set(filtered.filter(v => v.panic).map(v => v.id));
    const currentWarningIds = new Set(filtered.filter(v => v.warnings && v.warnings.length > 0 && !v.panic).map(v => v.id));

    const newPanics = filtered.filter(v => v.panic && !prevPanicIds.current.has(v.id));
    const newWarnings = filtered.filter(v => v.warnings && v.warnings.length > 0 && !v.panic && !prevWarningIds.current.has(v.id));

    prevPanicIds.current = currentPanicIds;
    prevWarningIds.current = currentWarningIds;

    // Auto-pan to new panic first, then new warning
    const autoPanTarget = newPanics[0] || newWarnings[0];
    if (autoPanTarget?.position) {
      mapRef.current.flyTo(
        [autoPanTarget.position.latitude, autoPanTarget.position.longitude],
        15,
        { animate: true, duration: 1.5 }
      );
    }

    // Remove markers no longer in filtered list
    const filteredIds = new Set(filtered.map(v => v.id));
    markersRef.current.forEach((marker, id) => {
      if (!filteredIds.has(id)) {
        clusterGroupRef.current.removeLayer(marker);
        markersRef.current.delete(id);
      }
    });

    // Add or update markers
    filtered.forEach(vehicle => {
      if (!vehicle.position || !mapRef.current) return;

      const isPanic = vehicle.panic;
      const hasWarning = !isPanic && vehicle.warnings && vehicle.warnings.length > 0;
      const color = isPanic ? STATUS_COLORS.Panic : hasWarning ? STATUS_COLORS.Warning : STATUS_COLORS[vehicle.status] || STATUS_COLORS.Offline;
      const icon = (isPanic || hasWarning) ? createFlagIcon(color, isPanic) : createCircleIcon(color);
      const warningLabels = vehicle.warnings?.map(w => w.label).join(', ') || '';

      const popupContent = `
        <div style="font-family: system-ui, sans-serif; min-width: 200px; padding: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <strong style="font-size: 14px; color: ${isPanic ? '#c8102e' : '#0f172a'};">${vehicle.regNo}</strong>
            <span style="
              padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 500;
              background: ${isPanic ? '#fff1f2' : '#f1f5f9'};
              color: ${isPanic ? '#c8102e' : '#64748b'};
              border: 1px solid ${isPanic ? '#fecdd3' : '#e2e8f0'};
            ">${isPanic ? 'PANIC' : vehicle.status}</span>
          </div>
          <div style="font-size: 12px; color: #0f172a; margin-bottom: 4px;">${vehicle.assetName}</div>
          <div style="font-size: 11px; color: #64748b; margin-bottom: 4px;">${vehicle.transporter}</div>
          <div style="font-size: 11px; color: #64748b; margin-bottom: 4px;">📍 ${vehicle.position.address || 'Unknown'}</div>
          <div style="font-size: 11px; color: #64748b; margin-bottom: ${isPanic || hasWarning ? '8px' : '0'};">${vehicle.position.speed.toFixed(1)} km/h • ${vehicle.date}</div>
          ${hasWarning ? `<div style="font-size: 11px; color: #854F0B; background: #fef3c7; padding: 4px 8px; border-radius: 4px; margin-bottom: ${isPanic ? '8px' : '0'};">⚠ ${warningLabels}</div>` : ''}
          ${isPanic ? `<button
            onclick="window.acknowledgeVehicle('${vehicle.id}')"
            style="width: 100%; padding: 6px; background: #c8102e; color: #fff; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; margin-top: 4px;">
            ACKNOWLEDGE
          </button>` : ''}
        </div>
      `;

      if (markersRef.current.has(vehicle.id)) {
        const existing = markersRef.current.get(vehicle.id)!;
        existing.setLatLng([vehicle.position.latitude, vehicle.position.longitude]);
        existing.setIcon(icon);
        existing.getPopup()?.setContent(popupContent);
      } else {
        const marker = L.marker(
          [vehicle.position.latitude, vehicle.position.longitude],
          { icon, isPanic, isWarning: !!hasWarning } as any
        ).bindPopup(popupContent, { maxWidth: 240 });
        clusterGroupRef.current.addLayer(marker);
        markersRef.current.set(vehicle.id, marker);
      }
    });
  }, [vehicles, statusFilter, searchTerm]);

  const visibleCount = vehicles.filter(v => {
    if (!v.position?.latitude) return false;
    const matchesStatus = statusFilter === 'All' || v.status === statusFilter;
    const matchesSearch = searchTerm === '' ||
      v.regNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      v.assetName.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStatus && matchesSearch;
  }).length;

  return (
    <div style={{ backgroundColor: 'var(--cd-surface)', borderRadius: '14px', border: '1px solid var(--cd-border)', overflow: 'hidden', boxShadow: 'var(--cd-card-shadow)' }}>

      {/* Map Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--cd-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '600', color: 'var(--cd-text)', marginBottom: '2px', fontFamily: 'var(--cd-font-display)' }}>Fleet Map</h2>
          <p style={{ fontSize: '13px', color: 'var(--cd-text-muted)' }}>
            Showing {visibleCount} of {vehicles.filter(v => v.position?.latitude).length} vehicles with GPS
          </p>
        </div>
        <input
          type="text"
          placeholder="Search vehicles..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={{ paddingLeft: '12px', paddingRight: '12px', paddingTop: '8px', paddingBottom: '8px', border: '1px solid var(--cd-border)', borderRadius: '10px', fontSize: '13px', outline: 'none', backgroundColor: 'var(--cd-surface-2)', color: 'var(--cd-text)', width: '200px' }}
        />
      </div>

      {/* Legend */}
      <div style={{ padding: '8px 24px', borderBottom: '1px solid var(--cd-border)', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {Object.entries(STATUS_COLORS).filter(([k]) => !['Warning'].includes(k)).map(([status, color]) => (
          <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--cd-text-muted)' }}>
            {status === 'Panic' ? (
              <svg width="14" height="18" viewBox="0 0 24 28" style={{ flexShrink: 0 }}>
                <rect x="2" y="0" width="2.5" height="28" fill={color} rx="1"/>
                <path d="M4.5 1 L22 9 L4.5 17 Z" fill={color} stroke="#fff" stroke-width="1"/>
              </svg>
            ) : (
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: color, border: '1.5px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', flexShrink: 0, display: 'inline-block' }}></span>
            )}
            {status}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--cd-text-muted)' }}>
          <svg width="14" height="16" viewBox="0 0 24 28" style={{ flexShrink: 0 }}>
            <rect x="2" y="0" width="2.5" height="28" fill="#d97706" rx="1"/>
            <path d="M4.5 1 L22 8 L4.5 15 Z" fill="#d97706" stroke="#fff" stroke-width="1"/>
          </svg>
          Warning
        </span>
      </div>

      {/* Map Container */}
      <div ref={mapContainerRef} style={{ height: '600px', width: '100%' }} />
    </div>
  );
}