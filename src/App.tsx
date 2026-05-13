import { useEffect, useState } from 'react';
import { SignedIn, SignedOut, SignIn, useClerk } from '@clerk/clerk-react';
import { Moon, Sun, Power, RotateCcw, ScrollText, Download, Map, Table, ShieldAlert, Truck, Navigation, MapPin, LayoutGrid } from 'lucide-react';
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
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showLogPanel, setShowLogPanel] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [showDriverRiskPanel, setShowDriverRiskPanel] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'map' | 'grouped'>('table');
  const [isMobile, setIsMobile] = useState(false);
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
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
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

  const isDark = theme === 'dark';

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

            <div className="cd-header-buttons flex items-center gap-3">
              <button className="cd-iconbtn p-2 rounded-lg transition-colors" onClick={() => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))} aria-label="Toggle dark mode">
                {theme === 'dark' ? <Sun className="w-5 h-5 text-gray-600" /> : <Moon className="w-5 h-5 text-gray-600" />}
              </button>
              <button
                className="cd-iconbtn p-2 rounded-lg transition-colors"
                onClick={() => setViewMode(prev => prev === 'table' ? 'grouped' : prev === 'grouped' ? 'map' : 'table')}
                aria-label="Toggle view"
                title={viewMode === 'table' ? 'Switch to Grouped View' : viewMode === 'grouped' ? 'Switch to Map View' : 'Switch to Table View'}
              >
                {viewMode === 'table' && <LayoutGrid className="w-5 h-5 text-gray-600" />}
                {viewMode === 'grouped' && <Map className="w-5 h-5 text-gray-600" />}
                {viewMode === 'map' && <Table className="w-5 h-5 text-gray-600" />}
              </button>
              <button className="cd-iconbtn p-2 rounded-lg transition-colors" onClick={() => setShowLogPanel(true)} aria-label="Event log" title="Event Log">
                <ScrollText className="w-5 h-5 text-gray-600" />
              </button>
              <button className="cd-iconbtn p-2 rounded-lg transition-colors" onClick={() => setShowDownloadModal(true)} aria-label="Download report" title="Download Report">
                <Download className="w-5 h-5 text-gray-600" />
              </button>
              <button className="cd-iconbtn p-2 rounded-lg transition-colors" onClick={() => setShowDriverRiskPanel(true)} aria-label="Driver risk" title="Driver Risk">
                <ShieldAlert className="w-5 h-5 text-gray-600" />
              </button>
              <button className="cd-iconbtn p-2 rounded-lg transition-colors" onClick={() => setShowResetConfirm(true)} aria-label="Reset dashboard" title="Reset Dashboard">
                <RotateCcw className="w-5 h-5 text-gray-600" />
              </button>
              <button className="cd-iconbtn p-2 rounded-lg transition-colors" onClick={() => setShowLogoutConfirm(true)} aria-label="Log out">
                <Power className="w-5 h-5 text-gray-600" />
              </button>
            </div>
          </div>

          {/* Fleet Stats — Hero tier */}
          <div className="cd-stats-tier1" style={{ marginTop: isMobile ? '8px' : '0' }}>
            {statConfig.filter(s => s.tier === 1).map(stat => {
              const value = metadata[stat.key] ?? 0;
              const isActive = stat.filter === 'All' ? statusFilter === 'All' : statusFilter === stat.filter;
              const Icon = stat.icon!;
              return (
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px' }}>
                    <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' as const, letterSpacing: '0.09em', color: 'var(--cd-text-muted)' }}>
                      {stat.label}
                    </span>
                    <Icon size={18} style={{ color: stat.color, opacity: 0.55, flexShrink: 0 }} />
                  </div>
                  <div style={{ fontSize: isMobile ? '36px' : '52px', fontWeight: '700', color: stat.color, lineHeight: 1, letterSpacing: '-0.02em' }}>
                    {value}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Fleet Stats — Status chips */}
          <div className="cd-stats-tier2" style={{ marginBottom: isMobile ? '20px' : '40px' }}>
            {statConfig.filter(s => s.tier === 2).map(stat => {
              const value = metadata[stat.key] ?? 0;
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
            <AnomaliesTable statusFilter={statusFilter} onFilterChange={setStatusFilter} authFetch={authFetch} />
          )}
          {viewMode === 'grouped' && (
            <GroupedView statusFilter={statusFilter} authFetch={authFetch} />
          )}
          {viewMode === 'map' && (
            <MapView authFetch={authFetch} statusFilter={statusFilter} onAcknowledge={handleMapAcknowledge} />
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