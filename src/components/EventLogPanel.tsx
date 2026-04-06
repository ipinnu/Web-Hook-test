import { useState, useEffect } from 'react';
import { X, Search } from 'lucide-react';

interface LogEntry {
  timestamp: string;
  assetId: string;
  regNo?: string;
  assetName?: string;
  transporter?: string;
  eventId: string;
  label?: string;
  eventTime: string;
  type: 'panic' | 'warning';
  rawEvent?: any;
}

interface Props {
  open: boolean;
  onClose: () => void;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  isMobile: boolean;
}

const EVENT_FILTERS = ['All', 'Panic', 'Harsh Brake', 'Harsh Accel', 'Overspeed', 'Overspeed Tiered', 'Harsh Corner'];

export default function EventLogPanel({ open, onClose, authFetch, isMobile }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');

  useEffect(() => {
    if (!open) return;
    const load = async () => {
      setLoading(true);
      try {
        const res = await authFetch('/api/events/log');
        if (res.ok) {
          const data = await res.json();
          setEntries(Array.isArray(data) ? data : []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [open]);

  if (!open) return null;

  // Filter to today by default
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const filtered = entries.filter(e => {
    const label = e.label || 'Panic';
    const matchesFilter = activeFilter === 'All' ||
      (activeFilter === 'Panic' && e.type === 'panic') ||
      label === activeFilter;
    const matchesSearch = searchTerm === '' ||
      (e.regNo && e.regNo.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (e.assetName && e.assetName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (e.transporter && e.transporter.toLowerCase().includes(searchTerm.toLowerCase())) ||
      e.assetId.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesToday = new Date(e.timestamp).getTime() >= todayStart.getTime();
    return matchesFilter && matchesSearch && matchesToday;
  });

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('en-GB', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
    } catch { return iso; }
  };

  const panelStyle: React.CSSProperties = isMobile ? {
    position: 'fixed',
    inset: 0,
    zIndex: 200,
    backgroundColor: 'var(--cd-surface)',
    display: 'flex',
    flexDirection: 'column',
  } : {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: '320px',
    zIndex: 200,
    backgroundColor: 'var(--cd-surface)',
    borderLeft: '1px solid var(--cd-border)',
    boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
    display: 'flex',
    flexDirection: 'column',
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 199 }}
      />
      <div style={panelStyle}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--cd-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: '16px', fontWeight: '600', color: 'var(--cd-text)' }}>Event Log</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cd-text-muted)', padding: '4px' }}>
            <X style={{ width: '20px', height: '20px' }} />
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--cd-border)', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <Search style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', width: '14px', height: '14px', color: 'var(--cd-text-soft)' }} />
            <input
              type="text"
              placeholder="Search reg no, asset or transporter..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ width: '100%', paddingLeft: '32px', paddingRight: '12px', paddingTop: '7px', paddingBottom: '7px', border: '1px solid var(--cd-border)', borderRadius: '8px', fontSize: '13px', outline: 'none', backgroundColor: 'var(--cd-surface-2)', color: 'var(--cd-text)' }}
            />
          </div>
        </div>

        {/* Filters */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--cd-border)', display: 'flex', gap: '6px', flexWrap: 'wrap', flexShrink: 0 }}>
          {EVENT_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              style={{
                padding: '4px 10px',
                borderRadius: '9999px',
                fontSize: '11px',
                fontWeight: '500',
                cursor: 'pointer',
                border: activeFilter === f
                  ? f === 'Panic' ? '0.5px solid #fecdd3' : '0.5px solid #fde68a'
                  : '0.5px solid var(--cd-border)',
                background: activeFilter === f
                  ? f === 'Panic' ? '#fff1f2' : '#fef3c7'
                  : 'var(--cd-surface-2)',
                color: activeFilter === f
                  ? f === 'Panic' ? '#c8102e' : '#854F0B'
                  : 'var(--cd-text-muted)',
              }}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Entries */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {loading && entries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--cd-text-muted)', fontSize: '13px' }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--cd-text-muted)', fontSize: '13px' }}>No events today</div>
          ) : filtered.map((entry, i) => {
            const isPanic = entry.type === 'panic';
            const label = entry.label || 'Panic';
            const address = entry.rawEvent?.Position?.FormattedAddress || '';
            const displayName = entry.regNo && entry.regNo !== 'N/A' ? entry.regNo : entry.assetId;
            return (
              <div
                key={`${entry.eventId}-${i}`}
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: `0.5px solid ${isPanic ? '#fecdd3' : '#fde68a'}`,
                  backgroundColor: isPanic ? '#fff1f2' : '#fffbeb',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '600', color: isPanic ? '#c8102e' : '#854F0B' }}>
                    {isPanic ? '🚨' : '⚠'} {label}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--cd-text-soft)' }}>{formatTime(entry.timestamp)}</span>
                </div>
                <div style={{ fontSize: '12px', fontWeight: '500', color: 'var(--cd-text)', marginBottom: '2px' }}>
                  {displayName}
                </div>
                {entry.assetName && entry.assetName !== 'Unknown Vehicle' && (
                  <div style={{ fontSize: '11px', color: 'var(--cd-text-muted)', marginBottom: '2px' }}>
                    {entry.assetName}
                  </div>
                )}
                {entry.transporter && entry.transporter !== 'N/A' && (
                  <div style={{ fontSize: '11px', color: 'var(--cd-text-muted)', marginBottom: '2px' }}>
                    {entry.transporter}
                  </div>
                )}
                {address && (
                  <div style={{ fontSize: '11px', color: 'var(--cd-text-muted)' }}>{address}</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--cd-border)', fontSize: '11px', color: 'var(--cd-text-muted)', textAlign: 'center', flexShrink: 0 }}>
          {filtered.length} event{filtered.length !== 1 ? 's' : ''} today • auto-refreshes every 10s
        </div>
      </div>
    </>
  );
}