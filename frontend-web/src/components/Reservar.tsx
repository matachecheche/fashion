import React, { useState } from 'react';
import { apiFetch } from '../api/client';
import { useApp } from '../context/App';
import { Modal } from './ui';

export const ModalReservarPrenda: React.FC<{
  abierto: boolean;
  onCerrar: () => void;
  producto: any;
  variante: any;
}> = ({ abierto, onCerrar, producto, variante }) => {
  const {
    tenantSlug,
    sucursalActivaId,
    online,
    encolarOperacionOffline,
    mostrarToast,
  } = useApp();
  const [sucursalId, setSucursalId] = useState<number>(sucursalActivaId || 1);
  const [cantidad, setCantidad] = useState<number>(1);
  const [notas, setNotas] = useState<string>('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!producto || !variante) return null;

  const confirmar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    const payload = {
      sucursal_id: sucursalId,
      notas,
      items: [{ variante_id: Number(variante.id), cantidad: Number(cantidad) }],
    };

    try {
      if (!online || !navigator.onLine) {
        await encolarOperacionOffline('reserva', payload);
        onCerrar();
        return;
      }
      const res = await apiFetch('/reservas', {
        method: 'POST',
        tenantSlug,
        body: payload,
      });
      mostrarToast(`Reserva confirmada con código ${res.codigo}`);
      onCerrar();
    } catch (err: any) {
      setError(err?.message || 'Error al registrar la reserva.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      abierto={abierto}
      titulo={`📅 Reservar en Sucursal — ${producto.nombre}`}
      onCerrar={onCerrar}
    >
      <form onSubmit={confirmar} className="fs-grid" style={{ gap: '0.85rem' }}>
        {error && <div className="fs-badge fs-badge-danger">{error}</div>}
        <div style={{ fontSize: '0.88rem' }}>
          Variante seleccionada: <strong>{variante.sku}</strong> (Talla {variante.talla} / Color{' '}
          {variante.color})
        </div>
        <div>
          <label style={{ fontSize: '0.84rem', fontWeight: 600 }}>Sucursal de Retiro / Prueba</label>
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
          <label style={{ fontSize: '0.84rem', fontWeight: 600 }}>Cantidad a apartar</label>
          <input
            type="number"
            min={1}
            max={5}
            className="fs-input"
            value={cantidad}
            onChange={(e) => setCantidad(Number(e.target.value))}
          />
        </div>
        <div>
          <label style={{ fontSize: '0.84rem', fontWeight: 600 }}>Notas para el asesor en tienda</label>
          <textarea
            className="fs-textarea"
            rows={2}
            placeholder="Ej: Pasaré a las 17:00 para probar en vestidor físico"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button type="button" className="fs-btn fs-btn-outline" onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className="fs-btn fs-btn-accent" disabled={enviando}>
            {enviando ? 'Reservando...' : 'Confirmar Reserva'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
