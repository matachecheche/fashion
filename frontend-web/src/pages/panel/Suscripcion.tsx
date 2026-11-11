import React, { useEffect, useState } from 'react';
import { PanelHeader } from '../../components/panel';
import { QuotaBar } from '../../components/ui';
import { apiFetch } from '../../api/client';
import { useApp } from '../../context/App';
import { formatBs } from '../../lib/format';

export const SuscripcionPage: React.FC = () => {
  const { tenantSlug, suscripcion, recargarSuscripcion, usuario, mostrarToast } = useApp();
  const [planes, setPlanes] = useState<any[]>([]);
  const [procesando, setProcesando] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/suscripcion/planes', { tenantSlug })
      .then((res) => setPlanes(res?.planes || []))
      .catch(() => setPlanes([]));
  }, [tenantSlug]);

  const solicitarCambio = async (planCodigo: string, aplicarSandbox: boolean) => {
    setProcesando(planCodigo);
    try {
      await apiFetch('/suscripcion/cambio', {
        method: 'POST',
        tenantSlug,
        body: { plan_solicitado: planCodigo, aplicar_sandbox: aplicarSandbox },
      });
      mostrarToast(
        aplicarSandbox
          ? 'Solicitud aplicada en sandbox (sin cobros reales).'
          : 'Solicitud de cambio de plan registrada para aprobación comercial.',
      );
      recargarSuscripcion();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo solicitar el cambio.');
    } finally {
      setProcesando(null);
    }
  };

  const esAdmin = usuario?.rol === 'admin';

  return (
    <div className="fs-grid" style={{ gap: '1.25rem' }}>
      <PanelHeader
        titulo="💎 Suscripción SaaS y Cuotas Trial"
        subtitulo="Facturación en modo SANDBOX: ningún cobro se realiza de forma automática. Los cambios de plan generan una solicitud comercial."
      />

      <div className="fs-banner-trial" style={{ position: 'static', borderRadius: 12 }}>
        <div>
          <span className="fs-badge fs-badge-sandbox">SANDBOX</span>{' '}
          <strong>{suscripcion?.plan_nombre || 'Trial Gratuito'}</strong> · Estado:{' '}
          {suscripcion?.estado || 'trial'} · {suscripcion?.dias_restantes != null ? <>Restan <strong>{suscripcion.dias_restantes}</strong> días</> : 'Sin vencimiento de Trial configurado'}
        </div>
        <div>
          {suscripcion?.solo_lectura ? (
            <span style={{ color: '#fca5a5', fontWeight: 700 }}>EXPIRADO — SOLO LECTURA</span>
          ) : (
            <span>Renovación automática: NO (modo sandbox)</span>
          )}
        </div>
      </div>

      {suscripcion && (
        <div className="fs-card">
          <h3 style={{ marginTop: 0, fontSize: '1.02rem' }}>Uso de Cuotas del Plan</h3>
          <QuotaBar etiqueta="Usuarios" usado={suscripcion.cuotas.usuarios.usado} maximo={suscripcion.cuotas.usuarios.maximo} />
          <QuotaBar etiqueta="Sucursales" usado={suscripcion.cuotas.sucursales.usado} maximo={suscripcion.cuotas.sucursales.maximo} />
          <QuotaBar etiqueta="Productos" usado={suscripcion.cuotas.productos.usado} maximo={suscripcion.cuotas.productos.maximo} />
        </div>
      )}

      <div className="fs-grid fs-grid-catalog">
        {planes.map((plan) => {
          const actual = suscripcion?.plan_actual === plan.codigo;
          return (
            <div
              key={plan.codigo}
              className="fs-card"
              style={{
                border: actual ? '2px solid #b45309' : '1px solid #e2e8f0',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {actual && <span className="fs-badge fs-badge-ok">PLAN ACTUAL</span>}
              <h3 style={{ margin: 0 }}>{plan.nombre}</h3>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#0f172a' }}>
                {plan.precio_mensual_bob === 0 ? 'Gratis' : formatBs(plan.precio_mensual_bob)}
                <span style={{ fontSize: '0.8rem', fontWeight: 400, color: '#64748b' }}> /mes</span>
              </div>
              <ul style={{ fontSize: '0.84rem', color: '#334155', paddingLeft: '1.1rem', margin: 0 }}>
                <li>{plan.max_usuarios} usuarios</li>
                <li>{plan.max_sucursales} sucursales</li>
                <li>{Number(plan.max_productos) < 0 ? 'Productos ilimitados' : `${plan.max_productos} productos`}</li>
                <li>{plan.descripcion}</li>
              </ul>
              {esAdmin && !actual && (
                <div style={{ marginTop: 'auto', display: 'grid', gap: 6 }}>
                  <button
                    className="fs-btn fs-btn-outline fs-btn-sm"
                    disabled={procesando === plan.codigo}
                    onClick={() => solicitarCambio(plan.codigo, false)}
                  >
                    Solicitar Cambio (Revisión Comercial)
                  </button>
                  <button
                    className="fs-btn fs-btn-accent fs-btn-sm"
                    disabled={procesando === plan.codigo}
                    onClick={() => solicitarCambio(plan.codigo, true)}
                  >
                    ⚡ Aplicar Inmediato (Sandbox)
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
export default SuscripcionPage;
