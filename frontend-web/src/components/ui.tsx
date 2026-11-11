import React from 'react';

export const BadgeEstado: React.FC<{ estado: string }> = ({ estado }) => {
  const norm = String(estado || '').toLowerCase();
  if (['pagada', 'aprobado', 'entregada', 'finalizada', 'sincronizada', 'activo', 'abierta'].includes(norm)) {
    return <span className="fs-badge fs-badge-ok">{estado.toUpperCase()}</span>;
  }
  if (['pendiente_pago', 'no_confirmado', 'pendiente', 'preparada', 'en_atencion', 'trial'].includes(norm)) {
    return <span className="fs-badge fs-badge-warn">{estado.toUpperCase()}</span>;
  }
  return <span className="fs-badge fs-badge-danger">{estado.toUpperCase()}</span>;
};

export const KpiCard: React.FC<{
  titulo: string;
  valor: string | number;
  subtitulo?: string;
  color?: string;
}> = ({ titulo, valor, subtitulo, color = '#0f172a' }) => (
  <div className="fs-card" style={{ borderLeft: `4px solid ${color}` }}>
    <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>{titulo}</div>
    <div style={{ fontSize: '1.55rem', fontWeight: 800, color, margin: '0.25rem 0' }}>{valor}</div>
    {subtitulo && <div style={{ fontSize: '0.78rem', color: '#475569' }}>{subtitulo}</div>}
  </div>
);

export const QuotaBar: React.FC<{
  etiqueta: string;
  usado: number;
  maximo: number;
}> = ({ etiqueta, usado, maximo }) => {
  const ilimitado = maximo < 0;
  const pct = ilimitado ? 0 : Math.min(100, Math.round((usado / Math.max(1, maximo)) * 100));
  const barColor = pct >= 90 ? '#b91c1c' : pct >= 75 ? '#d97706' : '#15803d';
  return (
    <div style={{ marginBottom: '0.6rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: 4 }}>
        <span style={{ fontWeight: 600 }}>{etiqueta}</span>
        <span>{ilimitado ? `${usado} / Ilimitado` : `${usado} / ${maximo} (${pct}%)`}</span>
      </div>
      <div style={{ height: 8, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: ilimitado ? '100%' : `${pct}%`, height: '100%', background: ilimitado ? '#15803d' : barColor }} />
      </div>
    </div>
  );
};

export const Modal: React.FC<{
  abierto: boolean;
  titulo: string;
  onCerrar: () => void;
  children: React.ReactNode;
  anchoMax?: number;
}> = ({ abierto, titulo, onCerrar, children, anchoMax = 620 }) => {
  if (!abierto) return null;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.65)',
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={onCerrar}
    >
      <div
        className="fs-card"
        style={{
          width: '100%',
          maxWidth: anchoMax,
          maxHeight: '90vh',
          overflowY: 'auto',
          background: '#fff',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #e2e8f0',
            paddingBottom: '0.75rem',
            marginBottom: '1rem',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{titulo}</h3>
          <button className="fs-btn fs-btn-outline fs-btn-sm" onClick={onCerrar}>
            Cerrar ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};
