import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';
import { useApp } from '../context/App';
import { formatFecha } from '../lib/format';

export const CampanaNotificaciones: React.FC = () => {
  const { usuario, tenantSlug } = useApp();
  const [notificaciones, setNotificaciones] = useState<any[]>([]);
  const [abierto, setAbierto] = useState(false);

  const cargar = async () => {
    if (!usuario) return;
    try {
      const rows = await apiFetch('/notificaciones', { tenantSlug });
      setNotificaciones(Array.isArray(rows) ? rows : []);
    } catch {
      // Ignorar errores de red en segundo plano
    }
  };

  useEffect(() => {
    cargar();
  }, [usuario, tenantSlug]);

  if (!usuario) return null;

  const noLeidas = notificaciones.filter((n) => !n.leida).length;

  const marcarTodas = async () => {
    try {
      await apiFetch('/notificaciones/leer-todas', { method: 'PATCH', tenantSlug });
      setNotificaciones((prev) => prev.map((n) => ({ ...n, leida: true })));
    } catch {
      // Ignorar
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="fs-btn fs-btn-sm"
        style={{ background: 'rgba(255,255,255,0.14)' }}
        onClick={() => {
          setAbierto(!abierto);
          if (!abierto) cargar();
        }}
        title="Notificaciones de la tienda"
      >
        🔔 {noLeidas > 0 && <span className="fs-badge fs-badge-danger">{noLeidas}</span>}
      </button>

      {abierto && (
        <div
          className="fs-card"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            width: 340,
            maxHeight: 380,
            overflowY: 'auto',
            color: '#0f172a',
            zIndex: 70,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.6rem',
            }}
          >
            <strong style={{ fontSize: '0.9rem' }}>Notificaciones ({noLeidas} nuevas)</strong>
            {noLeidas > 0 && (
              <button className="fs-btn fs-btn-outline fs-btn-sm" onClick={marcarTodas}>
                Marcar leidas
              </button>
            )}
          </div>
          {notificaciones.length === 0 ? (
            <div style={{ fontSize: '0.84rem', color: '#64748b' }}>Sin notificaciones recientes.</div>
          ) : (
            notificaciones.slice(0, 12).map((n) => (
              <div
                key={n.id}
                style={{
                  padding: '0.5rem 0',
                  borderBottom: '1px solid #e2e8f0',
                  opacity: n.leida ? 0.7 : 1,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.84rem' }}>{n.titulo}</div>
                <div style={{ fontSize: '0.8rem', color: '#475569' }}>{n.mensaje}</div>
                <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                  {formatFecha(n.creado_en)}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
