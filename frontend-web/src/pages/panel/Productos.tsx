import React, { useEffect, useState } from 'react';
import { EmptyState, PanelHeader } from '../../components/panel';
import { Modal } from '../../components/ui';
import { apiFetch } from '../../api/client';
import { useApp } from '../../context/App';
import { buildAssetUrl, formatBs } from '../../lib/format';

const TIPOS = ['blusa', 'camiseta', 'cartera', 'chaqueta', 'falda', 'pantalon', 'vestido', 'zapato'];

export const ProductosPage: React.FC = () => {
  const { tenantSlug, mostrarToast } = useApp();
  const [productos, setProductos] = useState<any[]>([]);
  const [filtros, setFiltros] = useState<any>({ categorias: [] });
  const [modalProducto, setModalProducto] = useState(false);
  const [modalVariantePara, setModalVariantePara] = useState<number | null>(null);
  const [form, setForm] = useState({
    nombre: '',
    categoria_id: '',
    tipo_prenda: 'vestido',
    color_inicial: 'rojo',
    precio_base: '250',
    material: 'Algodón Premium',
    descripcion: '',
  });
  const [varianteForm, setVarianteForm] = useState({
    sku: '',
    talla: 'M',
    color: 'rojo',
    color_hex: '#8B1E2D',
    precio_adicional: '0',
  });

  const cargar = async () => {
    try {
      const [rows, f] = await Promise.all([
        apiFetch('/catalogo/productos', { tenantSlug }),
        apiFetch('/catalogo/filtros', { tenantSlug }),
      ]);
      setProductos(Array.isArray(rows) ? rows : []);
      setFiltros(f || { categorias: [] });
    } catch {
      setProductos([]);
    }
  };

  useEffect(() => {
    cargar();
  }, [tenantSlug]);

  const crearProducto = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/catalogo/productos', {
        method: 'POST',
        tenantSlug,
        body: { ...form, categoria_id: Number(form.categoria_id), precio_base: Number(form.precio_base) },
      });
      mostrarToast('Producto creado con su variante inicial.');
      setModalProducto(false);
      cargar();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo crear el producto.');
    }
  };

  const crearVariante = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalVariantePara) return;
    try {
      await apiFetch(`/catalogo/productos/${modalVariantePara}/variantes`, {
        method: 'POST',
        tenantSlug,
        body: { ...varianteForm, precio_adicional: Number(varianteForm.precio_adicional) },
      });
      mostrarToast('Variante creada correctamente.');
      setModalVariantePara(null);
      cargar();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo crear la variante.');
    }
  };

  const desactivar = async (id: number) => {
    try {
      await apiFetch(`/catalogo/productos/${id}`, { method: 'DELETE', tenantSlug });
      mostrarToast('Producto desactivado del catálogo de la tienda.');
      cargar();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo desactivar.');
    }
  };

  return (
    <div className="fs-grid" style={{ gap: '1.25rem' }}>
      <PanelHeader
        titulo="👗 Productos y Variantes"
        subtitulo="Cada producto usa el pipeline de imágenes generadas (foto + overlay AR por tipo_prenda y color)."
        acciones={
          <button className="fs-btn fs-btn-accent fs-btn-sm" onClick={() => setModalProducto(true)}>
            + Nuevo Producto
          </button>
        }
      />

      {productos.length === 0 ? (
        <EmptyState mensaje="Sin productos cargados. Crea tu primera prenda SaaS." />
      ) : (
        <div className="fs-grid fs-grid-catalog">
          {productos.map((p) => (
            <div key={p.id} className="fs-card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <img
                src={buildAssetUrl(p.imagen_url)}
                alt={p.nombre}
                style={{ width: '100%', height: 190, objectFit: 'contain', background: '#f8fafc', borderRadius: 8 }}
              />
              <div style={{ fontSize: '0.73rem', color: '#64748b' }}>{p.codigo} · {p.tipo_prenda?.toUpperCase()}</div>
              <strong style={{ fontSize: '0.95rem' }}>{p.nombre}</strong>
              <div style={{ fontWeight: 800, color: '#b45309' }}>{formatBs(p.precio_base)}</div>
              <div style={{ fontSize: '0.76rem', color: '#475569' }}>
                {(p.variantes || []).length} variantes:{' '}
                {(p.variantes || []).slice(0, 4).map((v: any) => `${v.talla}/${v.color}`).join(', ')}
                {(p.variantes || []).length > 4 && '…'}
              </div>
              <div style={{ marginTop: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="fs-btn fs-btn-outline fs-btn-sm" onClick={() => setModalVariantePara(p.id)}>
                  + Variante
                </button>
                <button className="fs-btn fs-btn-outline fs-btn-sm" onClick={() => desactivar(p.id)}>
                  Desactivar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal abierto={modalProducto} titulo="Crear Producto SaaS" onCerrar={() => setModalProducto(false)}>
        <form onSubmit={crearProducto} className="fs-grid" style={{ gap: '0.7rem' }}>
          <input className="fs-input" required placeholder="Nombre del producto" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            <select className="fs-select" required value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: e.target.value })}>
              <option value="">Categoría…</option>
              {(filtros.categorias || []).map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            <select className="fs-select" value={form.tipo_prenda} onChange={(e) => setForm({ ...form, tipo_prenda: e.target.value })}>
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {t.toUpperCase()}
                </option>
              ))}
            </select>
            <input className="fs-input" placeholder="Color inicial (12 colores)" value={form.color_inicial} onChange={(e) => setForm({ ...form, color_inicial: e.target.value })} />
            <input type="number" className="fs-input" required placeholder="Precio base (BOB)" value={form.precio_base} onChange={(e) => setForm({ ...form, precio_base: e.target.value })} />
          </div>
          <input className="fs-input" placeholder="Material" value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} />
          <textarea className="fs-input" placeholder="Descripción corta" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
          <button type="submit" className="fs-btn fs-btn-accent">
            Crear Producto
          </button>
        </form>
      </Modal>

      <Modal abierto={modalVariantePara !== null} titulo="Agregar Variante (Talla / Color / SKU)" onCerrar={() => setModalVariantePara(null)}>
        <form onSubmit={crearVariante} className="fs-grid" style={{ gap: '0.7rem' }}>
          <input className="fs-input" placeholder="SKU (auto si vacío)" value={varianteForm.sku} onChange={(e) => setVarianteForm({ ...varianteForm, sku: e.target.value })} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            <select className="fs-select" value={varianteForm.talla} onChange={(e) => setVarianteForm({ ...varianteForm, talla: e.target.value })}>
              {['XS', 'S', 'M', 'L', 'XL', 'XXL', 'U', '34', '35', '36', '37', '38', '39', '40'].map((t) => (
                <option key={t} value={t}>
                  Talla {t}
                </option>
              ))}
            </select>
            <input className="fs-input" placeholder="Color" value={varianteForm.color} onChange={(e) => setVarianteForm({ ...varianteForm, color: e.target.value })} />
            <input className="fs-input" placeholder="Color hex" value={varianteForm.color_hex} onChange={(e) => setVarianteForm({ ...varianteForm, color_hex: e.target.value })} />
            <input type="number" className="fs-input" placeholder="Precio adicional" value={varianteForm.precio_adicional} onChange={(e) => setVarianteForm({ ...varianteForm, precio_adicional: e.target.value })} />
          </div>
          <button type="submit" className="fs-btn fs-btn-accent">
            Crear Variante
          </button>
        </form>
      </Modal>
    </div>
  );
};
export default ProductosPage;
