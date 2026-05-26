import { useEffect, useMemo, useRef, useState } from 'react';
import { SignedIn, SignedOut, SignIn, useClerk } from '@clerk/clerk-react';
import { Moon, Sun, Power, RotateCcw, ScrollText, Download, Map, Table, ShieldAlert, Truck, Navigation, MapPin, LayoutGrid, Gauge, ChevronDown, Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import AnomaliesTable from './components/AnomaliesTable';
import MapView from './components/MapView';
import GroupedView from './components/GroupedView';
import EventLogPanel from './components/EventLogPanel';
import DownloadModal from './components/DownloadModal';
import DriverRiskPanel from './components/DriverRiskPanel';

type StatusFilter = 'All' | 'Moving' | 'Idle' | 'Excessive Idle' | 'Stationary' | 'Parked' | 'Offline' | 'Inactive';

interface Metadata {
  totalVehicles: number;
  moving: number;
  idle: number;
  excessiveIdle: number;
  stationary: number;
  parked: number;
  inactive: number;
  offline: number;
  lastUpdate: string;
}

type DistanceRange = '24h' | 'currentMonth' | 'lastMonth' | 'month';

interface DriverDistanceSummary {
  generatedAt: string;
  range: DistanceRange;
  month: string | null;
  start: string;
  end: string;
  totalDistanceKm: number;
  rawTripCount: number;
  journeyCount: number;
  driverCount: number;
  assetCount: number;
  cachedTripCount: number;
  drivers: any[];
  assets: any[];
}

const statConfig: {
  key: keyof Omit<Metadata, 'lastUpdate'>;
  label: string;
  filter: StatusFilter | 'All';
  color: string;
  bg: string;
  border: string;
  tooltip: string;
  tier: 1 | 2;
  icon?: LucideIcon;
}[] = [
  { key: 'totalVehicles', label: 'Total Fleet',    filter: 'All',            color: '#F05022', bg: '#FEF0EB', border: '#FDC8B0', tooltip: 'Total number of vehicles in the fleet',               tier: 1, icon: Truck },
  { key: 'moving',        label: 'Moving',          filter: 'Moving',         color: '#16a34a', bg: '#dcfce7', border: '#86efac', tooltip: 'Vehicle is actively travelling above 5 km/h',          tier: 1, icon: Navigation },
  { key: 'parked',        label: 'Parked',          filter: 'Parked',         color: '#7C3AED', bg: '#f5f3ff', border: '#c4b5fd', tooltip: 'Vehicle has been stationary for between 1 and 24 hours', tier: 1, icon: MapPin },
  { key: 'idle',          label: 'Idle',            filter: 'Idle',           color: '#A07830', bg: '#FAF5E8', border: '#E2CFA0', tooltip: 'Vehicle is idling',                                    tier: 2 },
  { key: 'excessiveIdle', label: 'Excess Idle',     filter: 'Excessive Idle', color: '#B06230', bg: '#F7EDDF', border: '#D9A876', tooltip: 'Vehicle has been idling excessively',                  tier: 2 },
  { key: 'stationary',    label: 'Stationary',      filter: 'Stationary',     color: '#4D7FA0', bg: '#EEF4F8', border: '#A4C0D8', tooltip: 'Vehicle has been stationary for less than 1 hour',    tier: 2 },
  { key: 'offline',       label: 'Temp. Inactive',  filter: 'Offline',        color: '#6B7A8D', bg: '#EFF2F5', border: '#C0C8D4', tooltip: 'Vehicle has not reported activity in over 24 hours',  tier: 2 },
  { key: 'inactive',      label: 'Inactive',        filter: 'Inactive',       color: '#6878A0', bg: '#EEF0F8', border: '#B4BCD4', tooltip: 'Vehicle has not moved in over 30 days',               tier: 2 },
];

const GEO: Record<string, string[] | null> = {
  'All Sites': null,
  'NBL': ['NBL'],
  'HAULAGE': ['HAULAGE'],
  'Light Fleet JMG': ['Light Fleet JMG'],
  'Hiabs Logistics': ['Hiabs Logistics'],
  'Abuja': ['Abuja'],
  'Port Harcourt': ['PH'],
};

const API_SECRET = import.meta.env.VITE_API_SECRET;

const authFetch = (url: string, options: RequestInit = {}) => {
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'x-api-secret': API_SECRET,
    },
  });
};


