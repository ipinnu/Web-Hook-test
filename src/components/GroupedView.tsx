import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, ChevronDown, ChevronUp, AlertOctagon, WifiOff, MapPin } from 'lucide-react';
import TripModal from './TripModal';
import type { AssetSummary } from './TripModal';

interface Warning { eventId: string; label: string; timestamp: string; eventTime: string; }

interface Vehicle {
  id: string;
  regNo: string;
  transporter: string;
  site: string;
  zone: string;
  siteId: string | null;
  assetName: string;
  make: string;
  model: string;
  status: StatusType;
  date: string;
  panic: boolean;
  warnings?: Warning[];
  position?: { latitude: number; longitude: number; speed: number; heading: number; address: string };
  activeEvents: number;
}

type StatusType = 'Moving' | 'Idle' | 'Excessive Idle' | 'Stationary' | 'Parked' | 'Inactive' | 'Offline';
type StatusFilter = 'All' | StatusType;

interface Props {
  statusFilter: StatusFilter;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  distanceSummary?: { assets?: AssetSummary[] };
  distanceLabel?: string;
  siteFilter?: string[] | null;
}

const STATUS: Record<StatusType, { color: string; bg: string; dot: string; label: string }> = {
  'Moving':         { color: '#16a34a', bg: 'rgba(22,163,74,0.12)',  dot: '#16a34a', label: 'Moving' },
  'Idle':           { color: '#A07830', bg: 'rgba(160,120,48,0.12)', dot: '#A07830', label: 'Idle' },
  'Excessive Idle': { color: '#B06230', bg: 'rgba(176,98,48,0.12)',  dot: '#B06230', label: 'Exc. Idle' },
  'Stationary':     { color: '#4D7FA0', bg: 'rgba(77,127,160,0.12)', dot: '#4D7FA0', label: 'Stationary' },
  'Parked':         { color: '#7C3AED', bg: 'rgba(124,58,237,0.12)', dot: '#7C3AED', label: 'Parked' },
  'Offline':        { color: '#6B7A8D', bg: 'rgba(107,122,141,0.1)', dot: '#6B7A8D', label: 'Temp. Inactive' },
  'Inactive':       { color: '#6878A0', bg: 'rgba(104,120,160,0.1)', dot: '#6878A0', label: 'Inactive' },
};

const STATUS_PRIORITY: Record<StatusType, number> = {
  'Moving': 7, 'Idle': 6, 'Excessive Idle': 5, 'Stationary': 4, 'Parked': 3, 'Offline': 2, 'Inactive': 1,
};


const STALE_MS = 60_000;
const WARNING_CLEAR_MS = 60_000;

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (isNaN(diff) || diff < 0) return '—';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StatusChips({ vehicles }: { vehicles: Vehicle[] }) {
  const counts: Partial<Record<StatusType, number>> = {};
  vehicles.forEach(v => { counts[v.status] = (counts[v.status] ?? 0) + 1; });
  const order: StatusType[] = ['Moving', 'Idle', 'Excessive Idle', 'Stationary', 'Parked', 'Offline', 'Inactive'];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
      {order.filter(s => counts[s]).map(s => (
        <span key={s} style={{
          fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '999px',
          background: STATUS[s].bg, color: STATUS[s].color,
          border: `1px solid ${STATUS[s].color}25`,
          backdropFilter: 'var(--cd-glass-blur)',
        }}>
          {counts[s]} {STATUS[s].label}
        </span>
      ))}
    </div>
  );
}

