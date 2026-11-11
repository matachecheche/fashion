import React, { useEffect, useState } from 'react';
import { PanelHeader } from '../../components/panel';
import { BadgeEstado, Modal } from '../../components/ui';
import { apiFetch } from '../../api/client';
import { useApp } from '../../context/App';
import { formatFecha } from '../../lib/format';

export const UsuariosPage: React.FC = () => {
  const { tenantSlug, usuario, mostrarToast } = useApp();
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({
    nombre: '',
    email: '',
    password: 'Fashion2026!',
    rol: 'cajero',
    telefono: '',
    sucursal_id: '1',
  });

  const cargar = async () => {
    try {
      const rows = await apiFetch('/usuarios', { tenantSlug });
      setUsuarios(Array.isArray(rows) ? rows : []);
    } catch {
      setUsuarios([]);
    }
  };

  useEffect(() => {
    cargar();
  }, [tenantSlug]);

  const crearUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/usuarios', {
        method: 'POST',
        tenantSlug,
        body: { ...form, sucursal_id: Number(form.sucursal_id) },
      });
      mostrarToast('Usuario creado en la tienda (cupo del plan aplicado).');
      setModal(false);
      setForm({ nombre: '', email: '', password: 'Fashion2026!', rol: 'cajero', telefono: '', sucursal_id: '1' });
      cargar();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo crear el usuario (¿cupo del plan alcanzado?).');
    }
  };

  const alternarActivo = async (u: any) => {
    try {
      await apiFetch(`/usuarios/${u.id}`, {
        method: 'PATCH',
        tenantSlug,
        body: { activo: !u.activo },
      });
      mostrarToast(u.activo ? 'Usuario desactivado.' : 'Usuario reactivado.');
      cargar();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo actualizar el usuario.');
    }
  };

  const esAdmin = usuario?.rol === 'admin';

  return (
    <div className="fs-grid" style={{ gap: '1.25rem' }}>
      <PanelHeader
        titulo="👥 Usuarios y Roles de la Tienda"
        subtitulo="Roles: admin, encargado, cajero, proveedor y cliente. Cupos controlados por el plan SaaS."
        acciones={
          esAdmin && (
            <button className="fs-btn fs-btn-accent fs-btn-sm" onClick={() => setModal(true)}>
              + Nuevo Usuario
            </button>
          )
        }
      />

      <div className="fs-table-wrap">
        <table className="fs-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Sucursal</th>
              <th>Alta</th>
              <th>Estado</th>
              {esAdmin && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td>{u.nombre}</td>
                <td>{u.email}</td>
                <td>{String(u.rol).toUpperCase()}</td>
                <td>{u.sucursal_nombre || (u.sucursal_id ? `#${u.sucursal_id}` : '-')}</td>
                <td>{formatFecha(u.creado_en)}</td>
                <td>
                  <BadgeEstado estado={u.activo ? 'activo' : 'inactivo'} />
                </td>
                {esAdmin && (
                  <td>
                    <button className="fs-btn fs-btn-outline fs-btn-sm" onClick={() => alternarActivo(u)}>
                      {u.activo ? 'Desactivar' : 'Reactivar'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal abierto={modal} titulo="Crear Usuario de la Tienda" onCerrar={() => setModal(false)}>
        <form onSubmit={crearUsuario} className="fs-grid" style={{ gap: '0.7rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
            <input className="fs-input" required placeholder="Nombre completo" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            <input type="email" className="fs-input" required placeholder="Correo" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input type="password" className="fs-input" required minLength={8} placeholder="Contraseña" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <select className="fs-select" value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value })}>
              {['admin', 'encargado', 'cajero', 'proveedor', 'cliente'].map((r) => (
                <option key={r} value={r}>
                  {r.toUpperCase()}
                </option>
              ))}
            </select>
            <input className="fs-input" placeholder="Teléfono" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
            <input type="number" className="fs-input" min={1} placeholder="sucursal_id" value={form.sucursal_id} onChange={(e) => setForm({ ...form, sucursal_id: e.target.value })} />
          </div>
          <button type="submit" className="fs-btn fs-btn-accent">
            Crear Usuario
          </button>
        </form>
      </Modal>
    </div>
  );
};
export default UsuariosPage;
