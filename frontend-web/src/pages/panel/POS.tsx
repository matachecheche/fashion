import React, { useEffect, useMemo, useState } from 'react';
import { PanelHeader } from '../../components/panel';
import { BadgeEstado, KpiCard } from '../../components/ui';
import { apiFetch } from '../../api/client';
import { useApp } from '../../context/App';
import { buildAssetUrl, formatBs } from '../../lib/format';

interface PosLinea {
  variante_id: number;
  producto_id: number;
  sku: string;
  nombre: string;
  talla: string;
  color: string;
  precio_unitario: number;
  cantidad: number;
  imagen_url: string;
}

export const PosPage: React.FC = () => {
  const {
    tenantSlug,
    usuario,
    sucursalActivaId,
    online,
    encolarOperacionOffline,
    mostrarToast,
  } = useApp();
  const [caja, setCaja] = useState<any | null>(null);
  const [montoInicial, setMontoInicial] = useState('500');
  const [montoCierre, setMontoCierre] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [productos, setProductos] = useState<any[]>([]);
  const [lineas, setLineas] = useState<PosLinea[]>([]);
  const [metodoPago, setMetodoPago] = useState<'efectivo' | 'qr' | 'tarjeta'>('efectivo');
  const [clienteNombre, setClienteNombre] = useState('Consumidor Final');
  const [clienteNit, setClienteNit] = useState('0');
  const [promocion, setPromocion] = useState('');
  const [procesando, setProcesando] = useState(false);

  const cargarCaja = async () => {
    try {
      const c = await apiFetch(`/pos/caja-activa?sucursal_id=${sucursalActivaId}`, { tenantSlug });
      setCaja(c);
    } catch {
      setCaja(null);
    }
  };

  useEffect(() => {
    cargarCaja();
  }, [tenantSlug, sucursalActivaId]);

  useEffect(() => {
    const t = setTimeout(() => {
      const qs = busqueda.trim() ? `?q=${encodeURIComponent(busqueda.trim())}` : '';
      apiFetch(`/catalogo/productos${qs}`, { tenantSlug })
        .then((rows) => setProductos(Array.isArray(rows) ? rows.slice(0, 12) : []))
        .catch(() => setProductos([]));
    }, 250);
    return () => clearTimeout(t);
  }, [busqueda, tenantSlug]);

  const abrirCaja = async () => {
    try {
      const nueva = await apiFetch('/pos/abrir', {
        method: 'POST',
        tenantSlug,
        body: { sucursal_id: sucursalActivaId, monto_inicial: Number(montoInicial) || 0 },
      });
      setCaja(nueva);
      mostrarToast('Caja abierta correctamente.');
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo abrir la caja.');
    }
  };

  const cerrarCaja = async () => {
    if (!caja) return;
    try {
      const res = await apiFetch(`/pos/${caja.id}/cerrar`, {
        method: 'POST',
        tenantSlug,
        body: montoCierre !== '' ? { monto_cierre_declarado: Number(montoCierre) } : {},
      });
      setCaja(null);
      mostrarToast(
        `Caja cerrada. Efectivo esperado: ${formatBs(res?.esperado_efectivo ?? 0)} · Diferencia: ${formatBs(res?.diferencia ?? 0)}`,
      );
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo cerrar la caja.');
    }
  };

  const agregarLinea = (producto: any, variante: any) => {
    setLineas((prev) => {
      const existe = prev.find((l) => l.variante_id === variante.id);
      if (existe) {
        return prev.map((l) =>
          l.variante_id === variante.id ? { ...l, cantidad: l.cantidad + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          variante_id: variante.id,
          producto_id: producto.id,
          sku: variante.sku,
          nombre: producto.nombre,
          talla: variante.talla,
          color: variante.color,
          precio_unitario: Number(producto.precio_base) + Number(variante.precio_adicional || 0),
          cantidad: 1,
          imagen_url: variante.foto_url || producto.imagen_url,
        },
      ];
    });
  };

  const cambiarCantidad = (varianteId: number, delta: number) => {
    setLineas((prev) =>
      prev
        .map((l) => (l.variante_id === varianteId ? { ...l, cantidad: l.cantidad + delta } : l))
        .filter((l) => l.cantidad > 0),
    );
  };

  const total = useMemo(
    () => lineas.reduce((acc, l) => acc + l.precio_unitario * l.cantidad, 0),
    [lineas],
  );

  const cobrar = async () => {
    if (lineas.length === 0) return;
    setProcesando(true);
    const payload = {
      sucursal_id: sucursalActivaId,
      origen: 'pos',
      metodo_pago: metodoPago,
      cliente_nombre: clienteNombre,
      cliente_nit: clienteNit,
      promocion_codigo: promocion.trim() || undefined,
      caja_id: caja?.id,
      items: lineas.map((l) => ({ variante_id: l.variante_id, cantidad: l.cantidad })),
    };

    try {
      if (!online || !navigator.onLine) {
        if (metodoPago !== 'efectivo') {
          mostrarToast('Sin conexión: solo se permite guardar ventas POS en efectivo.');
          return;
        }
        await encolarOperacionOffline('venta', payload);
        setLineas([]);
        return;
      }
      const venta = await apiFetch('/ventas', { method: 'POST', tenantSlug, body: payload });
      setLineas([]);
      mostrarToast(
        metodoPago === 'efectivo'
          ? `✅ Venta ${venta.numero_comprobante} confirmada en efectivo.`
          : `⏳ Venta ${venta.numero_comprobante} generada. PENDIENTE de confirmación del proveedor Sandbox.`,
      );
      cargarCaja();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo procesar la venta.');
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className="fs-grid" style={{ gap: '1.25rem' }}>
      <PanelHeader
        titulo="🖥️ Punto de Venta (POS) Offline-First"
        subtitulo={`Cajero: ${usuario?.nombre || '-'} · ${
          online && navigator.onLine ? '🌐 Servidor disponible' : '📡 Sin conexión al servidor — solo efectivo; las ventas se encolarán en IndexedDB'
        }`}
        acciones={<BadgeEstado estado={caja ? 'abierta' : 'cerrada'} />}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1rem',
        }}
      >
        <div className="fs-card" style={{ gridColumn: 'span 2' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong>
              {caja
                ? `Caja #${caja.id} ABIERTA · Inicial ${formatBs(caja.monto_inicial)} · Efectivo acum. ${formatBs(caja.monto_ventas_efectivo)}`
                : 'No hay caja abierta en esta sucursal.'}
            </strong>
            {caja ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="number"
                  className="fs-input"
                  style={{ width: 140 }}
                  placeholder="Monto cierre"
                  value={montoCierre}
                  onChange={(e) => setMontoCierre(e.target.value)}
                />
                <button className="fs-btn fs-btn-outline fs-btn-sm" onClick={cerrarCaja}>
                  Cerrar Caja
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="number"
                  className="fs-input"
                  style={{ width: 130 }}
                  placeholder="Monto inicial"
                  value={montoInicial}
                  onChange={(e) => setMontoInicial(e.target.value)}
                />
                <button className="fs-btn fs-btn-accent fs-btn-sm" onClick={abrirCaja}>
                  Abrir Caja
                </button>
              </div>
            )}
          </div>
        </div>
        <KpiCard titulo="Total ticket actual" valor={formatBs(total)} color="#b45309" />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))',
          gap: '1.25rem',
        }}
      >
        <div className="fs-card">
          <input
            className="fs-input"
            autoFocus
            placeholder="Buscar prenda por nombre o código..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: '0.6rem',
              marginTop: '0.75rem',
              maxHeight: 460,
              overflowY: 'auto',
            }}
          >
            {productos.map((p) => (
              <div
                key={p.id}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '0.4rem',
                  background: '#fff',
                }}
              >
                <img
                  src={buildAssetUrl(p.imagen_url)}
                  alt={p.nombre}
                  style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: 6 }}
                />
                <div style={{ fontSize: '0.74rem', fontWeight: 700, margin: '4px 0 2px' }}>
                  {p.nombre}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{formatBs(p.precio_base)}</div>
                <select
                  className="fs-select"
                  style={{ fontSize: '0.72rem', padding: '0.15rem' }}
                  defaultValue=""
                  onChange={(e) => {
                    const vid = Number(e.target.value);
                    const variante = (p.variantes || []).find((v: any) => v.id === vid);
                    if (variante) agregarLinea(p, variante);
                    e.currentTarget.value = '';
                  }}
                >
                  <option value="">+ Agregar variante…</option>
                  {(p.variantes || []).map((v: any) => (
                    <option key={v.id} value={v.id}>
                      {v.talla} / {v.color} ({v.sku})
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        <div className="fs-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Ticket de Caja</h3>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {lineas.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: '0.88rem' }}>
                Escanea o agrega prendas para iniciar la venta.
              </p>
            ) : (
              lineas.map((l) => (
                <div
                  key={l.variante_id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '1px solid #f1f5f9',
                    padding: '0.35rem 0',
                    gap: 6,
                  }}
                >
                  <div style={{ fontSize: '0.8rem' }}>
                    <strong>{l.nombre}</strong>
                    <div style={{ color: '#64748b' }}>
                      {l.sku} · {l.talla}/{l.color} · {formatBs(l.precio_unitario)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button className="fs-btn fs-btn-outline fs-btn-sm" onClick={() => cambiarCantidad(l.variante_id, -1)}>
                      −
                    </button>
                    <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 700 }}>{l.cantidad}</span>
                    <button className="fs-btn fs-btn-outline fs-btn-sm" onClick={() => cambiarCantidad(l.variante_id, 1)}>
                      +
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '0.6rem', fontSize: '0.85rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <input className="fs-input" placeholder="Cliente" value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} />
              <input className="fs-input" placeholder="NIT / CI" value={clienteNit} onChange={(e) => setClienteNit(e.target.value)} />
            </div>
            <input
              className="fs-input"
              placeholder="Cupón promocional (opcional)"
              style={{ marginTop: 6 }}
              value={promocion}
              onChange={(e) => setPromocion(e.target.value)}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 8 }}>
              {(['efectivo', 'qr', 'tarjeta'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`fs-btn fs-btn-sm ${metodoPago === m ? '' : 'fs-btn-outline'}`}
                  onClick={() => setMetodoPago(m)}
                  disabled={(!online || !navigator.onLine) && m !== 'efectivo'}
                >
                  {m === 'efectivo' ? '💵 Efectivo' : m === 'qr' ? '📱 QR' : '💳 Tarjeta'}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '1.2rem', margin: '0.7rem 0' }}>
              <span>TOTAL</span>
              <span>{formatBs(total)}</span>
            </div>
            <button
              className="fs-btn fs-btn-accent"
              style={{ width: '100%' }}
              disabled={lineas.length === 0 || procesando || ((!online || !navigator.onLine) && metodoPago !== 'efectivo')}
              onClick={cobrar}
            >
              {procesando
                ? 'Procesando...'
                : !online || !navigator.onLine
                  ? '📡 Encolar venta en efectivo'
                  : metodoPago === 'efectivo'
                    ? '💵 Cobrar en Efectivo'
                    : 'Generar Cobro (Pendiente Sandbox)'}
            </button>
            {(!online || !navigator.onLine) ? (
              <p style={{ fontSize: '0.72rem', color: '#991b1b', marginTop: 6 }}>
                Sin conexión: solo efectivo. La venta se guarda en una cola persistente y se sincroniza al reconectar.
              </p>
            ) : metodoPago !== 'efectivo' ? (
              <p style={{ fontSize: '0.72rem', color: '#92400e', marginTop: 6 }}>
                QR/Tarjeta quedan pendientes hasta recibir una confirmación verificable del proveedor.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
export default PosPage;
