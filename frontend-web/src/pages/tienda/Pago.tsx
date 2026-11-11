import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { BadgeEstado } from '../../components/ui';
import { useApp } from '../../context/App';
import { formatBs } from '../../lib/format';

export const PagoPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { tenantSlug, mostrarToast } = useApp();
  const navigate = useNavigate();
  const [pago, setPago] = useState<any | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [stripeCheckoutHabilitado, setStripeCheckoutHabilitado] = useState(false);

  const cargarPago = async (pagoId?: string | number) => {
    const efectivoId = pagoId ?? id;
    if (!efectivoId) return;
    try {
      const res = await apiFetch(`/pagos/${efectivoId}`, { tenantSlug });
      setPago(res);
    } catch {
      const ventaId = searchParams.get('venta_id') || id;
      const vRes = await apiFetch(`/ventas/${ventaId}`, { tenantSlug });
      if (vRes?.pagos?.[0]) {
        setPago({
          ...vRes.pagos[0],
          numero_comprobante: vRes.numero_comprobante,
          venta_estado: vRes.estado,
        });
      }
    }
  };

  useEffect(() => {
    cargarPago();
  }, [id, tenantSlug]);

  useEffect(() => {
    let vigente = true;
    apiFetch('/pagos/config', { tenantSlug })
      .then((config) => { if (vigente) setStripeCheckoutHabilitado(Boolean(config?.stripe_checkout_habilitado)); })
      .catch(() => { if (vigente) setStripeCheckoutHabilitado(false); });
    return () => { vigente = false; };
  }, [tenantSlug]);

  useEffect(() => {
    if (!pago || !['no_confirmado', 'pendiente'].includes(String(pago.estado))) return;
    const timer = window.setInterval(() => void cargarPago(pago.id), 15000);
    return () => window.clearInterval(timer);
  }, [pago?.id, pago?.estado, tenantSlug]);

  const iniciarStripeCheckout = async () => {
    if (!pago?.id || !stripeCheckoutHabilitado) {
      mostrarToast('Stripe Checkout de prueba todavía no está configurado.');
      return;
    }
    setProcesando(true);
    try {
      const checkout = await apiFetch(`/pagos/${pago.id}/stripe/checkout`, {
        method: 'POST',
        tenantSlug,
      });
      if (!checkout?.checkout_url) {
        await cargarPago(pago.id);
        mostrarToast('Stripe recibió el intento. El pedido espera la confirmación del webhook firmado.');
        return;
      }
      window.location.assign(String(checkout.checkout_url));
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo iniciar Stripe Checkout de prueba.');
    } finally {
      setProcesando(false);
    }
  };

  const simularConfirmacionProveedor = async (accion: 'aprobar' | 'rechazar') => {
    if (!pago) return;
    setProcesando(true);
    try {
      await apiFetch('/pagos/sandbox/simular-webhook', {
        method: 'POST',
        tenantSlug,
        body: {
          pago_id: pago.id,
          estado: accion === 'aprobar' ? 'aprobado' : 'rechazado',
          webhook_id: `WH-UI-${Date.now()}`,
          motivo: accion === 'rechazar' ? 'Rechazo simulado por el usuario en pasarela Sandbox' : undefined,
        },
      });
      await cargarPago(pago.id);
      mostrarToast(
        accion === 'aprobar'
          ? '✅ Pago confirmado por proveedor Sandbox. Stock descontado en firme.'
          : '❌ Pago rechazado en Sandbox. Stock retenido fue liberado.',
      );
    } catch (err: any) {
      mostrarToast(err?.message || 'Error al procesar pago sandbox');
    } finally {
      setProcesando(false);
    }
  };

  const reintentarPago = async () => {
    if (!pago?.venta_id) return;
    setProcesando(true);
    try {
      const nuevo = await apiFetch(`/pagos/venta/${pago.venta_id}/reintentar`, {
        method: 'POST',
        tenantSlug,
        body: { metodo_pago: pago.metodo },
      });
      setPago({ ...nuevo, numero_comprobante: pago.numero_comprobante });
      mostrarToast('Nuevo intento de cobro Sandbox generado.');
      if (nuevo?.id) {
        navigate(`/pago/${nuevo.id}?venta_id=${pago.venta_id ?? ''}`, { replace: true });
      }
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo reintentar el pago.');
    } finally {
      setProcesando(false);
    }
  };

  if (!pago) {
    return <div className="fs-card">Cargando información de la pasarela Sandbox...</div>;
  }

  const esConfirmado = pago.estado === 'aprobado' && Boolean(pago.confirmado_proveedor);
  const requiereIntervencion = ['aprobado_sin_venta', 'reembolso_pendiente'].includes(String(pago.estado));
  const pagoExpirado = pago.estado === 'expirado' || Boolean(pago.qr_expirado);
  const esPagoStripe = String(pago.pasarela) === 'stripe_sandbox';
  const stripeTestActivo = esPagoStripe && stripeCheckoutHabilitado;

  return (
    <div className="fs-card" style={{ maxWidth: 680, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <span className="fs-badge fs-badge-sandbox">ENTORNO SANDBOX — SIN CARGO REAL</span>
        <BadgeEstado estado={pago.estado} />
      </div>

      <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.45rem' }}>
        {stripeTestActivo ? 'Stripe Checkout — modo test' : `Simulador de Pasarela (${pago.pasarela?.toUpperCase()})`}
      </h1>
      <p style={{ color: '#475569', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
        Referencia Externa: <code>{pago.referencia_externa}</code> · Comprobante Venta:{' '}
        <strong>{pago.numero_comprobante || `#${pago.venta_id}`}</strong>
      </p>

      <div
        style={{
          background: esConfirmado ? '#dcfce7' : requiereIntervencion ? '#fee2e2' : pagoExpirado ? '#f1f5f9' : '#fef3c7',
          border: `1px solid ${esConfirmado ? '#86efac' : requiereIntervencion ? '#fca5a5' : pagoExpirado ? '#cbd5e1' : '#fde68a'}`, 
          borderRadius: 10,
          padding: '1rem',
          marginBottom: '1.25rem',
        }}
      >
        <div style={{ fontWeight: 800, fontSize: '1.02rem' }}>
          {esConfirmado
            ? '✅ PAGO CONFIRMADO POR EL PROVEEDOR SANDBOX'
            : requiereIntervencion
              ? '⚠️ PAGO CONFIRMADO, PERO LA VENTA REQUIERE INTERVENCIÓN. NO ENTREGUES EL PEDIDO.'
              : pagoExpirado
                ? '⌛ INTENTO VENCIDO — la orden está siendo conciliada; no pagues el QR anterior.'
                : pago.estado === 'rechazado'
                  ? '❌ PAGO RECHAZADO POR EL PROVEEDOR SANDBOX (STOCK LIBERADO)'
                  : '⏳ PENDIENTE DE CONFIRMACIÓN DEL PROVEEDOR (STOCK RETENIDO TEMPORALMENTE)'}
        </div>
        <div style={{ fontSize: '0.84rem', marginTop: 4 }}>
          Monto de la Operación: <strong>{formatBs(pago.monto)}</strong> ({pago.moneda})
        </div>
      </div>

      {pago.qr_data_url && !esConfirmado && !requiereIntervencion && !pagoExpirado && (
        <div style={{ display: 'grid', justifyItems: 'center', gap: 8, padding: '1rem', marginBottom: '1rem', border: '1px solid #e2e8f0', borderRadius: 10 }}>
          <strong>QR dinámico de referencia — sandbox</strong>
          <img src={pago.qr_data_url} alt="QR de referencia de prueba" width={220} height={220} />
          <small style={{ color: '#64748b', maxWidth: 420, textAlign: 'center' }}>{pago.qr_aviso}</small>
        </div>
      )}

      {stripeTestActivo && !esConfirmado && !requiereIntervencion && !pagoExpirado && pago.estado !== 'rechazado' && (
        <div style={{ border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 10, padding: '1rem', marginBottom: '1rem' }}>
          <strong>Tarjeta de prueba con Stripe</strong>
          <p style={{ margin: '0.5rem 0 1rem', color: '#475569', fontSize: '0.88rem' }}>
            Se abrirá el Checkout alojado por Stripe. La tarjeta se procesa en modo test y el pedido solo se confirma cuando el backend valida el webhook firmado.
          </p>
          <button className="fs-btn fs-btn-accent" disabled={procesando} onClick={iniciarStripeCheckout}>
            {procesando ? 'Conectando con Stripe…' : '💳 Pagar con tarjeta de prueba'}
          </button>
        </div>
      )}

      {esPagoStripe && !stripeCheckoutHabilitado && !esConfirmado && (
        <div role="status" style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '0.85rem', marginBottom: '1rem', color: '#92400e' }}>
          Stripe Checkout aún no está configurado. Los botones de abajo son simulación y no validan una tarjeta.
        </div>
      )}

      {pagoExpirado && (
        <div role="status" style={{ background: '#f1f5f9', borderRadius: 8, padding: '0.85rem', marginBottom: '1rem', color: '#334155' }}>
          {pago.qr_aviso || 'El intento de pago venció y la orden está siendo conciliada. No pagues un QR anterior.'}
        </div>
      )}

      {!esConfirmado && !requiereIntervencion && !pagoExpirado && pago.estado !== 'rechazado' && !stripeTestActivo && (
        <div
          style={{
            border: '1px dashed #94a3b8',
            borderRadius: 10,
            padding: '1.25rem',
            textAlign: 'center',
            marginBottom: '1.25rem',
          }}
        >
          <p style={{ margin: '0 0 1rem', fontSize: '0.88rem' }}>
            Simulación local del proveedor <strong>{pago.pasarela}</strong>: no se abre un formulario ni se valida una tarjeta.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
            <button
              className="fs-btn"
              style={{ background: '#15803d' }}
              disabled={procesando}
              onClick={() => simularConfirmacionProveedor('aprobar')}
            >
              ✅ Simular Confirmación Exitosa (Webhook Aprobado)
            </button>
            <button
              className="fs-btn fs-btn-danger"
              disabled={procesando}
              onClick={() => simularConfirmacionProveedor('rechazar')}
            >
              ❌ Simular Rechazo del Proveedor
            </button>
          </div>
        </div>
      )}

      {['rechazado', 'expirado'].includes(String(pago.estado)) && (
        <div style={{ marginBottom: '1.25rem' }}>
          <button className="fs-btn fs-btn-accent" disabled={procesando} onClick={reintentarPago}>
            🔄 Reintentar Cobro en Pasarela Sandbox
          </button>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Link to="/mis-pedidos" className="fs-btn fs-btn-outline">
          Ver Mis Pedidos y Comprobante
        </Link>
        <Link to="/catalogo" className="fs-btn">
          Seguir Comprando
        </Link>
      </div>
    </div>
  );
};
export default PagoPage;