function DashboardContent() {
  const { signOut } = useClerk();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [siteFilter, setSiteFilter] = useState<string>('All Sites');
  const [showSiteDropdown, setShowSiteDropdown] = useState(false);
  const siteDropdownRef = useRef<HTMLDivElement>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showLogPanel, setShowLogPanel] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [showDriverRiskPanel, setShowDriverRiskPanel] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'map' | 'grouped'>('table');
  const [isMobile, setIsMobile] = useState(false);
  const [distanceRange, setDistanceRange] = useState<DistanceRange>('currentMonth');
  const [distanceMonth, setDistanceMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [distanceSummary, setDistanceSummary] = useState<DriverDistanceSummary>({
    generatedAt: '',
    range: 'currentMonth',
    month: null,
    start: '',
    end: '',
    totalDistanceKm: 0,
    rawTripCount: 0,
    journeyCount: 0,
    driverCount: 0,
    assetCount: 0,
    cachedTripCount: 0,
    drivers: [],
    assets: [],
  });
  const [metadata, setMetadata] = useState<Metadata>({
    totalVehicles: 0,
    moving: 0,
    idle: 0,
    excessiveIdle: 0,
    stationary: 0,
    parked: 0,
    inactive: 0,
    offline: 0,
    lastUpdate: '',
  });
  const [vehicles, setVehicles] = useState<{ id: string; site: string; status: string }[]>([]);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (siteDropdownRef.current && !siteDropdownRef.current.contains(e.target as Node)) {
        setShowSiteDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem('cd-theme') as 'light' | 'dark' | null;
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const nextTheme = saved ?? (prefersDark ? 'dark' : 'light');
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('cd-theme', theme);
  }, [theme]);

  const loadMetadata = async () => {
    try {
      const res = await authFetch('/api/metadata');
      if (res.ok) {
        const data = await res.json();
        setMetadata(data);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadMetadata();
    const interval = setInterval(loadMetadata, 10_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await authFetch('/api/data');
        if (res.ok) setVehicles(await res.json());
      } catch {}
    };
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, []);

  const loadDistanceSummary = async () => {
    try {
      const params = new URLSearchParams({ range: distanceRange });
      if (distanceRange === 'month') params.set('month', distanceMonth);
      const res = await authFetch(`/api/driver-distance?${params.toString()}`);
      if (res.ok) {
        setDistanceSummary(await res.json());
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadDistanceSummary();
    const interval = setInterval(loadDistanceSummary, 60_000);
    return () => clearInterval(interval);
  }, [distanceRange, distanceMonth]);

  const handleStatClick = (filter: StatusFilter | 'All') => {
    setStatusFilter(filter as StatusFilter);
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await authFetch('/api/reset', { method: 'POST' });
      await loadMetadata();
    } catch {
      // ignore
    } finally {
      setResetting(false);
      setShowResetConfirm(false);
    }
  };

  const handleMapAcknowledge = async (id: string) => {
    try {
      await authFetch('/api/acknowledged', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch {
      // ignore
    }
  };

  const filteredVehicles = useMemo(() => {
    const siteKeys = GEO[siteFilter];
    if (!siteKeys) return null;
    return vehicles.filter(v => siteKeys.includes(v.site));
  }, [vehicles, siteFilter]);

  const displayMetadata = useMemo((): Metadata => {
    if (!filteredVehicles) return metadata;
    const counts = { totalVehicles: filteredVehicles.length, moving: 0, idle: 0, excessiveIdle: 0, stationary: 0, parked: 0, inactive: 0, offline: 0 };
    filteredVehicles.forEach(v => {
      if (v.status === 'Moving') counts.moving++;
      else if (v.status === 'Idle') counts.idle++;
      else if (v.status === 'Excessive Idle') counts.excessiveIdle++;
      else if (v.status === 'Stationary') counts.stationary++;
      else if (v.status === 'Parked') counts.parked++;
      else if (v.status === 'Inactive') counts.inactive++;
      else if (v.status === 'Offline') counts.offline++;
    });
    return { ...counts, lastUpdate: metadata.lastUpdate };
  }, [filteredVehicles, metadata]);

  const displayDistanceSummary = useMemo(() => {
    if (!filteredVehicles) return distanceSummary;
    const siteIds = new Set(filteredVehicles.map(v => v.id));
    const filteredAssets = (distanceSummary.assets ?? []).filter(a => a.assetId && siteIds.has(a.assetId));
    const totalDistanceKm = filteredAssets.reduce((s, a) => s + a.totalDistanceKm, 0);
    const journeyCount = filteredAssets.reduce((s, a) => s + a.journeyCount, 0);
    const driverCount = new Set(filteredAssets.flatMap(a => a.drivers ?? [])).size;
    return { ...distanceSummary, totalDistanceKm, journeyCount, driverCount, assets: filteredAssets };
  }, [filteredVehicles, distanceSummary]);

  const isDark = theme === 'dark';
  const distanceLabel = distanceRange === '24h'
    ? 'Past 24hrs'
    : distanceRange === 'currentMonth'
      ? 'This Month'
      : distanceRange === 'lastMonth'
        ? 'Last Month'
        : distanceMonth;

  return (
    <div className="fleet-page min-h-screen">
      <div className="fleet-shell cd-shell-padding">
        <div className="max-w-7xl mx-auto">

          {/* Logout Confirmation Modal */}
          {showLogoutConfirm && (
            <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div style={{ backgroundColor: 'var(--cd-surface)', borderRadius: '14px', border: '1px solid var(--cd-border)', padding: '32px', maxWidth: '400px', width: '90%', boxShadow: 'var(--cd-card-shadow)' }}>
                <div style={{ fontSize: '20px', fontWeight: '600', color: 'var(--cd-text)', marginBottom: '12px' }}>🔒 Log Out?</div>
                <div style={{ fontSize: '15px', color: 'var(--cd-text-muted)', marginBottom: '28px', lineHeight: '1.6' }}>
                  Are you sure you want to log out of the dashboard?
                </div>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                  <button onClick={() => setShowLogoutConfirm(false)} style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid var(--cd-border)', backgroundColor: 'var(--cd-surface-2)', color: 'var(--cd-text)', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}>Cancel</button>
                  <button onClick={() => signOut()} style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', backgroundColor: '#c8102e', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}>Log Out</button>
                </div>
              </div>
            </div>
          )}

          {/* Reset Confirmation Modal */}
          {showResetConfirm && (
            <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div style={{ backgroundColor: 'var(--cd-surface)', borderRadius: '14px', border: '1px solid var(--cd-border)', padding: '32px', maxWidth: '400px', width: '90%', boxShadow: 'var(--cd-card-shadow)' }}>
                <div style={{ fontSize: '20px', fontWeight: '600', color: 'var(--cd-text)', marginBottom: '12px' }}>⚠️ Reset Dashboard?</div>
                <div style={{ fontSize: '15px', color: 'var(--cd-text-muted)', marginBottom: '28px', lineHeight: '1.6' }}>
                  This will clear all panic alerts and event history.
                </div>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                  <button onClick={() => setShowResetConfirm(false)} style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid var(--cd-border)', backgroundColor: 'var(--cd-surface-2)', color: 'var(--cd-text)', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}>Cancel</button>
                  <button onClick={handleReset} disabled={resetting} style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', backgroundColor: '#d97706', color: '#fff', cursor: resetting ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: '600' }}>{resetting ? 'Resetting...' : 'Reset'}</button>
                </div>
              </div>
            </div>
          )}

          {/* Event Log Panel */}
          <EventLogPanel
            open={showLogPanel}
            onClose={() => setShowLogPanel(false)}
            authFetch={authFetch}
            isMobile={isMobile}
          />

          {/* Download Modal */}
          {showDownloadModal && (
            <DownloadModal
              onClose={() => setShowDownloadModal(false)}
              authFetch={authFetch}
            />
          )}

          {/* Driver Risk Panel */}
          <DriverRiskPanel
            open={showDriverRiskPanel}
            onClose={() => setShowDriverRiskPanel(false)}
            authFetch={authFetch}
            isMobile={isMobile}
          />

          {/* Header */}
          <div className="cd-header" style={{ marginBottom: isMobile ? '28px' : '56px' }}>
            <div className="flex items-start gap-6">
              <div className="flex-shrink-0">
                <img src="/JMG.avif" alt="JMG Logo" className="cd-logo" />
              </div>
              <div>
                <h1 className="cd-title mb-1" style={{ color: 'var(--cd-text)' }}>JMG Fleet Dashboard</h1>
                <p className="cd-subtitle" style={{ color: 'var(--cd-text-muted)' }}>
                  From Power to Plug — real-time fleet visibility.
                </p>
              </div>
            </div>

            <div className="cd-header-buttons flex items-center gap-1">

              {/* View segmented control */}
              <div className="cd-view-seg">
                <button className={`cd-view-seg-btn${viewMode === 'table' ? ' active' : ''}`} onClick={() => setViewMode('table')} aria-label="Table view">
                  <Table size={15} />
                  Table
                </button>
                <button className={`cd-view-seg-btn${viewMode === 'grouped' ? ' active' : ''}`} onClick={() => setViewMode('grouped')} aria-label="Grouped view">
                  <LayoutGrid size={15} />
                  Group
                </button>
                <button className={`cd-view-seg-btn${viewMode === 'map' ? ' active' : ''}`} onClick={() => setViewMode('map')} aria-label="Map view">
                  <Map size={15} />
                  Map
                </button>
              </div>

              {/* Action buttons */}
              <button className="cd-toolbtn" onClick={() => setShowLogPanel(true)} aria-label="Event log">
                <ScrollText size={16} />
                <span className="cd-toolbtn-label">Log</span>
              </button>
              <button className="cd-toolbtn" onClick={() => setShowDownloadModal(true)} aria-label="Download report">
                <Download size={16} />
                <span className="cd-toolbtn-label">Report</span>
              </button>
              <button className="cd-toolbtn" onClick={() => setShowDriverRiskPanel(true)} aria-label="Driver risk">
                <ShieldAlert size={16} />
                <span className="cd-toolbtn-label">Risk</span>
              </button>
              <button className="cd-toolbtn" onClick={() => setShowResetConfirm(true)} aria-label="Reset dashboard">
                <RotateCcw size={16} />
                <span className="cd-toolbtn-label">Reset</span>
              </button>

              {/* Divider */}
              <div style={{ width: '1px', height: '32px', background: 'var(--cd-border)', margin: '0 4px', flexShrink: 0 }} />

              {/* Theme + Sign out */}
              <button className="cd-toolbtn" onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                <span className="cd-toolbtn-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
              </button>
              <div style={{
                background: 'var(--cd-surface)',
                border: '1px solid var(--cd-border)',
                borderRadius: '10px',
                boxShadow: 'var(--cd-card-shadow)',
                padding: '2px',
              }}>
                <button className="cd-toolbtn" onClick={() => setShowLogoutConfirm(true)} aria-label="Log out" style={{ color: '#c8102e' }}>
                  <Power size={16} />
                  <span className="cd-toolbtn-label">Sign out</span>
                </button>
              </div>

            </div>
          </div>

          {/* Fleet Stats — Hero tier */}
          <div className="cd-stats-tier1" style={{ marginTop: isMobile ? '8px' : '0' }}>
            {statConfig.filter(s => s.tier === 1).map(stat => {
              const value = displayMetadata[stat.key] ?? 0;
              const isActive = stat.filter === 'All' ? statusFilter === 'All' : statusFilter === stat.filter;
              const Icon = stat.icon!;
              const isTotalFleet = stat.key === 'totalVehicles';
              const activeSite = siteFilter !== 'All Sites' ? siteFilter : null;

              return isTotalFleet ? (
                <div
                  key={stat.key}
                  className="cd-stat-hero"
                  style={{
                    borderTopWidth: '3px',
                    borderTopColor: stat.color,
                    backgroundColor: isActive ? stat.bg : (isDark ? 'var(--cd-surface)' : '#ffffff'),
                    boxShadow: isActive
                      ? `0 0 0 1.5px ${stat.color}50, var(--cd-card-shadow)`
                      : 'var(--cd-card-shadow)',
                    cursor: 'default',
                  }}
                >
                  {/* Top: site dropdown + icon */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ position: 'relative' }} ref={siteDropdownRef}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowSiteDropdown(o => !o); }}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '5px',
                          padding: '5px 10px 5px 8px', borderRadius: '8px', cursor: 'pointer',
                          border: `1px solid ${activeSite ? '#F05022' : 'var(--cd-border)'}`,
                          background: activeSite ? (isDark ? 'rgba(240,80,34,0.12)' : '#FEF0EB') : 'var(--cd-surface-2)',
                          color: activeSite ? '#F05022' : 'var(--cd-text-muted)',
                          fontSize: '11px', fontWeight: '600', letterSpacing: '0.02em',
                          whiteSpace: 'nowrap' as const,
                          transition: 'all 0.15s',
                        }}
                      >
                        <MapPin size={10} style={{ flexShrink: 0 }} />
                        <span style={{ maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {siteFilter}
                        </span>
                        <ChevronDown
                          size={10}
                          style={{
                            flexShrink: 0,
                            transform: showSiteDropdown ? 'rotate(180deg)' : 'none',
                            transition: 'transform 0.15s',
                          }}
                        />
                      </button>
                      {showSiteDropdown && (
                        <div
                          style={{
                            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 300,
                            background: 'var(--cd-surface)',
                            border: '1px solid var(--cd-border)',
                            borderRadius: '10px',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)',
                            minWidth: '170px', overflow: 'hidden',
                          }}
                        >
                          <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--cd-border)' }}>
                            <span style={{ fontSize: '9px', fontWeight: '700', textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: 'var(--cd-text-muted)' }}>
                              Filter by Site
                            </span>
                          </div>
                          {Object.keys(GEO).map(site => {
                            const isSelected = siteFilter === site;
                            return (
                              <button
                                key={site}
                                onClick={() => { setSiteFilter(site); setShowSiteDropdown(false); }}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: '8px',
                                  width: '100%', padding: '9px 12px', border: 'none',
                                  background: isSelected ? (isDark ? 'rgba(240,80,34,0.14)' : '#FEF0EB') : 'transparent',
                                  color: isSelected ? '#F05022' : 'var(--cd-text)',
                                  fontSize: '12px', fontWeight: isSelected ? '700' : '500',
                                  cursor: 'pointer', textAlign: 'left' as const,
                                  transition: 'background 0.1s',
                                }}
                              >
                                <span style={{
                                  width: '14px', height: '14px', borderRadius: '50%', flexShrink: 0,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  background: isSelected ? '#F05022' : 'transparent',
                                  border: `1.5px solid ${isSelected ? '#F05022' : 'var(--cd-border)'}`,
                                }}>
                                  {isSelected && <Check size={8} color="#fff" strokeWidth={3} />}
                                </span>
                                {site}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <Icon size={18} style={{ color: stat.color, opacity: 0.55, flexShrink: 0 }} />
                  </div>
                  {/* Number */}
                  <div
                    onClick={() => handleStatClick(stat.filter)}
                    title={stat.tooltip}
                    style={{ marginTop: '16px', fontSize: isMobile ? '36px' : '52px', fontWeight: '700', color: stat.color, lineHeight: 1, letterSpacing: '-0.02em', cursor: 'pointer' }}
                  >
                    {value}
                  </div>
                  {/* Grey label pinned to bottom */}
                  <div style={{ marginTop: 'auto', paddingTop: '8px', paddingLeft: '4px', fontSize: '11px', color: 'var(--cd-text-soft)' }}>
                    {stat.label}
                  </div>
                </div>
              ) : (
                <button
                  key={stat.key}
                  onClick={() => handleStatClick(stat.filter)}
                  title={stat.tooltip}
                  className="cd-stat-hero"
                  style={{
                    borderTopWidth: '3px',
                    borderTopColor: stat.color,
                    backgroundColor: isActive ? stat.bg : (isDark ? 'var(--cd-surface)' : '#ffffff'),
                    boxShadow: isActive
                      ? `0 0 0 1.5px ${stat.color}50, var(--cd-card-shadow)`
                      : 'var(--cd-card-shadow)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' as const, letterSpacing: '0.09em', color: 'var(--cd-text-muted)' }}>
                      {stat.label}
                    </span>
                    <Icon size={18} style={{ color: stat.color, opacity: 0.55, flexShrink: 0 }} />
                  </div>
                  <div style={{ marginTop: '16px', fontSize: isMobile ? '36px' : '52px', fontWeight: '700', color: stat.color, lineHeight: 1, letterSpacing: '-0.02em' }}>
                    {value}
                  </div>
                  <div style={{ marginTop: 'auto', paddingTop: '8px', paddingLeft: '4px', fontSize: '11px', color: 'var(--cd-text-soft)' }}>
                    {displayMetadata.totalVehicles > 0
                      ? `${Math.round((value / displayMetadata.totalVehicles) * 100)}% of fleet`
                      : '—'}
                  </div>
                </button>
              );
            })}
            <div
              className="cd-stat-hero"
              title="Total distance covered by completed trips in the selected period"
              style={{
                borderTopWidth: '3px',
                borderTopColor: '#0d9488',
                backgroundColor: isDark ? 'var(--cd-surface)' : '#ffffff',
                boxShadow: 'var(--cd-card-shadow)',
                cursor: 'default',
              }}
            >
              {/* Header: label + range selector + icon */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' as const, letterSpacing: '0.09em', color: 'var(--cd-text-muted)' }}>
                    Distance Covered
                  </span>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                      value={distanceRange}
                      onChange={(e) => setDistanceRange(e.target.value as DistanceRange)}
                      style={{ padding: '4px 6px', borderRadius: '7px', border: '1px solid var(--cd-border)', background: 'var(--cd-surface-2)', color: 'var(--cd-text)', fontSize: '11px', outline: 'none', cursor: 'pointer' }}
                    >
                      <option value="24h">Past 24hrs</option>
                      <option value="currentMonth">This month</option>
                      <option value="lastMonth">Last month</option>
                      <option value="month">Choose month</option>
                    </select>
                    {distanceRange === 'month' && (
                      <input
                        type="month"
                        value={distanceMonth}
                        onChange={(e) => setDistanceMonth(e.target.value)}
                        style={{ padding: '4px 6px', borderRadius: '7px', border: '1px solid var(--cd-border)', background: 'var(--cd-surface-2)', color: 'var(--cd-text)', fontSize: '11px', outline: 'none' }}
                      />
                    )}
                  </div>
                </div>
                <Gauge size={18} style={{ color: '#0d9488', opacity: 0.65, flexShrink: 0 }} />
              </div>
              {/* Number */}
              <div style={{ marginTop: '16px', fontSize: isMobile ? '32px' : '46px', fontWeight: '700', color: '#0d9488', lineHeight: 1, letterSpacing: '-0.02em' }}>
                {displayDistanceSummary.totalDistanceKm.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                <span style={{ fontSize: isMobile ? '14px' : '18px', marginLeft: '6px', color: 'var(--cd-text-muted)' }}>km</span>
              </div>
              {/* Grey footer */}
              <div style={{ marginTop: 'auto', paddingTop: '8px', paddingLeft: '4px', fontSize: '11px', color: 'var(--cd-text-soft)' }}>
                {distanceLabel} · {displayDistanceSummary.journeyCount} journeys · {displayDistanceSummary.driverCount} drivers
              </div>
            </div>
          </div>

          {/* Fleet Stats — Status chips */}
          <div className="cd-stats-tier2" style={{ marginBottom: isMobile ? '20px' : '40px' }}>
            {statConfig.filter(s => s.tier === 2).map(stat => {
              const value = displayMetadata[stat.key] ?? 0;
              const isActive = stat.filter === 'All' ? statusFilter === 'All' : statusFilter === stat.filter;
              return (
                <button
                  key={stat.key}
                  onClick={() => handleStatClick(stat.filter)}
                  title={stat.tooltip}
                  className="cd-stat-chip"
                  style={{
                    borderLeftWidth: '3px',
                    borderLeftColor: stat.color,
                    backgroundColor: isActive ? (isDark ? 'var(--cd-surface-2)' : stat.bg) : (isDark ? 'var(--cd-surface)' : '#ffffff'),
                    boxShadow: isActive ? `0 0 0 1.5px ${stat.color}40` : undefined,
                  }}
                >
                  <div style={{ fontSize: isMobile ? '20px' : '26px', fontWeight: '700', color: stat.color, lineHeight: 1 }}>
                    {value}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--cd-text-muted)', marginTop: '5px', fontWeight: '600', textTransform: 'uppercase' as const, letterSpacing: '0.06em', whiteSpace: 'nowrap' as const }}>
                    {stat.label}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Main View */}
          {viewMode === 'table' && (
            <AnomaliesTable statusFilter={statusFilter} onFilterChange={setStatusFilter} authFetch={authFetch} distanceSummary={distanceSummary} distanceLabel={distanceLabel} siteFilter={GEO[siteFilter]} />
          )}
          {viewMode === 'grouped' && (
            <GroupedView statusFilter={statusFilter} authFetch={authFetch} distanceSummary={distanceSummary} distanceLabel={distanceLabel} siteFilter={GEO[siteFilter]} />
          )}
          {viewMode === 'map' && (
            <MapView authFetch={authFetch} statusFilter={statusFilter} onAcknowledge={handleMapAcknowledge} siteFilter={GEO[siteFilter]} />
          )}

        </div>
      </div>

    </div>
  );
}

export default function App() {
  return (
    <>
      <SignedOut>
        <div className="signin-bg">
          <div className="glow-orb glow-orb-1" />
          <div className="glow-orb glow-orb-2" />
          <div className="glow-orb glow-orb-3" />
          <svg style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', zIndex: 3, pointerEvents: 'none', opacity: 0.20 }} aria-hidden="true">
            <filter id="signin-noise">
              <feTurbulence type="fractalNoise" baseFrequency="0.78" numOctaves="4" stitchTiles="stitch" />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <rect width="100%" height="100%" filter="url(#signin-noise)" />
          </svg>
          <div className="signin-card-wrap">
            <SignIn
              appearance={{
                layout: {
                  logoImageUrl: '/JMG.avif',
                  logoLinkUrl: '/',
                },
                variables: {
                  colorPrimary: '#F05022',
                  colorBackground: '#ffffff',
                  colorText: '#1a1a1a',
                  borderRadius: '14px',
                  fontFamily: 'inherit',
                },
                elements: {
                  card: {
                    boxShadow: '0 8px 48px rgba(240,80,34,0.12), 0 2px 16px rgba(0,0,0,0.06)',
                    border: '1px solid rgba(240,80,34,0.08)',
                  },
                  logoBox: { height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
                  logoImage: { width: '140px', height: '100px', objectFit: 'contain', borderRadius: '10px' },
                  formButtonPrimary: { backgroundColor: '#F05022', borderRadius: '8px', fontWeight: '600' },
                  footerAction: { display: 'none' },
                },
              }}
            />
          </div>
        </div>
      </SignedOut>
      <SignedIn>
        <DashboardContent />
      </SignedIn>
    </>
  );
}
