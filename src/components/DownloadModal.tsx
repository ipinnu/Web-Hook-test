import { useState } from 'react';
import { X } from 'lucide-react';

declare const jspdf: any;

interface Props {
  onClose: () => void;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
}

type DateRange = 'today' | '7days' | '30days' | 'alltime' | 'custom';
type Format = 'csv' | 'excel' | 'pdf';

const EVENT_TYPES = ['Panic', 'Harsh Braking', 'Harsh Acceleration', 'Overspeeding', 'Overspeed Tiered', 'Harsh Cornering'];
const HIDDEN_LABELS = ['Possible Power Tamper', 'Battery Disconnection', 'Battery Disconnected', 'Front Panel Tamper', 'Back Panel Tamper', 'No Blue Key'];

const COLUMNS = [
  { header: 'Asset Name', get: (e: any) => e.assetName || 'N/A' },
  { header: 'Reg No', get: (e: any) => e.regNo || 'N/A' },
  { header: 'Transporter', get: (e: any) => e.transporter || 'N/A' },
  { header: 'Driver', get: (e: any) => e.driverName || 'N/A' },
  { header: 'Phone', get: (e: any) => e.driverPhone || 'N/A' },
  { header: 'Event', get: (e: any) => e.label || 'Panic' },
  { header: 'Event Time', get: (e: any) => e.eventTime ? new Date(e.eventTime).toLocaleString('en-GB') : 'N/A' },
  { header: 'Location', get: (e: any) => {
  if (e.address && e.address !== 'N/A' && e.address !== 'null') return e.address;
  if (e.latitude && e.longitude) return `${Number(e.latitude).toFixed(5)}, ${Number(e.longitude).toFixed(5)}`;
  return 'N/A';
}},
];

