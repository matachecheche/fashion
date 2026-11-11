import React, { useEffect, useState } from 'react';
import { EmptyState, PanelHeader } from '../../components/panel';
import { Modal } from '../../components/ui';
import { apiFetch } from '../../api/client';
import { useApp } from '../../context/App';
import { formatFecha } from '../../lib/format';

export const InventarioPage: React.FC = () => {
  const { tenantSlug, sucursalActivaId, setSucursalActivaId, usuario, mostrarToast } = useApp();
  const [stock, setStock] = useState<any[]>([]);
  const [movimientos, setMovimientos] = useState<any[]>([]);
  const [modalAjuste, setModalAjuste] = useState(false);
  const [modalTransferencia, setModalTransferencia] = useState(false);
  const [form, setForm] = useState({
    almacen_id: '',
    variante_id: '',
    tipo: 'entrada',
    cantidad: '1',
    motivo: 'Ajuste manual de inventario',
  });
  const [transferForm, setTransferForm] = useState({
    variante_id: '',
    almacen_origen_id: '',
    almacen_destino_id: '',
    cantidad: '1',
    motivo: 'Transferencia entre sucursales',
  });

  const cargar = async () => {
    try {
      const s = await apiFetch(`/inventario?sucursal_id=${sucursalActivaId}`, { tenantSlug });
      setStock(Array.isArray(s) ? s : []);
    } catch {
      setStock([]);
    }
    try {
      const m = await apiFetch('/inventario/movimientos?limite=25', { tenantSlug });
      setMovimientos(Array.isArray(m) ? m : []);
    } catch {
      // Sin permiso (cajero) o error
      setMovimientos([]);
    }
  };

  useEffect(() => {
    cargar();
  }, [tenantSlug, sucursalActivaId]);

  const aprobarMovimiento = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/inventario/movimientos', {
        method: 'POST',
        tenantSlug,
        body: {
          almacen_id: Number(form.almacen_id),
          variante_id: Number(form.variante_id),
          tipo: form.tipo,
          cantidad: Number(form.cantidad),
          motivo: form.motivo,
        },
      });
      mostrarToast('Movimiento de inventario registrado.');
      setModalAjuste(false);
      cargar();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo registrar el movimiento.');
    }
  };

  const transferir = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/inventario/transferencias', {
        method: 'POST',
        tenantSlug,
        body: {
          variante_id: Number(transferForm.variante_id),
          almacen_origen_id: Number(transferForm.almacen_origen_id),
          almacen_destino_id: Number(transferForm.almacen_destino_id),
          cantidad: Number(transferForm.cantidad),
          motivo: transferForm.motivo,
        },
      });
      mostrarToast('Transferencia realizada entre almacenes.');
      setModalTransferencia(false);
      cargar();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo transferir el stock.');
    }
  };

  const esAdminEncargado = usuario && ['admin', 'encargado'].includes(usuario.rol);

  return (
    <div className="fs-grid" style={{ gap: '1.25rem' }}>
      <PanelHeader
        titulo="📦 Inventario Multi-Almacén"
        subtitulo="Stock físico, reservado y disponible por sucursal con kardex de movimientos."
        acciones={
          esAdminEncargado && (
            <>
              <button className="fs-btn fs-btn-outline fs-btn-sm" onClick={() => setModalTransferencia(true)}>
                🔀 Transferir
              </button>
              <button className="fs-btn fs-btn-accent fs-btn-sm" onClick={() => setModalAjuste(true)}>
                + Ajuste / Entrada
              </button>
            </>
          )
        }
      />

      <div className="fs-card" style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontWeight: 600, fontSize: '0.88rem' }}>Filtrar por Sucursal:</label>
        <select
          className="fs-select"
          style={{ width: 220 }}
          value={sucursalActivaId}
          onChange={(e) => setSucursalActivaId(Number(e.target.value))}
        >
          <option value={1}>Sucursal #1 (Principal)</option>
          <option value={2}>Sucursal #2 (Secundaria)</option>
        </select>
      </div>

      {stock.length === 0 ? (
        <EmptyState mensaje="Sin stock cargado para esta sucursal. Crea productos y variantes primero." />
      ) : (
        <div className="fs-table-wrap">
          <table className="fs-table">
            <thead>
              <tr>
                <th>Almacén</th>
                <th>SKU</th>
                <th>Producto</th>
                <th>Talla/Color</th>
                <th>Físico</th>
                <th>Reservado</th>
                <th>Disponible</th>
                <th>Mín.</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((s) => (
                <tr key={s.stock_id}>
                  <td>{s.almacen_nombre}</td>
                  <td>{s.sku}</td>
                  <td>{s.producto_nombre}</td>
                  <td>
                    {s.talla} / {s.color}
                  </td>
                  <td>{s.cantidad}</td>
                  <td>{s.reservado}</td>
                  <td>
                    <strong style={{ color: s.disponible <= s.stock_minimo ? '#b91c1c' : '#15803d' }}>
                      {s.disponible}
                    </strong>
                  </td>
                  <td>{s.stock_minimo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="fs-card">
        <h3 style={{ marginTop: 0, fontSize: '1.02rem' }}>🕘 Últimos Movimientos de Kardex</h3>
        {movimientos.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '0.88rem' }}>
            Sin movimientos visibles (requiere rol admin o encargado).
          </p>
        ) : (
          <div className="fs-table-wrap">
            <table className="fs-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>SKU / Producto</th>
                  <th>Almacén</th>
                  <th>Cantidad</th>
                  <th>Motivo</th>
                  <th>Usuario</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m) => (
                  <tr key={m.id}>
                    <td>{formatFecha(m.creado_en || m.fecha || m.fecha_creacion)}</td>
                    <td>{String(m.tipo).toUpperCase()}</td>
                    <td>
                      {m.sku} · {m.producto_nombre}
                    </td>
                    <td>{m.almacen_nombre}</td>
                    <td>
                      <strong>{m.cantidad}</strong>
                    </td>
                    <td>{m.motivo}</td>
                    <td>{m.usuario_nombre || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal abierto={modalAjuste} titulo="Registrar Movimiento de Inventario" onCerrar={() => setModalAjuste(false)}>
        <form onSubmit={aprobarMovimiento} className="fs-grid" style={{ gap: '0.75rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            <input className="fs-input" required placeholder="almacen_id" value={form.almacen_id} onChange={(e) => setForm({ ...form, almacen_id: e.target.value })} />
            <input className="fs-input" required placeholder="variante_id" value={form.variante_id} onChange={(e) => setForm({ ...form, variante_id: e.target.value })} />
            <select className="fs-select" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
              {['entrada', 'salida', 'ajuste_positivo', 'ajuste_negativo', 'devolucion'].map((t) => (
                <option key={t} value={t}>
                  {t.toUpperCase()}
                </option>
              ))}
            </select>
            <input type="number" className="fs-input" required placeholder="Cantidad" value={form.cantidad} onChange={(e) => setForm({ ...form, cantidad: e.target.value })} />
          </div>
          <input className="fs-input" required placeholder="Motivo del ajuste" value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} />
          <button type="submit" className="fs-btn fs-btn-accent">
            Guardar Movimiento
          </button>
        </form>
      </Modal>

      <Modal abierto={modalTransferencia} titulo="Transferir Stock entre Almacenes" onCerrar={() => setModalTransferencia(false)}>
        <form onSubmit={transferir} className="fs-grid" style={{ gap: '0.75rem' }}>
          <input className="fs-input" required placeholder="variante_id" value={transferForm.variante_id} onChange={(e) => setTransferForm({ ...transferForm, variante_id: e.target.value })} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            <input className="fs-input" required placeholder="almacen_origen_id" value={transferForm.almacen_origen_id} onChange={(e) => setTransferForm({ ...transferForm, almacen_origen_id: e.target.value })} />
            <input className="fs-input" required placeholder="almacen_destino_id" value={transferForm.almacen_destino_id} onChange={(e) => setTransferForm({ ...transferForm, almacen_destino_id: e.target.value })} />
          </div>
          <input type="number" min={1} className="fs-input" required placeholder="Cantidad" value={transferForm.cantidad} onChange={(e) => setTransferForm({ ...transferForm, cantidad: e.target.value })} />
          <input className="fs-input" required placeholder="Motivo" value={transferForm.motivo} onChange={(e) => setTransferForm({ ...transferForm, motivo: e.target.value })} />
          <button type="submit" className="fs-btn fs-btn-accent">
            Transferir Stock
          </button>
        </form>
      </Modal>
    </div>
  );
};
export default InventarioPage;
