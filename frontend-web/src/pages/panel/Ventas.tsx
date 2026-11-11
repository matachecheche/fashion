import React, { useEffect, useState } from 'react';
import { ModalComprobante } from '../../components/Comprobante';
import { EmptyState, PanelHeader } from '../../components/panel';
import { BadgeEstado, Modal } from '../../components/ui';
import { apiFetch } from '../../api/client';
import { useApp } from '../../context/App';
import { formatBs, formatFecha } from '../../lib/format';

export const VentasPage: React.FC = () => {
  const { tenantSlug, mostrarToast } = useApp();
  const [ventas, setVentas] = useState<any[]>([]);
  const [sagas, setSagas] = useState<any[]>([]);
  const [comprobanteId, setComprobanteId] = useState<number | null>(null);
  const [ventaDevolucion, setVentaDevolucion] = useState<any | null>(null);
  const [motivo, setMotivo] = useState('Cambio de talla solicitado en tienda');
  const [procesando, setProcesando] = useState(false);

  const cargar = async () => {
    try {
      const [rows, sagaRows] = await Promise.all([
        apiFetch('/ventas', { tenantSlug }),
        apiFetch('/pagos/sagas', { tenantSlug }).catch(() => []),
      ]);
      setVentas(Array.isArray(rows) ? rows : []);
      setSagas(Array.isArray(sagaRows) ? sagaRows : []);
    } catch {
      setVentas([]);
      setSagas([]);
    }
  };

  useEffect(() => {
    cargar();
  }, [tenantSlug]);

  const entregar = async (id: number) => {
    try {
      await apiFetch(`/ventas/${id}/entregar`, { method: 'POST', tenantSlug });
      mostrarToast('Venta marcada como entregada al cliente.');
      cargar();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo entregar (¿está confirmado el pago?).');
    }
  };

  const reembolsarSandbox = async (saga: any) => {
    const pagoId = Number(saga?.pago_id);
    if (!Number.isInteger(pagoId) || pagoId < 1) return;
    if (!window.confirm('Esto simula un reembolso en FashionStore Sandbox. No se transfiere dinero ni se contacta a la pasarela. ¿Continuar?')) return;
    setProcesando(true);
    try {
      const result = await apiFetch(`/pagos/${pagoId}/reembolsar-sandbox`, {
        method: 'POST',
        tenantSlug,
        body: { motivo: 'Compensación sandbox registrada desde el panel web.' },
      });
      mostrarToast(result?.idempotent_replay ? 'El reembolso sandbox ya estaba registrado.' : 'Reembolso sandbox registrado; no hubo movimiento de dinero real.');
      await cargar();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo registrar la compensación sandbox.');
    } finally {
      setProcesando(false);
    }
  };

  const devolver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ventaDevolucion) return;
    setProcesando(true);
    try {
      const res = await apiFetch(`/ventas/${ventaDevolucion.id}/devolucion`, {
        method: 'POST',
        tenantSlug,
        body: { motivo },
      });
      mostrarToast(
        res?.mensaje || `Devolución registrada. Monto: ${formatBs(res?.monto_reembolsado ?? ventaDevolucion.total)}`,
      );
      setVentaDevolucion(null);
      cargar();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo procesar la devolución.');
    } finally {
      setProcesando(false);
    }
  };

  const sagasRequierenIntervencion = sagas.filter((saga) => saga.estado === 'REQUIERE_INTERVENCION');

  return (
    <div className="fs-grid" style={{ gap: '1.25rem' }}>
      <PanelHeader
        titulo="🧾 Ventas y Devoluciones"
        subtitulo="Historial del tenant. Las devoluciones reponen inventario; pasarelas sandbox solo simulan reembolso sin mover dinero real y el efectivo requiere registro manual."
      />

      {sagasRequierenIntervencion.length > 0 && (
        <div className="fs-card fs-grid" style={{ gap: '0.75rem' }}>
          <h3 style={{ margin: 0 }}>⚠️ Pagos confirmados que requieren compensación</h3>
          <p style={{ margin: 0, color: '#475569' }}>La acción siguiente es solo una simulación local de sandbox: no transfiere dinero ni contacta a Stripe/LIBELULA.</p>
          {sagasRequierenIntervencion.map((saga) => (
            <div key={saga.saga_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderTop: '1px solid #e2e8f0', paddingTop: 8 }}>
              <div><strong>{saga.operacion_id}</strong><div style={{ fontSize: '0.82rem', color: '#64748b' }}>Pago #{saga.pago_id} · {saga.ultimo_error || 'requiere revisión'}</div></div>
              <button className="fs-btn fs-btn-danger fs-btn-sm" disabled={procesando} onClick={() => void reembolsarSandbox(saga)}>Registrar reembolso sandbox</button>
            </div>
          ))}
        </div>
      )}

      {ventas.length === 0 ? (
        <EmptyState mensaje="Aún no hay ventas registradas en este tenant." />
      ) : (
        <div className="fs-table-wrap">
          <table className="fs-table">
            <thead>
              <tr>
                <th>Comprobante</th>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Total</th>
                <th>Método</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {ventas.map((v) => (
                <tr key={v.id}>
                  <td>
                    <strong>{v.numero_comprobante}</strong>
                  </td>
                  <td>{formatFecha(v.creado_en)}</td>
                  <td>{v.cliente_nombre || 'Consumidor Final'}</td>
                  <td>{formatBs(v.total)}</td>
                  <td>{String(v.metodo_pago || '').toUpperCase()}</td>
                  <td>
                    <BadgeEstado estado={v.estado} />
                  </td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      className="fs-btn fs-btn-outline fs-btn-sm"
                      onClick={() => setComprobanteId(v.id)}
                    >
                      🧾
                    </button>
                    {['pagada', 'lista_retiro'].includes(v.estado) && (
                      <button className="fs-btn fs-btn-sm" onClick={() => entregar(v.id)}>
                        Entregar
                      </button>
                    )}
                    {v.estado !== 'reembolsada' && v.estado !== 'cancelada' && (
                      <button
                        className="fs-btn fs-btn-danger fs-btn-sm"
                        onClick={() => setVentaDevolucion(v)}
                      >
                        Devolver
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ModalComprobante ventaId={comprobanteId} onCerrar={() => setComprobanteId(null)} />

      <Modal
        abierto={Boolean(ventaDevolucion)}
        titulo={`Procesar Devolución — ${ventaDevolucion?.numero_comprobante || ''}`}
        onCerrar={() => setVentaDevolucion(null)}
      >
        <form onSubmit={devolver} className="fs-grid" style={{ gap: '0.8rem' }}>
          <p style={{ fontSize: '0.88rem', margin: 0 }}>
            Se devolverá el stock a los almacenes origen y se marcará la venta como{' '}
            <code>reembolsada</code>. Monto: <strong>{formatBs(ventaDevolucion?.total)}</strong>.
          </p>
          <div>
            <label style={{ fontSize: '0.84rem', fontWeight: 600 }}>Motivo de la devolución</label>
            <input className="fs-input" required value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <button type="submit" className="fs-btn fs-btn-danger" disabled={procesando}>
            {procesando ? 'Procesando...' : 'Confirmar Devolución'}
          </button>
        </form>
      </Modal>
    </div>
  );
};
export default VentasPage;
