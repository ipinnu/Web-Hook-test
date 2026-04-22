import { useState, useEffect, useMemo } from 'react';
import { X, Search } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface LogEntry {
  timestamp: string;
  assetId: string;
  regNo?: string;
  assetName?: string;
  transporter?: string;
  driverName?: string;
  driverPhone?: string;
  address?: string;
  eventId: string;
  label?: string;
  eventTime: string;
  type: 'panic' | 'warning';
  rawEvent?: any;
}

interface TrendDay {
  date: string;
  'Panic': number;
  'Harsh Braking': number;
  'Harsh Acceleration': number;
  'Overspeeding': number;
  'Overspeed Tiered': number;
  'Harsh Cornering': number;
  'Total': number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  isMobile: boolean;
}

type DateRange = 'today' | '7days' | '30days' | 'alltime' | 'custom';
type ViewMode = 'events' | 'trends';

const EVENT_FILTERS = ['All', 'Panic', 'Harsh Braking', 'Harsh Acceleration', 'Overspeeding', 'Overspeed Tiered', 'Harsh Cornering'];
const HIDDEN_LABELS = ['Possible Power Tamper', 'Battery Disconnection', 'Battery Disconnected', 'Front Panel Tamper', 'Back Panel Tamper', 'No Blue Key'];

const EVENT_COLORS: Record<string, string> = {
  'Total': '#0f172a',
  'Panic': '#c8102e',
  'Harsh Braking': '#0d9488',
  'Harsh Acceleration': '#2563eb',
  'Overspeeding': '#9333ea',
  'Overspeed Tiered': '#ea580c',
  'Harsh Cornering': '#16a34a',
};