// Columns where values must be forced as text in CSV/Excel (phone numbers, large IDs)
const TEXT_FORCE_COLUMNS = ['Phone', 'Reg No'];

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
    const ts = new Date(entry.eventTime || entry.timestamp).getTime();
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

      const filtered = allEntries.filter(e => {
        const label = e.label || 'Panic';
        if (HIDDEN_LABELS.includes(label)) return false;
        const matchesEvent = selectedEvents.some(sel =>
          sel === 'Panic' ? e.type === 'panic' : label === sel
        );
        const matchesVehicle = selectedVehicles.length === 0 ||
          selectedVehicles.some(v =>
            (e.regNo && e.regNo.toUpperCase().includes(v)) ||
            (e.assetName && e.assetName.toUpperCase().includes(v)) ||
            (e.assetId && e.assetId.includes(v)) ||
            (e.driverName && e.driverName.toUpperCase().includes(v))
          );
        return matchesEvent && matchesVehicle && getDateFilter(e);
      });

      if (format === 'csv') downloadCSV(filtered);
      else if (format === 'excel') downloadExcel(filtered);
      else if (format === 'pdf') downloadPDF(filtered);
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setDownloading(false);
    }
  };

  const downloadCSV = (entries: any[]) => {
    const headers = COLUMNS.map(c => `"${c.header}"`);
    const rows = entries.map(e => COLUMNS.map(c => {
      const val = String(c.get(e));
      const escaped = val.replace(/"/g, '""');
      // Prefix phone numbers and reg nos with = to force text in Excel
      if (TEXT_FORCE_COLUMNS.includes(c.header) && val !== 'N/A') {
        return `"=""${escaped}"""`;
      }
      return `"${escaped}"`;
    }));
    const csv = '\uFEFF' + [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cnl-fleet-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

const downloadExcel = (entries: any[]) => {
  const wb = (window as any).XLSX.utils.book_new();
  const wsData = [
    COLUMNS.map(c => c.header),
    ...entries.map(e => COLUMNS.map(c => {
      const val = c.get(e);
      if (c.header === 'Phone' && val !== 'N/A') return { v: val, t: 's' };
      return String(val);
    }))
  ];
  const ws = (window as any).XLSX.utils.aoa_to_sheet(wsData);
  (window as any).XLSX.utils.book_append_sheet(wb, ws, 'Fleet Report');
  (window as any).XLSX.writeFile(wb, `cnl-fleet-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
};

  const downloadPDF = (entries: any[]) => {
    try {
      const { jsPDF } = jspdf;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      doc.setFontSize(16);
      doc.setTextColor(200, 16, 46);
      doc.text('CNL Fleet Event Report', 14, 16);

      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(`Generated: ${new Date().toLocaleString('en-GB')} • ${entries.length} event${entries.length !== 1 ? 's' : ''}`, 14, 23);

      const filterSummary = [
        `Date: ${dateRange === 'today' ? 'Today' : dateRange === '7days' ? 'Last 7 days' : dateRange === '30days' ? 'Last 30 days' : dateRange === 'alltime' ? 'All time' : `${fromDate} to ${toDate}`}`,
        `Events: ${selectedEvents.join(', ')}`,
        selectedVehicles.length > 0 ? `Vehicles: ${selectedVehicles.join(', ')}` : 'Vehicles: All',
      ].join('  •  ');
      doc.text(filterSummary, 14, 29);

      const headers = COLUMNS.map(c => c.header);
      const rows = entries.map(e => COLUMNS.map(c => String(c.get(e))));

      (doc as any).autoTable({
        head: [headers],
        body: rows,
        startY: 34,
        styles: { fontSize: 7, cellPadding: 2 },
        headStyles: {
          fillColor: [241, 245, 249],
          textColor: [100, 116, 139],
          fontStyle: 'bold',
          fontSize: 7,
        },
        columnStyles: {
          0: { cellWidth: 30 },
          1: { cellWidth: 22 },
          2: { cellWidth: 25 },
          3: { cellWidth: 28 },
          4: { cellWidth: 25 },
          5: { cellWidth: 22 },
          6: { cellWidth: 28 },
          7: { cellWidth: 'auto' },
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        didParseCell: (data: any) => {
          if (data.section === 'body' && data.column.index === 5) {
            const isPanic = entries[data.row.index]?.type === 'panic';
            data.cell.styles.textColor = isPanic ? [200, 16, 46] : [133, 79, 11];
            data.cell.styles.fontStyle = 'bold';
          }
        },
      });

      doc.save(`cnl-fleet-report-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error('PDF generation failed:', err);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}>
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
                <button key={r} onClick={() => setDateRange(r)}
                  style={{ padding: '5px 12px', borderRadius: '9999px', fontSize: '12px', cursor: 'pointer', border: dateRange === r ? '0.5px solid var(--cd-accent-2)' : '0.5px solid var(--cd-border)', background: dateRange === r ? '#eff6ff' : 'var(--cd-surface-2)', color: dateRange === r ? '#2563eb' : 'var(--cd-text-muted)', fontWeight: dateRange === r ? '500' : '400' }}>
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
                  <button key={evt} onClick={() => toggleEvent(evt)}
                    style={{ padding: '5px 12px', borderRadius: '9999px', fontSize: '12px', cursor: 'pointer', border: selected ? `0.5px solid ${isPanic ? '#fecdd3' : '#fde68a'}` : '0.5px solid var(--cd-border)', background: selected ? (isPanic ? '#fff1f2' : '#fef3c7') : 'var(--cd-surface-2)', color: selected ? (isPanic ? '#c8102e' : '#854F0B') : 'var(--cd-text-muted)', fontWeight: selected ? '500' : '400' }}>
                    {selected ? '✓ ' : ''}{evt}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Vehicles */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: '500', color: 'var(--cd-text-muted)', display: 'block', marginBottom: '8px' }}>Filter <span style={{ fontWeight: '400' }}>(leave empty for all)</span></label>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
              <input type="text" placeholder="Type reg no, asset name, or driver..." value={vehicleSearch}
                onChange={e => setVehicleSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addVehicle()}
                style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--cd-border)', borderRadius: '8px', fontSize: '12px', backgroundColor: 'var(--cd-surface-2)', color: 'var(--cd-text)', outline: 'none' }} />
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
                <button key={f} onClick={() => setFormat(f)}
                  style={{ padding: '5px 16px', borderRadius: '9999px', fontSize: '12px', cursor: 'pointer', border: format === f ? '0.5px solid var(--cd-accent-2)' : '0.5px solid var(--cd-border)', background: format === f ? '#eff6ff' : 'var(--cd-surface-2)', color: format === f ? '#2563eb' : 'var(--cd-text-muted)', fontWeight: format === f ? '500' : '400', textTransform: 'uppercase' }}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Download Button */}
          <button onClick={handleDownload} disabled={downloading || selectedEvents.length === 0}
            style={{ width: '100%', padding: '11px', background: downloading || selectedEvents.length === 0 ? 'var(--cd-surface-2)' : '#c8102e', color: downloading || selectedEvents.length === 0 ? 'var(--cd-text-muted)' : '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: downloading || selectedEvents.length === 0 ? 'not-allowed' : 'pointer', marginTop: '4px' }}>
            {downloading ? 'Preparing...' : 'Download Report'}
          </button>

        </div>
      </div>
    </div>
  );
}