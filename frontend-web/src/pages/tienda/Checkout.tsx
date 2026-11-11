import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { useApp } from '../../context/App';
import { formatBs } from '../../lib/format';

export const CheckoutPage: React.FC = () => {
  const { tenantSlug, usuario, carrito, limpiarCarrito, mostrarToast } = useApp();
  const navigate = useNavigate();

  const [sucursalId, setSucursalId] = useState(1);
  const [metodoPago, setMetodoPago] = useState<'qr' | 'tarjeta'>('qr');
  const [clienteNombre, setClienteNombre] = useState(usuario?.nombre || 'Consumidor Final');
  const [clienteNit, setClienteNit] = useState('4589210');
  const [direccion, setDireccion] = useState('Av. San Martín #450, Equipetrol');
  const [promocionCodigo, setPromocionCodigo] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stripeCheckoutHabilitado, setStripeCheckoutHabilitado] = useState(false);

  useEffect(() => {
    let vigente = true;
    apiFetch('/pagos/config', { tenantSlug })
      .then((config) => { if (vigente) setStripeCheckoutHabilitado(Boolean(config?.stripe_checkout_habilitado)); })
      .catch(() => { if (vigente) setStripeCheckoutHabilitado(false); });
    return () => { vigente = false; };
  }, [tenantSlug]);

  if (carrito.length === 0) {
    return (
      <div className="fs-card">
        No tienes prendas en el carrito. Agrega prendas desde el catálogo para continuar.
      </div>
    );
  }

  if (!usuario) {
    return (
      <div className="fs-card" style={{ textAlign: 'center', padding: '2rem' }}>
        <h3>Inicia sesión para completar tu pedido</h3>
        <button className="fs-btn fs-btn-accent" onClick={() => navigate('/auth')}>
          Ir a Iniciar Sesión / Registro
        </button>
      </div>
    );
  }

  const subtotal = carrito.reduce((acc, i) => acc + i.precio_unitario * i.cantidad, 0);

  const confirmarPedido = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcesando(true);
    setError(null);
    try {
      const venta = await apiFetch('/ventas', {
        method: 'POST',
        tenantSlug,
        body: {
          sucursal_id: sucursalId,
          metodo_pago: metodoPago,
          origen: 'web',
          cliente_nombre: clienteNombre,
          cliente_nit: clienteNit,
          direccion_entrega: direccion,
          promocion_codigo: promocionCodigo.trim() || undefined,
          items: carrito.map((i) => ({
            variante_id: i.variante_id,
            cantidad: i.cantidad,
          })),
        },
      });
      limpiarCarrito();
      mostrarToast(
        `Pedido ${venta.numero_comprobante} creado en estado PENDIENTE DE PAGO (Sandbox).`,
      );
      navigate(`/pago/${venta.pago?.id || venta.id}?venta_id=${venta.id}`);
    } catch (err: any) {
      setError(err?.message || 'No se pudo procesar el pedido.');
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className="fs-card" style={{ maxWidth: 760, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.45rem' }}>
        {stripeCheckoutHabilitado ? '💳 Checkout de prueba con Stripe' : '💳 Checkout Sandbox — simulación de pago'}
      </h1>
      <div
        className="fs-badge fs-badge-sandbox"
        style={{ padding: '0.6rem 0.85rem', marginBottom: '1rem', display: 'block' }}
      >
        🔒 <strong>Pago de prueba:</strong> Ningún pago QR o tarjeta se marca pagado al enviar
        este formulario. El pedido queda en <code>pendiente_pago / no_confirmado</code>.{' '}
        {stripeCheckoutHabilitado
          ? 'Para tarjeta se abrirá Stripe Checkout en modo test; el servidor espera el webhook firmado de Stripe.'
          : 'Stripe Checkout no está conectado: la tarjeta solo podrá simularse y no validará datos de tarjeta.'}
      </div>

      {error && (
        <div className="fs-badge fs-badge-danger" style={{ marginBottom: '1rem', padding: '0.6rem' }}>
          {error}
        </div>
      )}

      <form onSubmit={confirmarPedido} className="fs-grid" style={{ gap: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
          <div>
            <label style={{ fontSize: '0.84rem', fontWeight: 600 }}>Razón Social / Nombre Factura *</label>
            <input
              className="fs-input"
              required
              value={clienteNombre}
              onChange={(e) => setClienteNombre(e.target.value)}
            />
          </div>
          <div>
            <label style={{ fontSize: '0.84rem', fontWeight: 600 }}>NIT / CI *</label>
            <input
              className="fs-input"
              required
              value={clienteNit}
              onChange={(e) => setClienteNit(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
          <div>
            <label style={{ fontSize: '0.84rem', fontWeight: 600 }}>Sucursal de Despacho *</label>
            <select
              className="fs-select"
              value={sucursalId}
              onChange={(e) => setSucursalId(Number(e.target.value))}
            >
              <option value={1}>Sucursal Principal (#1)</option>
              <option value={2}>Sucursal Secundaria (#2)</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.84rem', fontWeight: 600 }}>Cupón Promocional (Opcional)</label>
            <input
              className="fs-input"
              placeholder="Ej: MODA2026"
              value={promocionCodigo}
              onChange={(e) => setPromocionCodigo(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label style={{ fontSize: '0.84rem', fontWeight: 600 }}>Dirección de Entrega / Referencia</label>
          <input
            className="fs-input"
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
          />
        </div>

        <div>
          <label style={{ fontSize: '0.84rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>
            Pasarela de Pago Sandbox:
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <label
              className="fs-card"
              style={{
                cursor: 'pointer',
                borderColor: metodoPago === 'qr' ? '#b45309' : '#e2e8f0',
                background: metodoPago === 'qr' ? '#fffbeb' : '#fff',
              }}
            >
              <input
                type="radio"
                name="metodo"
                checked={metodoPago === 'qr'}
                onChange={() => setMetodoPago('qr')}
              />{' '}
              <strong>📱 QR Simple Bolivia (Libélula Sandbox)</strong>
              <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 4 }}>
                Retiene el stock temporalmente y espera confirmación del webhook QR Sandbox.
              </div>
            </label>

            <label
              className="fs-card"
              style={{
                cursor: 'pointer',
                borderColor: metodoPago === 'tarjeta' ? '#b45309' : '#e2e8f0',
                background: metodoPago === 'tarjeta' ? '#fffbeb' : '#fff',
              }}
            >
              <input
                type="radio"
                name="metodo"
                checked={metodoPago === 'tarjeta'}
                onChange={() => setMetodoPago('tarjeta')}
              />{' '}
              <strong>{stripeCheckoutHabilitado ? '💳 Tarjeta de prueba — Stripe Checkout' : '💳 Tarjeta — simulador Stripe'}</strong>
              <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 4 }}>
                {stripeCheckoutHabilitado
                  ? 'Formulario alojado por Stripe. Usa solo una tarjeta de prueba; no hay cargos reales.'
                  : 'No hay formulario conectado: esta opción solo simula aprobación/rechazo.'}
              </div>
            </label>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: '0.85rem',
            borderTop: '1px solid #e2e8f0',
          }}
        >
          <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>
            Total antes de descuentos: {formatBs(subtotal)}
          </div>
          <button type="submit" className="fs-btn fs-btn-accent" disabled={procesando}>
            {procesando ? 'Generando Orden Sandbox...' : 'Generar Orden y Pasar al Simulador de Pago'}
          </button>
        </div>
      </form>
    </div>
  );
};
export default CheckoutPage;
