import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import { BadgeEstado } from '../../components/ui';
import { useApp } from '../../context/App';
import { formatBs, formatFecha } from '../../lib/format';

export const MisReservasPage: React.FC = () => {
  const { tenantSlug, colaOffline, sincronizarColaOffline, mostrarToast } = useApp();
  const [reservas, setReservas] = useState<any[]>([]);

  const cargar = async () => {
    try {
      const rows = await apiFetch('/reservas/mias', { tenantSlug });
      setReservas(Array.isArray(rows) ? rows : []);
    } catch {
      // Offline
    }
  };

  useEffect(() => {
    cargar();
  }, [tenantSlug]);

  const cancelar = async (id: number) => {
    try {
      await apiFetch(`/reservas/${id}/cancelar`, { method: 'POST', tenantSlug });
      mostrarToast('Reserva cancelada y stock liberado.');
      cargar();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo cancelar la reserva.');
    }
  };

  const reservasOffline = colaOffline.filter((x) => x.tipo === 'reserva');

  return (
    <div className="fs-grid" style={{ gap: '1.5rem' }}>
      <div className="fs-card">
        <h1 style={{ margin: 0, fontSize: '1.45rem' }}>📅 Mis Reservas en Sucursal</h1>
        <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.88rem' }}>
          Prendas apartadas para prueba física en vestidor o retiro en tienda.
        </p>
      </div>

      {reservasOffline.length > 0 && (
        <div className="fs-card" style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>📡 Reservas en Cola Offline IndexedDB ({reservasOffline.length})</strong>
            <button className="fs-btn fs-btn-accent fs-btn-sm" onClick={sincronizarColaOffline}>
              Sincronizar Ahora
            </button>
          </div>
          <ul style={{ fontSize: '0.84rem', margin: '0.5rem 0 0' }}>
            {reservasOffline.map((op) => (
              <li key={op.id}>
                <code>{op.id}</code> — Estado: <strong>{op.estado.toUpperCase()}</strong>
                {op.detalle_error && ` (${op.detalle_error})`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {reservas.length === 0 ? (
        <div className="fs-card">No tienes reservas registradas en esta tienda.</div>
      ) : (
        <div className="fs-grid">
          {reservas.map((r) => (
            <div key={r.id} className="fs-card">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '0.6rem',
                }}
              >
                <div>
                  <strong>Código: {r.codigo}</strong> · Sucursal: {r.sucursal_nombre}
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    Cita: {formatFecha(r.fecha_cita)} · Expira: {formatFecha(r.expira_en)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <BadgeEstado estado={r.estado} />
                  {['pendiente', 'preparada'].includes(r.estado) && (
                    <button
                      className="fs-btn fs-btn-outline fs-btn-sm"
                      onClick={() => cancelar(r.id)}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </div>

              <div style={{ fontSize: '0.85rem' }}>
                {(r.items || []).map((it: any, idx: number) => (
                  <div key={idx}>
                    👗 {it.producto_nombre} ({it.sku} · Talla {it.talla} · {it.color}) × {it.cantidad}{' '}
                    — <strong>{formatBs(it.precio_unitario)}</strong>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
export default MisReservasPage;
