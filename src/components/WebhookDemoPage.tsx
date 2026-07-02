import { useClerk } from '@clerk/clerk-react';
import { AlertTriangle, CheckCircle, Copy, Database, FileJson, Moon, Power, RefreshCw, Send, Sun } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { webhookDemoContent } from '../config/webhook-demo-content';
import { bundledWebhookSamples, type WebhookSampleKey } from '../config/webhook-demo-samples';

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;
type SampleKey = WebhookSampleKey;

interface WebhookDashboardData {
  generatedAt: string;
  lastUpdate: string | null;
  stats: {
    inboxTotal: number;
    panicEvents: number;
    warningEvents: number;
    trips: number;
    vehicles: number;
    drivers: number;
    sites: number;
    positions: number;
  };
  recentEvents: WebhookEventRow[];
  recentInbox: WebhookInboxRow[];
}

interface WebhookEventRow {
  id: string | null;
  eventId: string | null;
  eventType: string | null;
  label: string;
  kind: string;
  assetId: string | null;
  driverId: string | null;
  address: string | null;
  timestamp: string | null;
  receivedAt: string | null;
  payload: unknown;
}

interface WebhookInboxRow {
  id: number;
  receivedAt: string;
  eventId?: string | null;
  eventTypeId?: string | null;
  assetId?: string | null;
  source?: string;
  payload: unknown;
}

interface WebhookSetup {
  webhookUrl: string;
  dashboardDataUrl: string;
  eventsUrl: string;
  docsUrl: string;
  secretConfigured: boolean;
  expectedHeaders: Record<string, string>;
  samples: Record<SampleKey, unknown>;
}

interface SendResult {
  ok: boolean;
  webhookUrl?: string;
  sent?: unknown;
  postStatus?: number;
  postResponse?: unknown;
  dashboard?: WebhookDashboardData;
  fetched?: WebhookInboxRow[];
  error?: string;
}

interface WebhookDemoPageProps {
  authFetch: AuthFetch;
}

const sampleTemplates: {
  key: SampleKey;
  label: string;
  when: string;
  proves: string;
  fields: string;
}[] = [
  {
    key: 'panic',
    label: 'Panic event',
    when: 'Sent immediately when a driver triggers panic',
    proves: 'Real-time event delivery',
    fields: 'EventId, EventTypeId, AssetId, EventDateTime, Position',
  },
  {
    key: 'trip',
    label: 'Completed trip',
    when: 'Sent when a journey ends',
    proves: 'Lifecycle trip update',
    fields: 'TripId, AssetId, DriverId, DistanceKilometers, TripStart, TripEnd',
  },
  {
    key: 'position',
    label: 'Live position',
    when: 'Sent while a vehicle is moving or reporting location',
    proves: 'Location update flow',
    fields: 'AssetId, Latitude, Longitude, SpeedKilometresPerHour, Timestamp',
  },
  {
    key: 'vehicle',
    label: 'Vehicle data',
    when: 'Sent during setup or when a vehicle changes',
    proves: 'Asset reference sync',
    fields: 'AssetId, RegistrationNumber, Description, Make, Model',
  },
  {
    key: 'driver',
    label: 'Driver data',
    when: 'Sent during setup or when driver details change',
    proves: 'Driver reference sync',
    fields: 'DriverId, Name, MobileNumber',
  },
];

