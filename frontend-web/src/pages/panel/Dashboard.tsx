import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { EmptyState, PanelHeader } from '../../components/panel';
import { KpiCard } from '../../components/ui';
import { useApp } from '../../context/App';
import { formatBs } from '../../lib/format';

export const DashboardPage: React.FC = () => {
  const { tenantSlug, suscripcion } = useApp();
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/reportes/dashboard', { tenantSlug })
      .then(setData)
      .catch((e) => setError(e?.message || 'No se pudo cargar el tablero.'));
  }, [tenantSlug]);

  if (error) {
    return <EmptyState mensaje={error} />;
  }
  if (!data) {
    return <div className="fs-card">Cargando tablero KPI...</div>;
  }

  return (
    <div className="fs-grid" style={{ gap: '1.25rem' }}>
      <PanelHeader
        titulo={`📊 Tablero KPI — ${data.tienda_nombre || tenantSlug}`}
        subtitulo="Ventas confirmadas, inventario físico, alertas de reposición y desempeño por sucursal."
        acciones={
          <Link to="/panel/reportes" className="fs-btn fs-btn-outline fs-btn-sm">
            🎙️ Ir a Reportes IA
          </Link>
        }
      />

      {suscripcion?.solo_lectura && (
        <div className="fs-banner-readonly" style={{ position: 'static' }}>
          Tienda en SOLO LECTURA (Trial vencido). Los reportes y exportaciones funcionan normalmente.
        </div>
      )}

      <div className="fs-grid-kpi">
        <KpiCard
          titulo="Ventas confirmadas"
          valor={data.ventas?.ventas_confirmadas ?? 0}
          subtitulo={`Pendientes de pago: ${data.ventas?.ventas_pendientes_pago ?? 0}`}
          color="#15803d"
        />
        <KpiCard
          titulo="Ingresos confirmados (BOB)"
          valor={formatBs(data.ventas?.ingresos_confirmados_bob ?? 0)}
          subtitulo={`Ticket promedio: ${formatBs(data.ventas?.ticket_promedio_bob ?? 0)}`}
          color="#b45309"
        />
        <KpiCard
          titulo="Unidades disponibles"
          valor={data.inventario?.unidades_disponibles ?? 0}
          subtitulo={`Físicas: ${data.inventario?.unidades_fisicas ?? 0} · Reservadas: ${data.inventario?.unidades_reservadas ?? 0}`}
          color="#1d4ed8"
        />
        <KpiCard
          titulo="Reservas activas"
          valor={data.reservas?.reservas_activas ?? 0}
          subtitulo={`SKUs bajo mínimo: ${data.inventario?.skus_alerta_minimo ?? 0}`}
          color="#7c3aed"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: '1.25rem' }}>
        <div className="fs-card">
          <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}>Ventas por Sucursal</h3>
          <table className="fs-table">
            <thead>
              <tr>
                <th>Sucursal</th>
                <th>Ventas</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {(data.ventas_por_sucursal || []).map((s: any) => (
                <tr key={s.sucursal_id}>
                  <td>{s.sucursal_nombre}</td>
                  <td>{s.cantidad_ventas}</td>
                  <td>{formatBs(s.total_bob)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="fs-card">
          <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}>Prendas Más Vendidas</h3>
          <table className="fs-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Unidades</th>
                <th>Ingresos</th>
              </tr>
            </thead>
            <tbody>
              {(data.top_productos || []).map((p: any) => (
                <tr key={p.id}>
                  <td>
                    {p.nombre} <code style={{ fontSize: '0.72rem' }}>{p.codigo}</code>
                  </td>
                  <td>{p.unidades_vendidas}</td>
                  <td>{formatBs(p.ingresos_bob)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="fs-card">
        <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}>
          🚨 Alertas de Reposición (Stock disponible ≤ mínimo)
        </h3>
        {(data.alertas_stock_bajo || []).length === 0 ? (
          <p style={{ color: '#15803d', fontWeight: 600 }}>Sin alertas críticas de stock. 🎉</p>
        ) : (
          <div className="fs-table-wrap">
            <table className="fs-table">
              <thead>
                <tr>
                  <th>Sucursal</th>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th>Talla/Color</th>
                  <th>Disponible</th>
                  <th>Mínimo</th>
                </tr>
              </thead>
              <tbody>
                {(data.alertas_stock_bajo || []).map((a: any, i: number) => (
                  <tr key={i}>
                    <td>{a.sucursal_nombre}</td>
                    <td>{a.sku}</td>
                    <td>{a.producto_nombre}</td>
                    <td>
                      {a.talla} / {a.color}
                    </td>
                    <td>
                      <strong style={{ color: '#b91c1c' }}>{a.stock_disponible}</strong>
                    </td>
                    <td>{a.stock_minimo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
export default DashboardPage;
