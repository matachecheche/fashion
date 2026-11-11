import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/App';
import { buildAssetUrl, formatBs } from '../../lib/format';

export const CarritoPage: React.FC = () => {
  const { carrito, quitarDelCarrito, limpiarCarrito } = useApp();
  const navigate = useNavigate();

  const subtotal = carrito.reduce((acc, i) => acc + i.precio_unitario * i.cantidad, 0);

  if (carrito.length === 0) {
    return (
      <div className="fs-card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <h2>🛒 Tu carrito está vacío</h2>
        <p style={{ color: '#64748b', marginBottom: '1.25rem' }}>
          Explora el catálogo o prueba prendas en el Vestidor AR antes de comprar.
        </p>
        <Link to="/catalogo" className="fs-btn fs-btn-accent">
          Ir al Catálogo
        </Link>
      </div>
    );
  }

  return (
    <div className="fs-grid" style={{ gap: '1.5rem' }}>
      <div className="fs-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.45rem' }}>🛒 Carrito de Compras</h1>
          <button className="fs-btn fs-btn-outline fs-btn-sm" onClick={limpiarCarrito}>
            Vaciar Carrito
          </button>
        </div>

        <div className="fs-table-wrap">
          <table className="fs-table">
            <thead>
              <tr>
                <th>Prenda</th>
                <th>SKU / Variante</th>
                <th>Precio Unit.</th>
                <th>Cantidad</th>
                <th>Subtotal</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {carrito.map((item) => (
                <tr key={item.variante_id}>
                  <td style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <img
                      src={buildAssetUrl(item.imagen_url)}
                      alt={item.nombre}
                      style={{ width: 48, height: 64, objectFit: 'cover', borderRadius: 6 }}
                    />
                    <strong>{item.nombre}</strong>
                  </td>
                  <td>
                    {item.sku} ({item.talla} / {item.color})
                  </td>
                  <td>{formatBs(item.precio_unitario)}</td>
                  <td>{item.cantidad}</td>
                  <td>
                    <strong>{formatBs(item.precio_unitario * item.cantidad)}</strong>
                  </td>
                  <td>
                    <button
                      className="fs-btn fs-btn-outline fs-btn-sm"
                      onClick={() => quitarDelCarrito(item.variante_id)}
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '1.5rem',
            paddingTop: '1rem',
            borderTop: '1px solid #e2e8f0',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>
            Subtotal Estimado: {formatBs(subtotal)}
          </div>
          <button className="fs-btn fs-btn-accent" onClick={() => navigate('/checkout')}>
            Continuar al Checkout Sandbox →
          </button>
        </div>
      </div>
    </div>
  );
};
export default CarritoPage;
