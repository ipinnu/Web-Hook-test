import { useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  onClose: () => void;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
}

type DateRange = 'today' | '7days' | '30days' | 'alltime' | 'custom';
type Format = 'csv' | 'excel' | 'pdf';

const EVENT_TYPES = ['Panic', 'Harsh Brake', 'Harsh Accel', 'Overspeed', 'Overspeed Tiered', 'Harsh Corner'];

export default function DownloadModal({ onClose, authFetch }: Props) {
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([...EVENT_TYPES]);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [selectedVehicles, setSelectedVehicles] = useState<string[]>([]);
  const [format, setFormat] = useState<Format>('csv');
  const [downloading, setDownloading] = useState(false);

  const toggleEvent = (evt: string) => {
    setSelectedEvents(prev =>
      prev.includes(evt) ? prev.filter(e => e !== evt) : [...prev, evt]
    );
  };

  const addVehicle = () => {
    const v = vehicleSearch.trim().toUpperCase();
    if (v && !selectedVehicles.includes(v)) {
      setSelectedVehicles(prev => [...prev, v]);
      setVehicleSearch('');
    }
  };

  const removeVehicle = (v: string) => {
    setSelectedVehicles(prev => prev.filter(x => x !== v));
  };

  const getDateFilter = (entry: any): boolean => {
    const ts = new Date(entry.timestamp).getTime();
    const now = Date.now();
    if (dateRange === 'today') {
      const start = new Date(); start.setHours(0, 0, 0, 0);
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

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await authFetch('/api/events/log');
      if (!res.ok) throw new Error('Failed to fetch logs');
      const allEntries: any[] = await res.json();

      let filtered = allEntries.filter(e => {
        const label = e.label || 'Panic';
        const matchesEvent = selectedEvents.some(sel =>
          sel === 'Panic' ? e.type === 'panic' : label === sel
        );
        const matchesVehicle = selectedVehicles.length === 0 ||
          selectedVehicles.some(v =>
            e.assetId?.includes(v) ||
            e.rawEvent?.AssetId?.includes(v)
          );
        return matchesEvent && matchesVehicle && getDateFilter(e);
      });

      if (format === 'csv') {
        downloadCSV(filtered);
      } else if (format === 'excel') {
        downloadCSV(filtered, true);
      } else if (format === 'pdf') {
        downloadPDF(filtered);
      }
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setDownloading(false);
    }
  };

  const downloadCSV = (entries: any[], asExcel = false) => {
    const headers = ['Timestamp', 'Type', 'Event', 'Asset ID', 'Event Time', 'Received At', 'Latitude', 'Longitude', 'Address'];
    const rows = entries.map(e => [
      e.timestamp,
      e.type,
      e.label || 'Panic',
      e.assetId,
      e.eventTime,
      e.receivedAt || '',
      e.rawEvent?.Position?.Latitude || '',
      e.rawEvent?.Position?.Longitude || '',
      e.rawEvent?.Position?.FormattedAddress || '',
    ]);

    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: asExcel ? 'application/vnd.ms-excel' : 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cnl-fleet-report-${new Date().toISOString().slice(0, 10)}.${asExcel ? 'xls' : 'csv'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPDF = (entries: any[]) => {
    const rows = entries.map(e => `
      <tr>
        <td>${new Date(e.timestamp).toLocaleString('en-GB')}</td>
        <td style="color:${e.type === 'panic' ? '#c8102e' : '#854F0B'};font-weight:600">${e.label || 'Panic'}</td>
        <td>${e.assetId}</td>
        <td>${e.eventTime ? new Date(e.eventTime).toLocaleString('en-GB') : ''}</td>
        <td>${e.rawEvent?.Position?.FormattedAddress || ''}</td>
      </tr>
    `).join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>CNL Fleet Report</title>
        <style>
          body { font-family: Arial, sans-serif; font-size: 12px; color: #0f172a; margin: 32px; }
          h1 { font-size: 18px; color: #c8102e; margin-bottom: 4px; }
          p { color: #64748b; margin-bottom: 20px; font-size: 11px; }
          table { width: 100%; border-collapse: collapse; }
          th { background: #f1f5f9; padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; border-bottom: 1px solid #e2e8f0; }
          td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
          tr:nth-child(even) { background: #f8fafc; }
        </style>
      </head>
      <body>
        <h1>CNL Fleet Event Report</h1>
        <p>Generated: ${new Date().toLocaleString('en-GB')} • ${entries.length} events</p>
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Event</th>
              <th>Asset ID</th>
              <th>Event Time</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </body>
      </html>
    `;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) {
      win.onload = () => {
        win.print();
        URL.revokeObjectURL(url);
      };
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: '16px' }}>
      <div style={{ backgroundColor: 'var(--cd-surface)', borderRadius: '14px', border: '1px solid var(--cd-border)', padding: '24px', width: '100%', maxWidth: '420px', maxHeight: '90vh', overflowY: 'auto', boxShadow: 'var(--cd-card-shadow)' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <span style={{ fontSize: '16px', fontWeight: '600', color: 'var(--cd-text)' }}>Download Report</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cd-text-muted)' }}>
            <X style={{ width: '20px', height: '20px' }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Date Range */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: '500', color: 'var(--cd-text-muted)', display: 'block', marginBottom: '8px' }}>Date range</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
              {(['today', '7days', '30days', 'alltime', 'custom'] as DateRange[]).map(r => (
                <button
                  key={r}
                  onClick={() => setDateRange(r)}
                  style={{ padding: '5px 12px', borderRadius: '9999px', fontSize: '12px', cursor: 'pointer', border: dateRange === r ? '0.5px solid var(--cd-accent-2)' : '0.5px solid var(--cd-border)', background: dateRange === r ? '#eff6ff' : 'var(--cd-surface-2)', color: dateRange === r ? '#2563eb' : 'var(--cd-text-muted)', fontWeight: dateRange === r ? '500' : '400' }}
                >
                  {r === 'today' ? 'Today' : r === '7days' ? '7 days' : r === '30days' ? '30 days' : r === 'alltime' ? 'All time' : 'Custom'}
                </button>
              ))}
            </div>
            {dateRange === 'custom' && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: 'var(--cd-text-muted)', display: 'block', marginBottom: '3px' }}>From</label>
                  <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--cd-border)', borderRadius: '8px', fontSize: '12px', backgroundColor: 'var(--cd-surface-2)', color: 'var(--cd-text)', outline: 'none' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: 'var(--cd-text-muted)', display: 'block', marginBottom: '3px' }}>To</label>
                  <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--cd-border)', borderRadius: '8px', fontSize: '12px', backgroundColor: 'var(--cd-surface-2)', color: 'var(--cd-text)', outline: 'none' }} />
                </div>
              </div>
            )}
          </div>

          {/* Event Types */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: '500', color: 'var(--cd-text-muted)', display: 'block', marginBottom: '8px' }}>Event types</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {EVENT_TYPES.map(evt => {
                const selected = selectedEvents.includes(evt);
                const isPanic = evt === 'Panic';
                return (
                  <button
                    key={evt}
                    onClick={() => toggleEvent(evt)}
                    style={{ padding: '5px 12px', borderRadius: '9999px', fontSize: '12px', cursor: 'pointer', border: selected ? `0.5px solid ${isPanic ? '#fecdd3' : '#fde68a'}` : '0.5px solid var(--cd-border)', background: selected ? (isPanic ? '#fff1f2' : '#fef3c7') : 'var(--cd-surface-2)', color: selected ? (isPanic ? '#c8102e' : '#854F0B') : 'var(--cd-text-muted)', fontWeight: selected ? '500' : '400' }}
                  >
                    {selected ? '✓ ' : ''}{evt}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Vehicles */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: '500', color: 'var(--cd-text-muted)', display: 'block', marginBottom: '8px' }}>Vehicles <span style={{ fontWeight: '400' }}>(leave empty for all)</span></label>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
              <input
                type="text"
                placeholder="Type reg no or asset ID..."
                value={vehicleSearch}
                onChange={e => setVehicleSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addVehicle()}
                style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--cd-border)', borderRadius: '8px', fontSize: '12px', backgroundColor: 'var(--cd-surface-2)', color: 'var(--cd-text)', outline: 'none' }}
              />
              <button onClick={addVehicle} style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid var(--cd-border)', background: 'var(--cd-surface-2)', color: 'var(--cd-text)', cursor: 'pointer', fontSize: '12px' }}>Add</button>
            </div>
            {selectedVehicles.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {selectedVehicles.map(v => (
                  <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: '500', background: '#eff6ff', color: '#2563eb', border: '0.5px solid #bfdbfe' }}>
                    {v}
                    <button onClick={() => removeVehicle(v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', fontSize: '13px', lineHeight: 1, padding: 0 }}>✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Format */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: '500', color: 'var(--cd-text-muted)', display: 'block', marginBottom: '8px' }}>Format</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['csv', 'excel', 'pdf'] as Format[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  style={{ padding: '5px 16px', borderRadius: '9999px', fontSize: '12px', cursor: 'pointer', border: format === f ? '0.5px solid var(--cd-accent-2)' : '0.5px solid var(--cd-border)', background: format === f ? '#eff6ff' : 'var(--cd-surface-2)', color: format === f ? '#2563eb' : 'var(--cd-text-muted)', fontWeight: format === f ? '500' : '400', textTransform: 'uppercase' }}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Download Button */}
          <button
            onClick={handleDownload}
            disabled={downloading || selectedEvents.length === 0}
            style={{ width: '100%', padding: '11px', background: downloading || selectedEvents.length === 0 ? 'var(--cd-surface-2)' : '#c8102e', color: downloading || selectedEvents.length === 0 ? 'var(--cd-text-muted)' : '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: downloading || selectedEvents.length === 0 ? 'not-allowed' : 'pointer', marginTop: '4px' }}
          >
            {downloading ? 'Preparing...' : 'Download Report'}
          </button>

        </div>
      </div>
    </div>
  );
}