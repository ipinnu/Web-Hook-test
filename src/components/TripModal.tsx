export interface JourneyRecord {
  tripId: string;
  assetId: string | null;
  driverId: string | null;
  driverName: string;
  driverPhone: string;
  regNo: string;
  assetName: string;
  distanceKm: number;
  tripStart: string | null;
  tripEnd: string | null;
  drivingTimeSeconds: number | null;
  durationSeconds: number | null;
  maxSpeedKph: number | null;
  mergedCount: number;
}

export interface AssetSummary {
  assetId: string | null;
  regNo: string;
  assetName: string;
  totalDistanceKm: number;
  rawTripCount: number;
  journeyCount: number;
  totalDrivingTimeSeconds: number;
  avgSpeedKph: number | null;
  longestJourneyKm: number;
  drivers: string[];
  journeys: JourneyRecord[];
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatTripDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleString('en-GB', {
      timeZone: 'Africa/Lagos',
      day: '2-digit', month: 'short', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

interface Props {
  vehicleName: string;
  regNo: string;
  assetSummary: AssetSummary;
  distanceLabel: string;
  onClose: () => void;
}

export default function TripModal({ vehicleName, regNo, assetSummary, distanceLabel, onClose }: Props) {
  const sorted = [...assetSummary.journeys]
    .filter(j => j.distanceKm >= 0.5)
    .sort((a, b) => {
      const ta = a.tripEnd || a.tripStart || '';
      const tb = b.tripEnd || b.tripStart || '';
      return new Date(tb).getTime() - new Date(ta).getTime();
    });

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--cd-surface)', borderRadius: '14px', border: '1px solid var(--cd-border)', width: '100%', maxWidth: '760px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--cd-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>
              {vehicleName}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--cd-text-muted)', marginTop: '4px' }}>
              {regNo} · {sorted.length} journey{sorted.length !== 1 ? 's' : ''}
              {' · '}{sorted.reduce((s, j) => s + j.distanceKm, 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} km
              {assetSummary.avgSpeedKph != null && ` · avg ${assetSummary.avgSpeedKph} kph`}
              {' · '}{distanceLabel}
            </div>
            {assetSummary.drivers.length > 0 && (
              <div style={{ fontSize: '11px', color: 'var(--cd-text-soft)', marginTop: '4px' }}>
                Drivers: {assetSummary.drivers.join(', ')}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '20px', color: 'var(--cd-text-muted)', cursor: 'pointer', padding: '4px', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: '12px', padding: '10px 24px', fontSize: '11px', fontWeight: '600', color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--cd-border)', flexShrink: 0 }}>
          <div>Date</div>
          <div style={{ textAlign: 'right' }}>Distance</div>
          <div style={{ textAlign: 'right' }}>Duration</div>
          <div style={{ textAlign: 'right' }}>Avg Speed</div>
          <div style={{ textAlign: 'right' }}>Max Speed</div>
        </div>

        {/* Journey rows */}
        <div style={{ overflowY: 'auto', flexGrow: 1 }}>
          {sorted.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--cd-text-muted)' }}>No journeys in this range</div>
          ) : sorted.map((journey, i) => {
            const drivingHours = (journey.drivingTimeSeconds || 0) / 3600;
            const avgSpeed = drivingHours > 0 ? Math.round(journey.distanceKm / drivingHours) : null;
            return (
              <div
                key={journey.tripId}
                style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: '12px', padding: '12px 24px', borderBottom: i < sorted.length - 1 ? '1px solid var(--cd-border)' : 'none', alignItems: 'center' }}
              >
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '500', color: 'var(--cd-text)' }}>
                    {formatTripDate(journey.tripEnd || journey.tripStart)}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--cd-text-muted)', marginTop: '2px', display: 'flex', gap: '6px' }}>
                    {journey.driverName && journey.driverName !== 'N/A' && <span>{journey.driverName}</span>}
                    {journey.mergedCount > 1 && <span style={{ color: 'var(--cd-text-soft)' }}>· {journey.mergedCount} trips merged</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: '14px', fontWeight: '700', color: '#0d9488', fontVariantNumeric: 'tabular-nums' }}>
                  {journey.distanceKm.toLocaleString(undefined, { maximumFractionDigits: journey.distanceKm < 10 ? 1 : 0 })} km
                </div>
                <div style={{ textAlign: 'right', fontSize: '13px', color: 'var(--cd-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatDuration(journey.drivingTimeSeconds ?? journey.durationSeconds)}
                </div>
                <div style={{ textAlign: 'right', fontSize: '13px', color: 'var(--cd-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {avgSpeed != null ? `${avgSpeed} kph` : '—'}
                </div>
                <div style={{ textAlign: 'right', fontSize: '13px', color: 'var(--cd-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {journey.maxSpeedKph != null ? `${Math.round(journey.maxSpeedKph)} kph` : '—'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
