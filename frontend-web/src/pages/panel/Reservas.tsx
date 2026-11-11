import React, { useEffect, useState } from 'react';
import { EmptyState, PanelHeader } from '../../components/panel';
import { BadgeEstado } from '../../components/ui';
import { apiFetch } from '../../api/client';
import { useApp } from '../../context/App';
import { formatFecha } from '../../lib/format';

export const ReservasPanelPage: React.FC = () => {
  const { tenantSlug, mostrarToast } = useApp();
  const [reservas, setReservas] = useState<any[]>([]);

  const cargar = async () => {
    try {
      const rows = await apiFetch('/reservas', { tenantSlug });
      setReservas(Array.isArray(rows) ? rows : []);
    } catch {
      setReservas([]);
    }
  };

  useEffect(() => {
    cargar();
  }, [tenantSlug]);

  const accion = async (id: number, endpoint: string, msgOk: string) => {
    try {
      await apiFetch(`/reservas/${id}/${endpoint}`, { method: 'POST', tenantSlug });
      mostrarToast(msgOk);
      cargar();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo completar la acción.');
    }
  };

  const liberarVencidas = async () => {
    try {
      const res = await apiFetch('/reservas/liberar-vencidas', { method: 'POST', tenantSlug });
      mostrarToast(`Reservas vencidas liberadas: ${res?.liberadas ?? 0}`);
      cargar();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo liberar vencidas.');
    }
  };

  return (
    <div className="fs-grid" style={{ gap: '1.25rem' }}>
      <PanelHeader
        titulo="📅 Atención de Reservas"
        subtitulo="Flujo operativo: pendiente → preparar → confirmar atención → finalizar."
        acciones={
          <button className="fs-btn fs-btn-outline fs-btn-sm" onClick={liberarVencidas}>
            ⏰ Liberar Vencidas
          </button>
        }
      />

      {reservas.length === 0 ? (
        <EmptyState mensaje="No hay reservas pendientes de atención." />
      ) : (
        <div className="fs-table-wrap">
          <table className="fs-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Cliente</th>
                <th>Sucursal</th>
                <th>Cita</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {reservas.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.codigo}</strong>
                  </td>
                  <td>{r.usuario_nombre || r.cliente_nombre || 'Cliente'}</td>
                  <td>{r.sucursal_nombre || `Sucursal #${r.sucursal_id}`}</td>
                  <td>{formatFecha(r.fecha_cita)}</td>
                  <td>
                    <BadgeEstado estado={r.estado} />
                  </td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {r.estado === 'pendiente' && (
                      <button
                        className="fs-btn fs-btn-sm"
                        onClick={() => accion(r.id, 'preparar', 'Reserva marcada como preparada.')}
                      >
                        Preparar
                      </button>
                    )}
                    {['pendiente', 'preparada'].includes(r.estado) && (
                      <button
                        className="fs-btn fs-btn-sm"
                        style={{ background: '#1d4ed8' }}
                        onClick={() =>
                          accion(r.id, 'confirmar-atencion', 'Atención confirmada en sucursal.')
                        }
                      >
                        Confirmar Atención
                      </button>
                    )}
                    {!['cancelada', 'vencida', 'finalizada'].includes(r.estado) && (
                      <>
                        <button
                          className="fs-btn fs-btn-accent fs-btn-sm"
                          onClick={() => accion(r.id, 'finalizar', 'Reserva finalizada.')}
                        >
                          Finalizar
                        </button>
                        <button
                          className="fs-btn fs-btn-outline fs-btn-sm"
                          onClick={() => accion(r.id, 'cancelar', 'Reserva cancelada.')}
                        >
                          Cancelar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
export default ReservasPanelPage;