// Custom tooltip showing all event counts for hovered day
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0]?.payload as TrendDay;
  if (!data) return null;
  return (
    <div style={{
      background: '#1e293b', border: 'none', borderRadius: '10px',
      padding: '10px 14px', fontSize: '11px', color: '#fff',
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)', minWidth: '160px',
    }}>
      <div style={{ color: '#94a3b8', marginBottom: '8px', fontWeight: '600', fontSize: '12px' }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {Object.entries(EVENT_COLORS).map(([key, color]) => {
          const val = (data as any)[key];
          if (val === undefined) return null;
          return (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ color: '#cbd5e1', fontSize: '10px' }}>{key}</span>
              </div>
              <span style={{ fontWeight: '600', color: val > 0 ? '#fff' : '#475569' }}>{val}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default function EventLogPanel({ open, onClose, authFetch, isMobile }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('events');
  const [showTotal, setShowTotal] = useState(false);

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

  // ── Date filter helper ────────────────────────────────────────────────────
  const getDateFilter = (entry: LogEntry): boolean => {
    const ts = new Date(entry.timestamp).getTime();
    const now = Date.now();
    if (dateRange === 'today') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return ts >= start.getTime();
    }
    if (dateRange === '7days') return ts >= now - 7 * 24 * 60 * 60 * 1000;
    if (dateRange === '30days') return ts >= now - 30 * 24 * 60 * 60 * 1000;
    if (dateRange === 'custom' && fromDate && toDate) {
      const from = new Date(fromDate).getTime();
      const to = new Date(toDate).getTime() + 86400000;
      return ts >= from && ts <= to;
    }
    return true;
  };

  // ── Earliest entry date across all logs ──────────────────────────────────
  const earliestDate = useMemo(() => {
    if (entries.length === 0) return new Date();
    const sorted = [...entries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const d = new Date(sorted[0].timestamp);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [entries]);

  // ── Filtered entries ──────────────────────────────────────────────────────
  const filtered = useMemo(() => entries.filter(e => {
    const label = e.label || 'Panic';
    if (HIDDEN_LABELS.includes(label)) return false;
    const matchesFilter = activeFilter === 'All' || label === activeFilter || (activeFilter === 'Panic' && e.type === 'panic');
    const matchesSearch = searchTerm === '' ||
      (e.regNo && e.regNo !== 'N/A' && e.regNo.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (e.assetName && e.assetName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (e.assetId && e.assetId.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (e.driverName && e.driverName !== 'N/A' && e.driverName.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesFilter && matchesSearch && getDateFilter(e);
  }), [entries, activeFilter, searchTerm, dateRange, fromDate, toDate]);

  // ── Trend data with zero-filled dates ────────────────────────────────────
  const trendData = useMemo((): TrendDay[] => {
    const dateFiltered = entries.filter(e => {
      const label = e.label || 'Panic';
      if (HIDDEN_LABELS.includes(label)) return false;
      return getDateFilter(e);
    });

    const byDate = new Map<string, TrendDay>();
    const now = new Date();

    let startDate: Date;
    let endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);

    if (dateRange === 'today') {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
    } else if (dateRange === '7days') {
      // Use earliest date if we have less than 7 days of data
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      sevenDaysAgo.setHours(0, 0, 0, 0);
      startDate = earliestDate > sevenDaysAgo ? earliestDate : sevenDaysAgo;
    } else if (dateRange === '30days') {
      // Use earliest date if we have less than 30 days of data
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
      thirtyDaysAgo.setHours(0, 0, 0, 0);
      startDate = earliestDate > thirtyDaysAgo ? earliestDate : thirtyDaysAgo;
    } else if (dateRange === 'custom' && fromDate && toDate) {
      startDate = new Date(fromDate);
      endDate = new Date(toDate);
      endDate.setHours(23, 59, 59, 999);
    } else {
      // All time — use earliest entry date
      startDate = new Date(earliestDate);
    }

    // Fill every date in range with zeros
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const dateKey = cursor.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      byDate.set(dateKey, {
        date: dateKey,
        'Panic': 0,
        'Harsh Braking': 0,
        'Harsh Acceleration': 0,
        'Overspeeding': 0,
        'Overspeed Tiered': 0,
        'Harsh Cornering': 0,
        'Total': 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    // Populate with actual data
    dateFiltered.forEach(e => {
      const date = new Date(e.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      const day = byDate.get(date);
      if (!day) return;
      const label = e.label || 'Panic';
      if (label in day) (day as any)[label]++;
      day['Total']++;
    });

    return Array.from(byDate.values());
  }, [entries, dateRange, fromDate, toDate, earliestDate]);

  // ── Summary stats ─────────────────────────────────────────────────────────
  const summaryStats = useMemo(() => {
    if (trendData.length === 0) return null;
    const total = trendData.reduce((sum, d) => sum + d['Total'], 0);
    const avg = Math.round(total / trendData.length);
    const peak = trendData.reduce((max, d) => d['Total'] > max['Total'] ? d : max, trendData[0]);
    const lowest = trendData.reduce((min, d) => d['Total'] < min['Total'] ? d : min, trendData[0]);
    return { total, avg, peak, lowest};
  }, [trendData]);

  // ── Which lines to show ───────────────────────────────────────────────────
  // showTotal=true → only Total line
  // activeFilter='All' + showTotal=false → all individual event lines
  // activeFilter=specific → just that line
  const activeLines = useMemo(() => {
    if (showTotal) return ['Total'];
    if (activeFilter === 'All') return ['Harsh Braking', 'Harsh Acceleration', 'Overspeeding', 'Overspeed Tiered', 'Harsh Cornering', 'Panic'];
    return [activeFilter];
  }, [activeFilter, showTotal]);

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  };

  // ── Early return after all hooks ──────────────────────────────────────────
  if (!open) return null;

  const panelStyle: React.CSSProperties = isMobile ? {
    position: 'fixed', inset: 0, zIndex: 1001,
    backgroundColor: 'var(--cd-surface)',
    display: 'flex', flexDirection: 'column',
  } : {
    position: 'fixed', top: 0, right: 0, bottom: 0,
    width: '60%',
    minWidth: '480px',
    zIndex: 1001,
    backgroundColor: 'var(--cd-surface)',
    borderLeft: '1px solid var(--cd-border)',
    boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
    display: 'flex', flexDirection: 'column',
    transition: 'width 0.2s ease',
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 1000 }} />

      <div style={panelStyle}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--cd-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: '16px', fontWeight: '600', color: 'var(--cd-text)' }}>Event Log</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cd-text-muted)', padding: '4px' }}>
            <X style={{ width: '20px', height: '20px' }} />
          </button>
        </div>

        {/* Date Range */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--cd-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: dateRange === 'custom' ? '8px' : '0' }}>
            {(['today', '7days', '30days', 'alltime', 'custom'] as DateRange[]).map(r => (
              <button
                key={r}
                onClick={() => setDateRange(r)}
                style={{
                  padding: '4px 10px', borderRadius: '9999px', fontSize: '11px',
                  fontWeight: dateRange === r ? '500' : '400', cursor: 'pointer',
                  border: dateRange === r ? '0.5px solid var(--cd-accent-2)' : '0.5px solid var(--cd-border)',
                  background: dateRange === r ? '#eff6ff' : 'var(--cd-surface-2)',
                  color: dateRange === r ? '#2563eb' : 'var(--cd-text-muted)',
                }}
              >
                {r === 'today' ? 'Today' : r === '7days' ? '7 days' : r === '30days' ? '30 days' : r === 'alltime' ? 'All time' : 'Custom'}
              </button>
            ))}
          </div>
          {dateRange === 'custom' && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '11px', color: 'var(--cd-text-muted)', display: 'block', marginBottom: '3px' }}>From</label>
                <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                  style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--cd-border)', borderRadius: '8px', fontSize: '12px', backgroundColor: 'var(--cd-surface-2)', color: 'var(--cd-text)', outline: 'none' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '11px', color: 'var(--cd-text-muted)', display: 'block', marginBottom: '3px' }}>To</label>
                <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                  style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--cd-border)', borderRadius: '8px', fontSize: '12px', backgroundColor: 'var(--cd-surface-2)', color: 'var(--cd-text)', outline: 'none' }} />
              </div>
            </div>
          )}
        </div>

        {/* Search */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--cd-border)', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <Search style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', width: '14px', height: '14px', color: 'var(--cd-text-soft)' }} />
            <input
              type="text"
              placeholder="Search reg no, asset name, or driver..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ width: '100%', paddingLeft: '32px', paddingRight: '12px', paddingTop: '7px', paddingBottom: '7px', border: '1px solid var(--cd-border)', borderRadius: '8px', fontSize: '13px', outline: 'none', backgroundColor: 'var(--cd-surface-2)', color: 'var(--cd-text)' }}
            />
          </div>
        </div>

        {/* Event Type Filters */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--cd-border)', display: 'flex', gap: '6px', flexWrap: 'wrap', flexShrink: 0 }}>
          {EVENT_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => { setActiveFilter(f); setShowTotal(false); }}
              style={{
                padding: '4px 10px', borderRadius: '9999px', fontSize: '11px',
                fontWeight: '500', cursor: 'pointer',
                border: activeFilter === f && !showTotal
                  ? f === 'Panic' ? '0.5px solid #fecdd3' : '0.5px solid #fde68a'
                  : '0.5px solid var(--cd-border)',
                background: activeFilter === f && !showTotal
                  ? f === 'Panic' ? '#fff1f2' : '#fef3c7'
                  : 'var(--cd-surface-2)',
                color: activeFilter === f && !showTotal
                  ? f === 'Panic' ? '#c8102e' : '#854F0B'
                  : 'var(--cd-text-muted)',
              }}
            >
              {f}
            </button>
          ))}
        </div>

        {/* View Toggle */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--cd-border)', display: 'flex', gap: '4px', flexShrink: 0 }}>
          {(['events', 'trends'] as ViewMode[]).map(v => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              style={{
                padding: '5px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: '500', cursor: 'pointer',
                border: '1px solid var(--cd-border)',
                background: viewMode === v ? '#0f172a' : 'var(--cd-surface-2)',
                color: viewMode === v ? '#fff' : 'var(--cd-text-muted)',
              }}
            >
              {v === 'events' ? 'Events' : 'Trends'}
            </button>
          ))}
        </div>

        {/* Content */}
        {viewMode === 'events' ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {loading && entries.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--cd-text-muted)', fontSize: '13px' }}>Loading...</div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--cd-text-muted)', fontSize: '13px' }}>No events found</div>
            ) : filtered.map((entry, i) => {
              const isPanic = entry.type === 'panic';
              const label = entry.label || 'Panic';
              const address = entry.address && entry.address !== 'null'
                ? entry.address
                : entry.rawEvent?.Position?.FormattedAddress || '';
              const displayName = entry.regNo && entry.regNo !== 'N/A' ? entry.regNo : entry.assetId;
              const hasDriver = entry.driverName && entry.driverName !== 'N/A' && entry.driverName !== 'No Driver Assigned';
              return (
                <div
                  key={`${entry.eventId}-${i}`}
                  style={{
                    padding: '10px 12px', borderRadius: '8px',
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
                    <div style={{ fontSize: '11px', color: 'var(--cd-text-muted)', marginBottom: '2px' }}>{entry.assetName}</div>
                  )}
                  {entry.transporter && entry.transporter !== 'N/A' && (
                    <div style={{ fontSize: '11px', color: 'var(--cd-text-muted)', marginBottom: '2px' }}>{entry.transporter}</div>
                  )}
                  {hasDriver && (
                    <div style={{ fontSize: '11px', color: 'var(--cd-text-muted)', marginBottom: address ? '2px' : '0' }}>
                      👤 {entry.driverName}{entry.driverPhone && entry.driverPhone !== 'N/A' ? ` · ${entry.driverPhone}` : ''}
                    </div>
                  )}
                  {address && (
                    <div style={{ fontSize: '11px', color: 'var(--cd-text-muted)' }}>{address}</div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            {trendData.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--cd-text-muted)', fontSize: '13px' }}>
                No data for selected period
              </div>
            ) : (
              <>
                {/* Summary cards */}
                {summaryStats && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '16px' }}>
                    <div style={{ background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)', borderRadius: '10px', padding: '10px 12px' }}>
                      <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--cd-text)' }}>{summaryStats.total}</div>
                      <div style={{ fontSize: '10px', color: 'var(--cd-text-muted)', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '2px' }}>Total Events</div>
                    </div>
                    <div style={{ background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)', borderRadius: '10px', padding: '10px 12px' }}>
                      <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--cd-text)' }}>{summaryStats.avg}</div>
                      <div style={{ fontSize: '10px', color: 'var(--cd-text-muted)', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '2px' }}>Daily Average</div>
                    </div>
                    <div style={{ background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)', borderRadius: '10px', padding: '10px 12px' }}>
                      <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--cd-text)' }}>{summaryStats.peak['Total']}</div>
                      <div style={{ fontSize: '10px', color: 'var(--cd-text-muted)', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '2px' }}>Peak Day</div>
                      <div style={{ fontSize: '10px', color: '#64748b', marginTop: '3px' }}>{summaryStats.peak.date}</div>
                    </div>
                    <div style={{ background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)', borderRadius: '10px', padding: '10px 12px' }}>
                      <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--cd-text)' }}>{summaryStats.lowest['Total']}</div>
                      <div style={{ fontSize: '10px', color: 'var(--cd-text-muted)', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '2px' }}>Lowest Day</div>
                      <div style={{ fontSize: '10px', color: '#64748b', marginTop: '3px' }}>{summaryStats.lowest.date}</div>
                    </div>
                  </div>
                )}

                {/* Total toggle + chart label */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--cd-text-muted)', fontWeight: '500' }}>
                    Daily event frequency
                    {showTotal && <span style={{ color: '#0f172a', marginLeft: '6px' }}>— Total only</span>}
                    {!showTotal && activeFilter !== 'All' && (
                      <span style={{ color: EVENT_COLORS[activeFilter] || '#854F0B', marginLeft: '6px' }}>— {activeFilter} only</span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowTotal(prev => !prev)}
                    style={{
                      padding: '3px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: '500', cursor: 'pointer',
                      border: showTotal ? '0.5px solid #0f172a' : '0.5px solid var(--cd-border)',
                      background: showTotal ? '#0f172a' : 'var(--cd-surface-2)',
                      color: showTotal ? '#fff' : 'var(--cd-text-muted)',
                    }}
                  >
                    Total
                  </button>
                </div>

                <ResponsiveContainer width="100%" height={380}>
                  <LineChart data={trendData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--cd-border)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                      axisLine={false}
                      tickLine={false}
                      interval={trendData.length > 14 ? Math.floor(trendData.length / 7) : 0}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                      tickCount={8}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }} />
                    {activeLines.map(line => (
                      <Line
                        key={line}
                        type="linear"
                        dataKey={line}
                        stroke={EVENT_COLORS[line]}
                        strokeWidth={line === 'Total' ? 2.5 : 1.5}
                        strokeDasharray={line === 'Panic' ? '5 3' : undefined}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>

                <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '8px' }}>
                  Hover any point to see full breakdown. Select event type to isolate one line. Toggle Total for combined view.
                </div>
              </>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--cd-border)', fontSize: '11px', color: 'var(--cd-text-muted)', textAlign: 'center', flexShrink: 0 }}>
          {viewMode === 'events'
            ? `${filtered.length} event${filtered.length !== 1 ? 's' : ''} • auto-refreshes every 10s`
            : `${trendData.length} day${trendData.length !== 1 ? 's' : ''} of data • auto-refreshes every 10s`
          }
        </div>
      </div>
    </>
  );
}