import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import { ModalComprobante } from '../../components/Comprobante';
import { BadgeEstado } from '../../components/ui';
import { useApp } from '../../context/App';
import { formatBs, formatFecha } from '../../lib/format';

export const MisPedidosPage: React.FC = () => {
  const { tenantSlug } = useApp();
  const [pedidos, setPedidos] = useState<any[]>([]);
  const [comprobanteVentaId, setComprobanteVentaId] = useState<number | null>(null);

  useEffect(() => {
    apiFetch('/ventas/mias', { tenantSlug })
      .then((rows) => setPedidos(Array.isArray(rows) ? rows : []))
      .catch(() => setPedidos([]));
  }, [tenantSlug]);

  return (
    <div className="fs-grid" style={{ gap: '1.25rem' }}>
      <div className="fs-card">
        <h1 style={{ margin: 0, fontSize: '1.45rem' }}>📦 Mis Pedidos y Comprobantes</h1>
        <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.88rem' }}>
          Historial de compras con estado de pago validado directamente en la pasarela Sandbox.
        </p>
      </div>

      {pedidos.length === 0 ? (
        <div className="fs-card">Aún no has realizado compras en esta tienda.</div>
      ) : (
        <div className="fs-table-wrap">
          <table className="fs-table">
            <thead>
              <tr>
                <th>Comprobante</th>
                <th>Fecha</th>
                <th>Total</th>
                <th>Método / Pasarela</th>
                <th>Estado Comercial</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.numero_comprobante}</strong>
                  </td>
                  <td>{formatFecha(p.creado_en)}</td>
                  <td>{formatBs(p.total)}</td>
                  <td>
                    {String(p.metodo_pago || 'qr').toUpperCase()} · {p.pasarela || 'sandbox'}
                  </td>
                  <td>
                    <BadgeEstado estado={p.estado} />
                  </td>
                  <td>
                    <button
                      className="fs-btn fs-btn-outline fs-btn-sm"
                      onClick={() => setComprobanteVentaId(p.id)}
                    >
                      🧾 Ver Comprobante
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ModalComprobante ventaId={comprobanteVentaId} onCerrar={() => setComprobanteVentaId(null)} />
    </div>
  );
};
export default MisPedidosPage;
