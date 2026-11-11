import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';
import { useApp } from '../context/App';
import { formatBs, formatFecha } from '../lib/format';
import { BadgeEstado, Modal } from './ui';

export const ModalComprobante: React.FC<{
  ventaId: number | null;
  onCerrar: () => void;
}> = ({ ventaId, onCerrar }) => {
  const { tenantSlug } = useApp();
  const [datos, setDatos] = useState<any | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!ventaId) return;
    setCargando(true);
    apiFetch(`/ventas/${ventaId}/comprobante`, { tenantSlug })
      .then((res) => setDatos(res))
      .catch(() => setDatos(null))
      .finally(() => setCargando(false));
  }, [ventaId, tenantSlug]);

  return (
    <Modal
      abierto={Boolean(ventaId)}
      titulo="🧾 Comprobante de Transacción Comercial"
      onCerrar={onCerrar}
      anchoMax={560}
    >
      {cargando && <div>Cargando comprobante...</div>}
      {!cargando && datos && (
        <div style={{ fontSize: '0.88rem' }}>
          <div
            style={{
              textAlign: 'center',
              borderBottom: '1px dashed #cbd5e1',
              paddingBottom: '0.75rem',
              marginBottom: '0.75rem',
            }}
          >
            <h3 style={{ margin: 0 }}>{datos.tienda?.nombre}</h3>
            <div style={{ color: '#64748b', fontSize: '0.8rem' }}>
              Tenant: <code>{datos.tienda?.slug}</code> | Comprobante:{' '}
              <strong>{datos.comprobante?.numero}</strong>
            </div>
            <div style={{ marginTop: 6 }}>
              <BadgeEstado estado={datos.comprobante?.estado_pago} />{' '}
              <span style={{ fontWeight: 700, marginLeft: 6 }}>
                {datos.comprobante?.etiqueta_estado}
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: '0.85rem' }}>
            <div>
              <strong>Cliente:</strong> {datos.comprobante?.cliente_nombre}
            </div>
            <div>
              <strong>NIT/CI:</strong> {datos.comprobante?.cliente_nit}
            </div>
            <div>
              <strong>Fecha:</strong> {formatFecha(datos.comprobante?.fecha)}
            </div>
            <div>
              <strong>Método:</strong> {String(datos.comprobante?.metodo_pago).toUpperCase()}
            </div>
          </div>

          <table className="fs-table" style={{ marginBottom: '0.85rem' }}>
            <thead>
              <tr>
                <th>Prenda / SKU</th>
                <th>Cant.</th>
                <th>P. Unit</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {(datos.comprobante?.items || []).map((it: any, idx: number) => (
                <tr key={idx}>
                  <td>
                    {it.producto_nombre} ({it.talla}/{it.color})
                  </td>
                  <td>{it.cantidad}</td>
                  <td>{formatBs(it.precio_unitario)}</td>
                  <td>{formatBs(it.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ textAlign: 'right', fontSize: '0.95rem' }}>
            <div>Subtotal: {formatBs(datos.comprobante?.subtotal)}</div>
            <div>Descuento: -{formatBs(datos.comprobante?.descuento)}</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, marginTop: 4 }}>
              Total: {formatBs(datos.comprobante?.total)}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};