function VehicleCard({ vehicle, distance, onDistanceClick }: { vehicle: Vehicle; distance?: AssetSummary; onDistanceClick?: () => void }) {
  const s = STATUS[vehicle.status] ?? STATUS['Offline'];
  const isPanic = vehicle.panic;
  const uniqueWarnings = [...new Set((vehicle.warnings ?? []).map(w => w.label))];
  const address = vehicle.position?.address && vehicle.position.address !== 'Unknown'
    ? vehicle.position.address : null;
  const validJourneys = (distance?.journeys ?? []).filter(j => j.distanceKm >= 0.5);
  const validDistanceKm = validJourneys.reduce((s, j) => s + j.distanceKm, 0);
  const validJourneyCount = validJourneys.length;

  return (
    <div className={`gv-card${isPanic ? ' gv-card-panic' : ''}`}>
      {/* Status row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
            background: isPanic ? '#ef4444' : s.dot,
            boxShadow: `0 0 0 2px ${isPanic ? 'rgba(239,68,68,0.2)' : s.bg}`,
          }} />
          <span style={{
            fontSize: '11px', fontWeight: '600', color: isPanic ? '#ef4444' : s.color,
            letterSpacing: '0.03em',
          }}>
            {isPanic ? 'PANIC' : s.label}
          </span>
        </div>
        <span style={{
          fontSize: '10px', color: 'var(--cd-text-soft)',
          fontVariantNumeric: 'tabular-nums' as const,
        }}>
          {timeAgo(vehicle.date)}
        </span>
      </div>

      {/* Reg number */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
        {isPanic && <AlertOctagon size={13} style={{ color: '#ef4444', flexShrink: 0 }} />}
        <span style={{
          fontSize: '16px', fontWeight: '700', color: 'var(--cd-text)',
          fontFamily: 'var(--cd-font-display)', letterSpacing: '-0.01em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {vehicle.regNo}
        </span>
      </div>

      {/* Asset name */}
      <div style={{
        fontSize: '12px', color: 'var(--cd-text-muted)', marginBottom: '4px',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {vehicle.assetName}
      </div>

      {/* Distance */}
      {validJourneyCount > 0 ? (
        <div
          onClick={onDistanceClick}
          title="View journeys"
          style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: uniqueWarnings.length ? '8px' : '0', cursor: 'pointer' }}
        >
          <span style={{ fontSize: '12px', fontWeight: '700', color: '#0d9488', fontVariantNumeric: 'tabular-nums' as const, textDecoration: 'underline', textDecorationColor: 'rgba(13,148,136,0.4)' }}>
            {validDistanceKm.toLocaleString(undefined, { maximumFractionDigits: validDistanceKm < 10 ? 1 : 0 })} km
          </span>
          <span style={{ fontSize: '10px', color: '#0d9488', opacity: 0.7 }}>
            · {validJourneyCount} journey{validJourneyCount !== 1 ? 's' : ''}
          </span>
        </div>
      ) : (
        <div style={{ marginBottom: uniqueWarnings.length ? '8px' : '0' }} />
      )}

      {/* Warning tags */}
      {uniqueWarnings.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
          {uniqueWarnings.slice(0, 2).map((lbl, i) => (
            <span key={i} style={{
              fontSize: '9px', fontWeight: '700', padding: '2px 7px', borderRadius: '999px',
              background: 'rgba(234,179,8,0.15)', color: '#a16207',
              border: '1px solid rgba(234,179,8,0.3)', letterSpacing: '0.02em',
            }}>{lbl}</span>
          ))}
          {uniqueWarnings.length > 2 && (
            <span style={{
              fontSize: '9px', fontWeight: '700', padding: '2px 7px', borderRadius: '999px',
              background: 'rgba(234,179,8,0.15)', color: '#a16207',
              border: '1px solid rgba(234,179,8,0.3)',
            }}>+{uniqueWarnings.length - 2}</span>
          )}
        </div>
      )}

      {/* Address footer */}
      {address && (
        <div style={{
          marginTop: '8px', paddingTop: '8px',
          borderTop: '1px solid rgba(128,128,128,0.12)',
          display: 'flex', alignItems: 'flex-start', gap: '4px',
        }}>
          <MapPin size={9} style={{ color: 'var(--cd-text-soft)', flexShrink: 0, marginTop: '1px' }} />
          <span style={{
            fontSize: '10px', color: 'var(--cd-text-soft)', lineHeight: '1.4',
            overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
          }}>
            {address}
          </span>
        </div>
      )}
    </div>
  );
}

interface ZoneSectionProps {
  siteName: string;
  vehicles: Vehicle[];
  startOpen: boolean;
  assetDistanceMap: Map<string, AssetSummary>;
  distanceLabel: string;
  onVehicleClick: (vehicle: Vehicle, summary: AssetSummary) => void;
}

function ZoneSection({ siteName, vehicles, startOpen, assetDistanceMap, distanceLabel, onVehicleClick }: ZoneSectionProps) {
  const [open, setOpen] = useState(startOpen);
  const hasPanic = vehicles.some(v => v.panic);

  const siteDistanceKm = vehicles.reduce((sum, v) => {
    const journeys = (assetDistanceMap.get(v.id)?.journeys ?? []).filter(j => j.distanceKm >= 0.5);
    return sum + journeys.reduce((s, j) => s + j.distanceKm, 0);
  }, 0);
  const siteJourneys = vehicles.reduce((sum, v) => {
    return sum + (assetDistanceMap.get(v.id)?.journeys ?? []).filter(j => j.distanceKm >= 0.5).length;
  }, 0);

  useEffect(() => { setOpen(startOpen); }, [startOpen]);

  return (
    <div className="gv-zone">
      <button
        className={`gv-zone-header${hasPanic ? ' gv-zone-header-panic' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '15px', fontWeight: '700', color: 'var(--cd-text)',
              fontFamily: 'var(--cd-font-display)', letterSpacing: '-0.01em',
            }}>
              {siteName}
            </span>
            <span style={{
              fontSize: '11px', fontWeight: '600', padding: '2px 9px', borderRadius: '999px',
              background: hasPanic ? 'rgba(239,68,68,0.12)' : 'rgba(128,128,128,0.1)',
              color: hasPanic ? '#ef4444' : 'var(--cd-text-muted)',
              border: hasPanic ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(128,128,128,0.12)',
            }}>
              {vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''}
            </span>
            {siteDistanceKm > 0 && (
              <span title={`${distanceLabel} — ${siteJourneys} journeys`} style={{
                fontSize: '11px', fontWeight: '700', padding: '2px 9px', borderRadius: '999px',
                background: 'rgba(13,148,136,0.1)', color: '#0d9488',
                border: '1px solid rgba(13,148,136,0.2)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {siteDistanceKm.toLocaleString(undefined, { maximumFractionDigits: 0 })} km
              </span>
            )}
            {hasPanic && (
              <span style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                fontSize: '11px', fontWeight: '700', padding: '2px 9px', borderRadius: '999px',
                background: 'rgba(239,68,68,0.12)', color: '#ef4444',
                border: '1px solid rgba(239,68,68,0.3)',
              }}>
                <AlertOctagon size={10} />
                {vehicles.filter(v => v.panic).length} panic
              </span>
            )}
          </div>
          <StatusChips vehicles={vehicles} />
        </div>
        <div style={{ flexShrink: 0, color: 'var(--cd-text-muted)', marginLeft: '8px' }}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {open && (
        <div className="gv-grid">
          {vehicles.map(v => {
            const summary = assetDistanceMap.get(v.id);
            return (
              <VehicleCard
                key={v.id}
                vehicle={v}
                distance={summary}
                onDistanceClick={summary ? () => onVehicleClick(v, summary) : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function GroupedView({ statusFilter, authFetch, distanceSummary, distanceLabel = 'Selected range', siteFilter }: Props) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [isStale, setIsStale] = useState(false);
  const [search, setSearch] = useState('');
  const [allOpen, setAllOpen] = useState(true);
  const [selectedModal, setSelectedModal] = useState<{ vehicle: Vehicle; summary: AssetSummary } | null>(null);
  const warningTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastSuccess = useRef<number>(Date.now());

  const scheduleWarningClear = (id: string) => {
    if (warningTimers.current.has(id)) clearTimeout(warningTimers.current.get(id)!);
    const t = setTimeout(() => {
      setVehicles(prev => prev.map(v => v.id === id ? { ...v, warnings: [] } : v));
      warningTimers.current.delete(id);
    }, WARNING_CLEAR_MS);
    warningTimers.current.set(id, t);
  };

  const fetchData = async () => {
    try {
      const res = await authFetch('/api/data');
      if (!res.ok) return;
      const fresh: Vehicle[] = await res.json();
      lastSuccess.current = Date.now();
      setIsStale(false);
      setVehicles(prev => {
        const prevMap = new Map(prev.map(v => [v.id, v]));
        return fresh.map(v => {
          const old = prevMap.get(v.id);
          let mergedWarnings: Warning[] = [];
          if (v.warnings?.length) {
            v.warnings.forEach(w => {
              if (!old?.warnings?.some(ow => ow.eventId === w.eventId)) scheduleWarningClear(v.id);
            });
            mergedWarnings = v.warnings;
          } else if (old?.warnings?.length) {
            mergedWarnings = old.warnings;
          }
          return { ...v, warnings: mergedWarnings };
        });
      });
      setLoading(false);
    } catch { /* silent */ }
  };

  useEffect(() => {
    fetchData();
    const iv = setInterval(() => {
      fetchData();
      if (Date.now() - lastSuccess.current > STALE_MS) setIsStale(true);
    }, 10_000);
    return () => clearInterval(iv);
  }, []);

  const assetDistanceMap = useMemo(() => {
    const map = new Map<string, AssetSummary>();
    distanceSummary?.assets?.forEach(a => {
      if (a.assetId) map.set(a.assetId, a as AssetSummary);
    });
    return map;
  }, [distanceSummary]);

  const groups = useMemo(() => {
    const q = search.toLowerCase().trim();

    const filtered = vehicles.filter(v => {
      if (statusFilter !== 'All' && v.status !== statusFilter) return false;
      if (siteFilter && !siteFilter.includes(v.site)) return false;
      if (!q) return true;
      return (
        v.regNo.toLowerCase().includes(q) ||
        v.assetName.toLowerCase().includes(q) ||
        v.site?.toLowerCase().includes(q)
      );
    });

    const map = new Map<string, Vehicle[]>();
    filtered.forEach(v => {
      const key = v.site || 'Unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(v);
    });

    // Sort vehicles within each group: panic → warnings → status priority
    map.forEach((vs, k) => map.set(k, [...vs].sort((a, b) => {
      if (a.panic !== b.panic) return a.panic ? -1 : 1;
      const aw = a.warnings?.length ?? 0, bw = b.warnings?.length ?? 0;
      if (aw !== bw) return bw - aw;
      return STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status];
    })));

    // Sort groups: panic first → warnings → moving count → size
    return [...map.entries()].sort(([, a], [, b]) => {
      const ap = a.filter(v => v.panic).length, bp = b.filter(v => v.panic).length;
      if (ap !== bp) return bp - ap;
      const aw = a.filter(v => v.warnings?.length).length, bw = b.filter(v => v.warnings?.length).length;
      if (aw !== bw) return bw - aw;
      const am = a.filter(v => v.status === 'Moving').length, bm = b.filter(v => v.status === 'Moving').length;
      if (am !== bm) return bm - am;
      return b.length - a.length;
    });
  }, [vehicles, statusFilter, search, siteFilter]);

  const totalShown = groups.reduce((n, [, vs]) => n + vs.length, 0);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: 'var(--cd-text-muted)', fontSize: '14px' }}>
        Loading fleet data…
      </div>
    );
  }

  return (
    <div className="gv-scene">
      <div className="gv-wrap">

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>

          {/* Search */}
          <div style={{ position: 'relative', flex: '1', minWidth: '180px', maxWidth: '300px' }}>
            <Search size={13} style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: 'var(--cd-text-muted)', pointerEvents: 'none' }} />
            <input
              className="gv-search-input"
              type="text"
              placeholder="Search reg, name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>


          {/* Right side */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
            {isStale && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: '#d97706', fontWeight: '500' }}>
                <WifiOff size={12} /> Paused
              </span>
            )}
            <span style={{ fontSize: '12px', color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>
              {groups.length} groups · {totalShown} vehicles
            </span>
            <button className="gv-btn-ghost" onClick={() => setAllOpen(o => !o)}>
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
        </div>

        {/* Groups */}
        {groups.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '60px 20px', color: 'var(--cd-text-muted)', gap: '12px',
          }}>
            <WifiOff size={28} style={{ opacity: 0.35 }} />
            <span style={{ fontSize: '14px' }}>No vehicles match the current filter</span>
          </div>
        ) : (
          <div className="gv-zones-grid">
            {groups.map(([siteName, vs]) => (
              <ZoneSection key={siteName} siteName={siteName} vehicles={vs} startOpen={allOpen} assetDistanceMap={assetDistanceMap} distanceLabel={distanceLabel} onVehicleClick={(v, s) => setSelectedModal({ vehicle: v, summary: s })} />
            ))}
          </div>
        )}

      </div>

      {selectedModal && (
        <TripModal
          vehicleName={selectedModal.vehicle.assetName}
          regNo={selectedModal.vehicle.regNo}
          assetSummary={selectedModal.summary}
          distanceLabel={distanceLabel}
          onClose={() => setSelectedModal(null)}
        />
      )}
    </div>
  );
}
