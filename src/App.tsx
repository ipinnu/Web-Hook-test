import { SignedIn, SignedOut, SignIn, useClerk } from "@clerk/clerk-react";
import { useEffect, useState, useRef } from 'react';
import { Moon, Sun, Power, RotateCcw, ScrollText, Download, Map, Table, Volume2, ShieldAlert } from 'lucide-react';
import AnomaliesTable from './components/AnomaliesTable';
import MapView from './components/MapView';
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
  panic: number;
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
}[] = [
  { key: 'totalVehicles', label: 'Total',          filter: 'All',            color: '#7c3aed', bg: '#f5f3ff', border: '#c4b5fd', tooltip: 'Total number of vehicles in the fleet' },
  { key: 'moving',        label: 'Moving',          filter: 'Moving',         color: '#16a34a', bg: '#dcfce7', border: '#86efac', tooltip: 'Vehicle is actively travelling above 5 km/h' },
  { key: 'idle',          label: 'Idle',            filter: 'Idle',           color: '#d97706', bg: '#fef3c7', border: '#fde68a', tooltip: 'Vehicle is idling' },
  { key: 'excessiveIdle', label: 'Excessive Idle',       filter: 'Excessive Idle', color: '#b45309', bg: '#fef9c3', border: '#fcd34d', tooltip: 'Vehicle has been idling excessively' },
  { key: 'stationary',    label: 'Stationary',      filter: 'Stationary',     color: '#0d9488', bg: '#f0fdfa', border: '#99f6e4', tooltip: 'Vehicle has been stationary for less than 1 hour' },
  { key: 'parked',        label: 'Parked',          filter: 'Parked',         color: '#ea580c', bg: '#fff7ed', border: '#fed7aa', tooltip: 'Vehicle has been stationary for between 1 and 24 hours' },
  { key: 'offline',       label: 'Offline',         filter: 'Offline',        color: '#64748b', bg: '#f1f5f9', border: '#e2e8f0', tooltip: 'Vehicle has not moved in over 24 hours' },
  { key: 'inactive',      label: 'Inactive',        filter: 'Inactive',       color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', tooltip: 'Vehicle has not moved in over 30 days' },
  { key: 'panic',         label: 'Panic',           filter: 'All',            color: '#c8102e', bg: '#fff1f2', border: '#fecdd3', tooltip: 'Vehicle has an active panic alert' },
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

// ── Audio helpers ─────────────────────────────────────────────────────────────
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return audioCtx;
}

function playTing(frequency = 880, duration = 0.15, volume = 0.4) {
  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
    gainNode.gain.setValueAtTime(volume, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
  } catch {
    // ignore — audio context may not be available
  }
}

// Different tings for different event types
function playWarningTing() { playTing(880, 0.15, 0.35); }   // high — warning event
function playExcessiveIdleTing() { playTing(440, 0.2, 0.3); } // low — excessive idle

function DashboardContent() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showLogPanel, setShowLogPanel] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [showDriverRiskPanel, setShowDriverRiskPanel] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'map'>('table');
  const [isMobile, setIsMobile] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [panicVehicles, setPanicVehicles] = useState<any[]>([]);
  const repeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const panicVehiclesRef = useRef<any[]>([]);
  const prevWarningsRef = useRef<number>(0);
  const prevExcessiveIdleRef = useRef<number>(0);

  const [metadata, setMetadata] = useState<Metadata>({
    totalVehicles: 0,
    moving: 0,
    idle: 0,
    excessiveIdle: 0,
    stationary: 0,
    parked: 0,
    inactive: 0,
    offline: 0,
    panic: 0,
    lastUpdate: '',
  });
  const { signOut } = useClerk();

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

  const speakPanicAlert = (vehicle: any) => {
    if (!audioEnabled || !('speechSynthesis' in window)) return;
    setIsSpeaking(true);
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      `Emergency! Vehicle ${vehicle.assetName} requires your immediate attention.`
    );
    utterance.rate = 1.2;
    utterance.pitch = 1.3;
    utterance.volume = 1.0;
    utterance.lang = 'en-US';
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const toggleAudio = () => {
    setAudioEnabled(prev => {
      if (prev) {
        window.speechSynthesis.cancel();
        if (repeatIntervalRef.current) {
          clearInterval(repeatIntervalRef.current);
          repeatIntervalRef.current = null;
        }
      }
      return !prev;
    });
  };

  const loadMetadata = async () => {
    try {
      const res = await authFetch('/api/metadata');
      if (res.ok) {
        const data = await res.json();

        // Play tings when new events come in
        if (audioEnabled) {
          const newWarnings = data.warnings ?? 0;
          const newExcessiveIdle = data.excessiveIdle ?? 0;

          if (newWarnings > prevWarningsRef.current) {
            playWarningTing();
          }
          if (newExcessiveIdle > prevExcessiveIdleRef.current) {
            playExcessiveIdleTing();
          }

          prevWarningsRef.current = newWarnings;
          prevExcessiveIdleRef.current = newExcessiveIdle;
        }

        setMetadata(data);
      }
    } catch {
      // ignore
    }
    try {
      const res = await authFetch('/api/data');
      if (res.ok) {
        const data = await res.json();
        const panics = data.filter((v: any) => v.panic);
        setPanicVehicles(panics);
        panicVehiclesRef.current = panics;
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
    if (panicVehicles.length > 0 && audioEnabled) {
      if (!repeatIntervalRef.current) {
        speakPanicAlert(panicVehicles[0]);
        repeatIntervalRef.current = setInterval(() => {
          const current = panicVehiclesRef.current;
          if (current.length > 0) speakPanicAlert(current[0]);
        }, 10000);
      }
    } else {
      if (repeatIntervalRef.current) {
        clearInterval(repeatIntervalRef.current);
        repeatIntervalRef.current = null;
      }
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  }, [panicVehicles, audioEnabled]);

  useEffect(() => {
    return () => {
      if (repeatIntervalRef.current) clearInterval(repeatIntervalRef.current);
      window.speechSynthesis.cancel();
    };
  }, []);

  const handleStatClick = (filter: StatusFilter | 'All', key: string) => {
    if (key === 'panic') return;
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
  const cardBg = isDark ? 'var(--cd-surface)' : '#ffffff';
  const cardBorder = isDark ? 'var(--cd-border)' : '#e2e8f0';

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
          <div className="cd-header mb-8">
            <div className="flex items-center gap-4">
              <div className="h-6 w-6 flex-shrink-0 flex items-center justify-center">
                <img src="/cnl-logo.png" alt="CNL Logo" className="cd-logo" />
              </div>
              <div>
                <h1 className="cd-title text-gray-900 mb-1" style={{ color: 'var(--cd-text)' }}>CNL Tracking Dashboard</h1>
                <p className="cd-subtitle text-gray-600" style={{ color: 'var(--cd-text-muted)' }}>
                  Track and manage your team, fleet and operations.
                </p>
              </div>
            </div>

            <div className="cd-header-buttons flex items-center gap-3">
              <button className="cd-iconbtn p-2 rounded-lg transition-colors" onClick={() => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))} aria-label="Toggle dark mode">
                {theme === 'dark' ? <Sun className="w-5 h-5 text-gray-600" /> : <Moon className="w-5 h-5 text-gray-600" />}
              </button>
              <button className="cd-iconbtn p-2 rounded-lg transition-colors" onClick={() => setViewMode(prev => prev === 'table' ? 'map' : 'table')} aria-label="Toggle map view" title={viewMode === 'table' ? 'Switch to Map View' : 'Switch to Table View'}>
                {viewMode === 'table' ? <Map className="w-5 h-5 text-gray-600" /> : <Table className="w-5 h-5 text-gray-600" />}
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

          {/* Fleet Stats Card */}
          <div className="cd-stats-wrapper" style={{
            background: cardBg,
            borderRadius: '14px',
            border: `1px solid ${cardBorder}`,
            boxShadow: 'var(--cd-card-shadow)',
            marginBottom: isMobile ? '12px' : '24px',
            marginTop: isMobile ? '8px' : '0px',
          }}>
            <div className="cd-stats-scroll">
              {statConfig.map(stat => {
                const value = metadata[stat.key] ?? 0;
                const isActive = stat.key === 'panic'
                  ? false
                  : (stat.filter === 'All' ? statusFilter === 'All' : statusFilter === stat.filter);
                const isPanic = stat.key === 'panic';
                return (
                  <button
                    key={stat.key}
                    onClick={() => handleStatClick(stat.filter, stat.key)}
                    title={stat.tooltip}
                    className="cd-stat-btn"
                    style={{
                      border: `1px solid ${isActive ? stat.color : (isDark ? 'var(--cd-border)' : stat.border)}`,
                      backgroundColor: isActive ? (isDark ? 'var(--cd-surface-2)' : stat.bg) : (isDark ? 'var(--cd-surface-2)' : '#fff'),
                      cursor: isPanic ? 'default' : 'pointer',
                      boxShadow: isActive ? `0 0 0 2px ${stat.color}33` : 'none',
                    }}
                  >
                    <div style={{ fontSize: '28px', fontWeight: '700', color: stat.color, lineHeight: 1, animation: isPanic && value > 0 ? 'pulse 1.5s infinite' : 'none' }}>
                      {value}
                    </div>
                    <div style={{ fontSize: '11px', color: isDark ? 'var(--cd-text-muted)' : '#64748b', marginTop: '6px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {stat.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Panic Banner */}
          {panicVehicles.length > 0 && (
            <div style={{ backgroundColor: 'var(--cd-danger-bg)', border: '1px solid var(--cd-danger-border)', borderRadius: '8px', padding: isMobile ? '12px' : '16px 20px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 10px 24px rgba(200, 16, 46, 0.2)', animation: 'flash 1s infinite', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--cd-danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: '600', color: 'var(--cd-danger)', fontSize: isMobile ? '14px' : '16px' }}>
                    🚨 {panicVehicles.length} Active Alert{panicVehicles.length > 1 ? 's' : ''}
                  </div>
                  {!isMobile && (
                    <div style={{ fontSize: '14px', color: 'var(--cd-danger-soft)' }}>
                      {viewMode === 'table' ? 'Priority vehicles appear at the top' : 'Click the red flag on the map to acknowledge'} • {isSpeaking ? '🔊 Speaking Now' : 'Ready'}
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={toggleAudio}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: isMobile ? '6px 10px' : '8px 16px', backgroundColor: audioEnabled ? 'var(--cd-danger)' : 'var(--cd-surface-2)', color: audioEnabled ? '#fff' : 'var(--cd-text-muted)', borderRadius: '6px', border: '1px solid var(--cd-danger-border)', cursor: 'pointer', fontSize: isMobile ? '12px' : '14px', fontWeight: '500', flexShrink: 0 }}
              >
                <Volume2 style={{ width: '16px', height: '16px' }} />
                {isMobile ? (audioEnabled ? 'Mute' : 'Unmute') : (audioEnabled ? 'Mute Alerts' : 'Enable Voice')}
              </button>
            </div>
          )}

          {/* Main View */}
          {viewMode === 'table' ? (
            <AnomaliesTable statusFilter={statusFilter} onFilterChange={setStatusFilter} authFetch={authFetch} />
          ) : (
            <MapView authFetch={authFetch} statusFilter={statusFilter} onAcknowledge={handleMapAcknowledge} />
          )}

        </div>
      </div>

      <style>{`
        @keyframes flash {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
}

export default function App() {
  return (
    <>
      <SignedOut>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
          <SignIn routing="hash" />
        </div>
      </SignedOut>
      <SignedIn>
        <DashboardContent />
      </SignedIn>
    </>
  );
}