const PUBLIC_WEBHOOK_URL = 'https://jmg.bestpracticesltd.com.ng/api/mix-webhook';

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function formatDate(value?: string | null) {
  if (!value) return 'Not yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

async function parseResponseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(
      res.ok
        ? 'Server returned an empty response'
        : `Request failed (${res.status}). Webhook API may be unavailable — try npm run build && npm start.`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Server returned non-JSON (${res.status}): ${text.slice(0, 160)}`);
  }
}

function cloneWithFreshDemoValues(sample: unknown, key: SampleKey) {
  const now = new Date().toISOString();
  const id = `MOCK-DEMO-${key.toUpperCase()}-${Date.now()}`;
  const copy = JSON.parse(JSON.stringify(sample)) as Record<string, unknown>;

  if ('EventId' in copy) {
    copy.EventId = id;
    copy.EventDateTime = now;
    copy.ReceivedDateTime = now;
    const position = copy.Position as Record<string, unknown> | undefined;
    if (position) position.FormattedAddress = 'DEMO - not real MiX data';
  }

  if ('TripId' in copy) {
    copy.TripId = id;
    copy.TripStart = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    copy.TripEnd = now;
  }

  if ('Timestamp' in copy) {
    copy.Timestamp = now;
    copy.FormattedAddress = 'DEMO - not real MiX data';
  }

  return copy;
}

function panelStyle(extra: CSSProperties = {}): CSSProperties {
  return {
    background: 'var(--cd-surface)',
    border: '1px solid var(--cd-border)',
    borderRadius: '18px',
    boxShadow: 'var(--cd-card-shadow)',
    ...extra,
  };
}

function statNumberGlow(bright: string): CSSProperties {
  return {
    color: bright,
    textShadow: `0 1px 0 rgba(255,255,255,0.85), 0 10px 28px ${bright}33`,
  };
}

function gradientCardSurface(ring: string, inner: string, isDark: boolean): CSSProperties {
  if (isDark) {
    return {
      backgroundColor: 'var(--cd-surface)',
      boxShadow: 'var(--cd-card-shadow)',
    };
  }
  return {
    border: '1px solid transparent',
    background: `${inner} padding-box, ${ring} border-box`,
    boxShadow: 'var(--cd-card-shadow)',
  };
}

function JsonBlock({ value, minHeight = 180 }: { value: unknown; minHeight?: number }) {
  return (
    <pre
      style={{
        minHeight,
        maxHeight: 360,
        overflow: 'auto',
        margin: 0,
        padding: '14px',
        borderRadius: '12px',
        background: 'var(--cd-surface-2)',
        border: '1px solid var(--cd-border)',
        color: 'var(--cd-text)',
        fontSize: '12px',
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {formatJson(value ?? {})}
    </pre>
  );
}

export default function WebhookDemoPage({ authFetch }: WebhookDemoPageProps) {
  const { signOut } = useClerk();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [setup, setSetup] = useState<WebhookSetup | null>(null);
  const [dashboard, setDashboard] = useState<WebhookDashboardData | null>(null);
  const [selectedSample, setSelectedSample] = useState<SampleKey>('panic');
  const [jsonText, setJsonText] = useState(() =>
    formatJson(cloneWithFreshDemoValues(bundledWebhookSamples.panic, 'panic')),
  );
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [showTechnical, setShowTechnical] = useState(false);
  const [showSender, setShowSender] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

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

  const loadDashboard = async () => {
    const res = await authFetch('/api/mix-webhook/dashboard-data?limit=20');
    if (!res.ok) throw new Error(`Failed to load webhook dashboard data (${res.status})`);
    setDashboard(await parseResponseJson<WebhookDashboardData>(res));
  };

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const setupRes = await authFetch('/api/mix-webhook/playground/setup');
        if (!setupRes.ok) throw new Error(`Failed to load webhook demo setup (${setupRes.status})`);
        const setupData = await parseResponseJson<WebhookSetup>(setupRes);
        if (!mounted) return;
        setSetup(setupData);
        await loadDashboard();
      } catch (err) {
        if (mounted) setLoadError(err instanceof Error ? err.message : 'Failed to load Webhook demo');
      }
    };

    load();
    const interval = window.setInterval(() => {
      loadDashboard().catch(() => undefined);
    }, 5000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const { heroStats, chipStats } = useMemo(() => {
    const values = dashboard?.stats ?? {
      inboxTotal: 0,
      panicEvents: 0,
      warningEvents: 0,
      trips: 0,
      vehicles: 0,
      drivers: 0,
      sites: 0,
      positions: 0,
    };

    return {
      heroStats: [
        { key: 'inboxTotal', label: webhookDemoContent.statCards.inboxTotal, value: values.inboxTotal, accent: '#C65A2E', bright: '#F05022', ring: 'linear-gradient(145deg, rgba(240,80,34,0.55), rgba(253,186,116,0.35), rgba(255,247,237,0.5), rgba(240,80,34,0.4))', inner: 'linear-gradient(160deg, rgba(255,255,255,0.96), rgba(255,247,237,0.88))' },
        { key: 'panicEvents', label: webhookDemoContent.statCards.panicEvents, value: values.panicEvents, accent: '#A83B4D', bright: '#E11D48', ring: 'linear-gradient(145deg, rgba(225,29,72,0.5), rgba(254,205,211,0.4), rgba(255,241,242,0.5), rgba(200,16,46,0.35))', inner: 'linear-gradient(160deg, rgba(255,255,255,0.96), rgba(255,241,242,0.9))' },
        { key: 'warningEvents', label: webhookDemoContent.statCards.warningEvents, value: values.warningEvents, accent: '#A3661B', bright: '#F59E0B', ring: 'linear-gradient(145deg, rgba(245,158,11,0.5), rgba(253,230,138,0.35), rgba(255,251,235,0.5), rgba(217,119,6,0.35))', inner: 'linear-gradient(160deg, rgba(255,255,255,0.96), rgba(255,251,235,0.9))' },
        { key: 'trips', label: webhookDemoContent.statCards.trips, value: values.trips, accent: '#23756F', bright: '#14B8A6', ring: 'linear-gradient(145deg, rgba(20,184,166,0.48), rgba(153,246,228,0.35), rgba(240,253,250,0.5), rgba(13,148,136,0.35))', inner: 'linear-gradient(160deg, rgba(255,255,255,0.96), rgba(240,253,250,0.9))' },
      ],
      chipStats: [
        { key: 'vehicles', label: webhookDemoContent.statCards.vehicles, value: values.vehicles, accent: '#355F9E', bright: '#2563EB', ring: 'linear-gradient(145deg, rgba(37,99,235,0.42), rgba(191,219,254,0.35), rgba(239,246,255,0.55))', inner: 'linear-gradient(160deg, rgba(255,255,255,0.97), rgba(239,246,255,0.88))' },
        { key: 'drivers', label: 'Drivers', value: values.drivers, accent: '#6847A8', bright: '#7C3AED', ring: 'linear-gradient(145deg, rgba(124,58,237,0.42), rgba(221,214,254,0.35), rgba(245,243,255,0.55))', inner: 'linear-gradient(160deg, rgba(255,255,255,0.97), rgba(245,243,255,0.88))' },
        { key: 'sites', label: 'Sites', value: values.sites, accent: '#456E87', bright: '#0284C7', ring: 'linear-gradient(145deg, rgba(2,132,199,0.38), rgba(186,230,253,0.32), rgba(238,244,248,0.55))', inner: 'linear-gradient(160deg, rgba(255,255,255,0.97), rgba(238,244,248,0.88))' },
        { key: 'positions', label: webhookDemoContent.statCards.positions, value: values.positions, accent: '#287A45', bright: '#16A34A', ring: 'linear-gradient(145deg, rgba(22,163,74,0.42), rgba(187,247,208,0.35), rgba(240,253,244,0.55))', inner: 'linear-gradient(160deg, rgba(255,255,255,0.97), rgba(240,253,244,0.88))' },
      ],
    };
  }, [dashboard]);

  const loadSample = (key: SampleKey) => {
    const samples = setup?.samples ?? bundledWebhookSamples;
    setSelectedSample(key);
    setJsonError('');
    setSendResult(null);
    setJsonText(formatJson(cloneWithFreshDemoValues(samples[key], key)));
  };

  const sendPayload = async () => {
    setJsonError('');
    setSendResult(null);

    let payload: unknown;
    try {
      payload = JSON.parse(jsonText);
    } catch {
      setJsonError(webhookDemoContent.labels.invalidJson);
      return;
    }

    setLoading(true);
    try {
      const res = await authFetch('/api/mix-webhook/playground/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload }),
      });
      const data = await parseResponseJson<SendResult>(res);
      if (!res.ok && !data.error) {
        data.error = `Send failed (${res.status})`;
        data.ok = false;
      }
      setSendResult(data);
      if (data.dashboard) setDashboard(data.dashboard);
      else await loadDashboard();
    } catch (err) {
      setSendResult({ ok: false, error: err instanceof Error ? err.message : 'Failed to send payload' });
    } finally {
      setLoading(false);
    }
  };

  const copyWebhookUrl = async () => {
    await navigator.clipboard.writeText(setup?.webhookUrl || PUBLIC_WEBHOOK_URL);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const statusColor = sendResult?.ok ? '#16a34a' : sendResult ? '#c8102e' : 'var(--cd-text-muted)';
  const isDark = theme === 'dark';

  return (
    <div className="fleet-page min-h-screen">
      <div className="fleet-shell cd-shell-padding">
        <div className="max-w-7xl mx-auto">
          <div className="cd-header" style={{ marginBottom: '32px' }}>
            <div className="flex items-start gap-6">
              <div className="flex-shrink-0">
                <img src="/JMG.avif" alt="JMG Logo" className="cd-logo" />
              </div>
              <div>
                <div style={{ display: 'inline-flex', padding: '5px 10px', borderRadius: '999px', background: '#FEF0EB', color: '#F05022', fontSize: '11px', fontWeight: 700, marginBottom: '10px' }}>
                  {webhookDemoContent.badge}
                </div>
                <h1 className="cd-title mb-1" style={{ color: 'var(--cd-text)' }}>{webhookDemoContent.title}</h1>
                <p className="cd-subtitle" style={{ color: 'var(--cd-text-muted)', maxWidth: 720 }}>
                  {webhookDemoContent.subtitle}
                </p>
              </div>
            </div>

            <div className="cd-header-buttons flex items-center gap-1">
              <button className="cd-toolbtn" onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                <span className="cd-toolbtn-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
              </button>
              <button className="cd-toolbtn" onClick={() => signOut()} aria-label="Log out" style={{ color: '#c8102e' }}>
                <Power size={16} />
                <span className="cd-toolbtn-label">Sign out</span>
              </button>
            </div>
          </div>

          {loadError && (
            <div style={panelStyle({ padding: 18, marginBottom: 22, borderColor: '#fecdd3', color: '#c8102e' })}>
              {loadError}
            </div>
          )}

          <section style={panelStyle({ padding: 20, marginBottom: 24 })}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <FileJson size={18} color="#F05022" />
              <h2 style={{ margin: 0, color: 'var(--cd-text)', fontSize: 18 }}>What MiX sends</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
              {webhookDemoContent.deliveryPatterns.map(pattern => (
                <div key={pattern.title} style={{ padding: 14, borderRadius: 14, background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)' }}>
                  <div style={{ fontWeight: 800, color: 'var(--cd-text)', marginBottom: 6 }}>{pattern.title}</div>
                  <div style={{ fontSize: 12, color: '#F05022', fontWeight: 700, marginBottom: 8 }}>{pattern.timing}</div>
                  <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', lineHeight: 1.5 }}>{pattern.examples}</div>
                </div>
              ))}
            </div>
          </section>

          <div className="cd-stats-tier1" style={{ marginTop: isMobile ? '8px' : '0' }}>
            {heroStats.map(stat => (
              <div
                key={stat.key}
                className="cd-stat-hero"
                style={{
                  ...gradientCardSurface(stat.ring, stat.inner, isDark),
                  cursor: 'default',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.09em', color: 'var(--cd-text-muted)' }}>
                    {stat.label}
                  </span>
                  <Database size={18} style={{ color: stat.accent, opacity: 0.55, flexShrink: 0 }} />
                </div>
                <div
                  style={{
                    marginTop: '16px',
                    fontSize: isMobile ? '36px' : '52px',
                    fontWeight: 700,
                    lineHeight: 1,
                    letterSpacing: '-0.02em',
                    ...statNumberGlow(stat.bright),
                  }}
                >
                  {stat.value.toLocaleString()}
                </div>
                <div style={{ marginTop: 'auto', paddingTop: '8px', paddingLeft: '4px', fontSize: '11px', color: 'var(--cd-text-soft)' }}>
                  Webhook demo
                </div>
              </div>
            ))}
          </div>

          <div className="cd-stats-tier2" style={{ marginBottom: isMobile ? '20px' : '40px' }}>
            {chipStats.map(stat => (
              <div
                key={stat.key}
                className="cd-stat-chip"
                style={{
                  position: 'relative',
                  flex: '0 1 calc((100% - 50px) / 6)',
                  maxWidth: 200,
                  ...gradientCardSurface(stat.ring, stat.inner, isDark),
                }}
              >
                <div style={{ fontSize: isMobile ? '20px' : '26px', fontWeight: 700, lineHeight: 1, ...statNumberGlow(stat.bright) }}>
                  {stat.value.toLocaleString()}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--cd-text-muted)', marginTop: '5px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em', whiteSpace: 'nowrap' as const }}>
                  {stat.label}
                </div>
                <span style={{ position: 'absolute', right: 12, bottom: 10, fontSize: '9px', color: 'var(--cd-text-soft)', fontWeight: 500, letterSpacing: '0.02em' }}>
                  Webhook demo
                </span>
              </div>
            ))}
          </div>

          <section style={panelStyle({ padding: 20, marginBottom: 24 })}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: 0, color: 'var(--cd-text)', fontSize: 18 }}>Saved webhook events</h2>
                <p style={{ margin: '4px 0 0', color: 'var(--cd-text-muted)', fontSize: 13 }}>
                  Last update: {formatDate(dashboard?.lastUpdate)}
                </p>
              </div>
              <button className="cd-toolbtn" onClick={() => loadDashboard().catch(() => undefined)} aria-label="Refresh webhook demo data">
                <RefreshCw size={15} />
                <span className="cd-toolbtn-label">Refresh</span>
              </button>
            </div>
            {dashboard?.recentEvents.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: 'var(--cd-text-muted)', textAlign: 'left' }}>
                      {['Time', 'Event type', 'Vehicle', 'Location', 'Reference'].map(column => (
                        <th key={column} style={{ padding: '10px 8px', borderBottom: '1px solid var(--cd-border)' }}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.recentEvents.map((event, index) => (
                      <tr key={`${event.eventId}-${event.receivedAt}-${index}`}>
                        <td style={{ padding: '12px 8px', borderBottom: '1px solid var(--cd-border)', color: 'var(--cd-text-muted)' }}>{formatDate(event.timestamp)}</td>
                        <td style={{ padding: '12px 8px', borderBottom: '1px solid var(--cd-border)', color: 'var(--cd-text)', fontWeight: 700 }}>{event.label}</td>
                        <td style={{ padding: '12px 8px', borderBottom: '1px solid var(--cd-border)', color: 'var(--cd-text)' }}>{event.assetId || 'N/A'}</td>
                        <td style={{ padding: '12px 8px', borderBottom: '1px solid var(--cd-border)', color: 'var(--cd-text-muted)' }}>{event.address || 'N/A'}</td>
                        <td style={{ padding: '12px 8px', borderBottom: '1px solid var(--cd-border)', color: 'var(--cd-text-muted)' }}>{event.eventId || event.id || 'N/A'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: 28, textAlign: 'center', color: 'var(--cd-text-muted)', background: 'var(--cd-surface-2)', borderRadius: 14 }}>
                {webhookDemoContent.labels.emptyEvents}
              </div>
            )}
          </section>

          <section style={panelStyle({ padding: 20 })}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: 0, color: 'var(--cd-text)', fontSize: 18 }}>{webhookDemoContent.labels.sendHeading}</h2>
                <p style={{ margin: '8px 0 0', color: 'var(--cd-text-muted)', fontSize: 13, lineHeight: 1.6, maxWidth: 720 }}>
                  Open this only when you want to send or inspect a sample. Close it afterwards to see the dashboard update without distraction.
                </p>
              </div>
              <button
                onClick={() => setShowSender(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 18px',
                  borderRadius: 12,
                  border: 'none',
                  background: '#F05022',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                <Send size={16} />
                Open test sender
              </button>
            </div>
            {sendResult && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: statusColor, fontWeight: 800, marginTop: 14 }}>
                {sendResult.ok ? <CheckCircle size={17} /> : <AlertTriangle size={17} />}
                {sendResult.ok ? webhookDemoContent.labels.success : sendResult.error || 'Last send returned an error'}
              </div>
            )}
          </section>

          {showSender && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Webhook test sender"
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 1000,
                background: 'rgba(0,0,0,0.56)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 18,
              }}
            >
              <div style={{ ...panelStyle({ padding: 0 }), width: 'min(1180px, 96vw)', maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--cd-border)', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <div>
                    <h2 style={{ margin: 0, color: 'var(--cd-text)', fontSize: 19 }}>{webhookDemoContent.labels.sendHeading}</h2>
                    <p style={{ margin: '5px 0 0', color: 'var(--cd-text-muted)', fontSize: 13 }}>
                      Paste JSON, send it, check the response, then close this window to view the updated dashboard.
                    </p>
                  </div>
                  <button className="cd-toolbtn" onClick={() => setShowSender(false)} aria-label="Close test sender">
                    Close
                  </button>
                </div>

                <div style={{ padding: 20, overflow: 'auto' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(320px, 0.9fr)', gap: 18, alignItems: 'start' }}>
                    <div>
                      <div style={{ padding: 12, borderRadius: 12, background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)', marginBottom: 14 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                          {webhookDemoContent.labels.webhookUrl}
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <code style={{ flex: 1, color: 'var(--cd-text)', fontSize: 12, overflowWrap: 'anywhere' }}>{setup?.webhookUrl || PUBLIC_WEBHOOK_URL}</code>
                          <button className="cd-toolbtn" onClick={copyWebhookUrl} aria-label="Copy webhook URL">
                            <Copy size={14} />
                            <span className="cd-toolbtn-label">{copied ? 'Copied' : 'Copy'}</span>
                          </button>
                        </div>
                      </div>

                      <div style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                          <div>
                            <h3 style={{ margin: 0, color: 'var(--cd-text)', fontSize: 15 }}>Choose a template</h3>
                            <p style={{ margin: '4px 0 0', color: 'var(--cd-text-muted)', fontSize: 12, lineHeight: 1.5 }}>
                              Start with what MiX is expected to send, then edit the JSON before sending.
                            </p>
                          </div>
                          <span style={{ color: 'var(--cd-text-soft)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            Tappable samples
                          </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
                          {sampleTemplates.map(template => {
                            const selected = selectedSample === template.key;
                            return (
                              <button
                                key={template.key}
                                onClick={() => loadSample(template.key)}
                                style={{
                                  padding: 13,
                                  borderRadius: 14,
                                  border: selected ? '1px solid #F05022' : '1px solid var(--cd-border)',
                                  background: selected ? '#FEF0EB' : 'var(--cd-surface-2)',
                                  color: 'var(--cd-text)',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  boxShadow: selected ? '0 0 0 1px rgba(240,80,34,0.2)' : 'none',
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
                                  <span style={{ fontSize: 13, fontWeight: 800, color: selected ? '#F05022' : 'var(--cd-text)' }}>{template.label}</span>
                                  {selected && <CheckCircle size={15} color="#F05022" />}
                                </div>
                                <div style={{ fontSize: 11, color: '#F05022', fontWeight: 800, marginBottom: 6 }}>{template.proves}</div>
                                <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', lineHeight: 1.45, marginBottom: 8 }}>{template.when}</div>
                                <div style={{ fontSize: 10, color: 'var(--cd-text-soft)', lineHeight: 1.4 }}>{template.fields}</div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div style={{ padding: 12, borderRadius: 12, background: '#FEF0EB', color: '#7c2d12', fontSize: 13, lineHeight: 1.55, marginBottom: 12 }}>
                        {webhookDemoContent.sampleNotes[selectedSample]}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                        <div>
                          <h3 style={{ margin: 0, color: 'var(--cd-text)', fontSize: 15 }}>Edit the payload</h3>
                          <p style={{ margin: '4px 0 0', color: 'var(--cd-text-muted)', fontSize: 12 }}>He can change any field here before clicking Send.</p>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {sampleTemplates.map(template => (
                            <button
                              key={`mini-${template.key}`}
                              onClick={() => loadSample(template.key)}
                              style={{
                                padding: '5px 9px',
                                borderRadius: 999,
                                border: selectedSample === template.key ? '1px solid #F05022' : '1px solid var(--cd-border)',
                                background: selectedSample === template.key ? '#FEF0EB' : 'var(--cd-surface-2)',
                                color: selectedSample === template.key ? '#F05022' : 'var(--cd-text-muted)',
                                cursor: 'pointer',
                                fontSize: 11,
                                fontWeight: 700,
                              }}
                            >
                              {template.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <textarea
                        value={jsonText}
                        onChange={(event) => setJsonText(event.target.value)}
                        spellCheck={false}
                        aria-label="Webhook JSON payload"
                        style={{
                          width: '100%',
                          minHeight: 330,
                          resize: 'vertical',
                          padding: 14,
                          borderRadius: 14,
                          border: jsonError ? '1px solid #c8102e' : '1px solid var(--cd-border)',
                          background: 'var(--cd-surface-2)',
                          color: 'var(--cd-text)',
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          fontSize: 12,
                          lineHeight: 1.55,
                          outline: 'none',
                        }}
                      />
                      {jsonError && <div style={{ marginTop: 8, color: '#c8102e', fontSize: 13 }}>{jsonError}</div>}

                      <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                        <button
                          onClick={sendPayload}
                          disabled={loading}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '11px 18px',
                            borderRadius: 10,
                            border: 'none',
                            background: loading ? 'var(--cd-surface-2)' : '#F05022',
                            color: loading ? 'var(--cd-text-muted)' : '#fff',
                            fontWeight: 800,
                            cursor: loading ? 'not-allowed' : 'pointer',
                          }}
                        >
                          <Send size={15} />
                          {loading ? 'Sending...' : webhookDemoContent.labels.send}
                        </button>
                        <button className="cd-toolbtn" onClick={() => { setJsonText(''); setJsonError(''); setSendResult(null); }}>
                          {webhookDemoContent.labels.clear}
                        </button>
                        <button className="cd-toolbtn" onClick={() => setShowSender(false)}>
                          Close and view dashboard
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {sendResult && (
                      <div style={panelStyle({ padding: 18 })}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: statusColor, fontWeight: 800 }}>
                          {sendResult?.ok ? <CheckCircle size={17} /> : sendResult ? <AlertTriangle size={17} /> : <Database size={17} />}
                          {sendResult.ok ? webhookDemoContent.labels.success : sendResult.error || 'Last send returned an error'}
                        </div>
                      </div>
                      )}

                      <div style={panelStyle({ padding: 18 })}>
                        <h3 style={{ margin: '0 0 10px', color: 'var(--cd-text)', fontSize: 15 }}>{webhookDemoContent.labels.serverResponse}</h3>
                        <JsonBlock value={sendResult?.postResponse ?? sendResult ?? { status: 'No send yet' }} minHeight={140} />
                      </div>

                      <div style={panelStyle({ padding: 18 })}>
                        <h3 style={{ margin: '0 0 10px', color: 'var(--cd-text)', fontSize: 15 }}>{webhookDemoContent.labels.savedOnServer}</h3>
                        <JsonBlock value={sendResult?.fetched?.[0] ?? dashboard?.recentInbox?.[0] ?? { status: 'No saved payload yet' }} minHeight={150} />
                      </div>

                      <div style={panelStyle({ padding: 18 })}>
                        <h3 style={{ margin: '0 0 10px', color: 'var(--cd-text)', fontSize: 15 }}>Field guide</h3>
                        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--cd-text-muted)', fontSize: 13, lineHeight: 1.7 }}>
                          {webhookDemoContent.fieldGuide.map(item => <li key={item}>{item}</li>)}
                        </ul>
                        <a href={setup?.docsUrl || '/docs/mix-webhook'} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 12, color: '#F05022', fontWeight: 800, textDecoration: 'none' }}>
                          {webhookDemoContent.labels.docsLink}
                        </a>
                      </div>

                      <div style={panelStyle({ padding: 18 })}>
                        <button
                          onClick={() => setShowTechnical(prev => !prev)}
                          style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', color: 'var(--cd-text)', cursor: 'pointer', fontWeight: 800, padding: 0 }}
                        >
                          {webhookDemoContent.labels.technicalDetails}
                        </button>
                        {showTechnical && (
                          <div style={{ marginTop: 12, color: 'var(--cd-text-muted)', fontSize: 12, lineHeight: 1.7 }}>
                            <div>Secret: {setup?.secretConfigured ? 'Configured' : 'Missing'}</div>
                            <div>Dashboard read endpoint: {setup?.dashboardDataUrl || 'Loading'}</div>
                            <div>Recent inbox endpoint: {setup?.eventsUrl || 'Loading'}</div>
                            <div>Webhook store mode: {dashboard ? 'file' : 'Loading'}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
