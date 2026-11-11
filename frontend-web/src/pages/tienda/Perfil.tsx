import React, { useState } from 'react';
import { apiFetch } from '../../api/client';
import { useApp } from '../../context/App';

export const PerfilPage: React.FC = () => {
  const { tenantSlug, usuario, iniciarSesion, mostrarToast } = useApp();
  const [nombre, setNombre] = useState(usuario?.nombre || '');
  const [telefono, setTelefono] = useState(usuario?.telefono || '');
  const [passActual, setPassActual] = useState('');
  const [passNueva, setPassNueva] = useState('');
  const [guardando, setGuardando] = useState(false);

  if (!usuario) {
    return <div className="fs-card">Inicia sesión para consultar tu perfil.</div>;
  }

  const guardarPerfil = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    try {
      const res = await apiFetch('/auth/me', {
        method: 'PATCH',
        tenantSlug,
        body: { nombre, telefono },
      });
      const token = localStorage.getItem(`fs_token_${tenantSlug}`) || '';
      iniciarSesion(token, res.usuario || { ...usuario, nombre, telefono });
      mostrarToast('Perfil actualizado correctamente.');
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo actualizar el perfil.');
    } finally {
      setGuardando(false);
    }
  };

  const cambiarPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/auth/me/password', {
        method: 'POST',
        tenantSlug,
        body: { password_actual: passActual, password_nueva: passNueva },
      });
      setPassActual('');
      setPassNueva('');
      mostrarToast('Contraseña actualizada. Tu sesión sigue activa.');
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo cambiar la contraseña.');
    }
  };

  return (
    <div className="fs-grid" style={{ gap: '1.25rem', maxWidth: 720, margin: '0 auto' }}>
      <div className="fs-card">
        <h1 style={{ margin: 0, fontSize: '1.4rem' }}>👤 Mi Perfil</h1>
        <p style={{ margin: '0.3rem 0 0', color: '#64748b', fontSize: '0.88rem' }}>
          Tenant: <code>{tenantSlug}</code> · Rol:{' '}
          <strong>{String(usuario.rol || '').toUpperCase()}</strong> · Correo: {usuario.email}
        </p>
      </div>

      <form onSubmit={guardarPerfil} className="fs-card fs-grid" style={{ gap: '0.8rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Datos de la cuenta</h2>
        <div>
          <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Nombre completo</label>
          <input className="fs-input" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Teléfono / WhatsApp</label>
          <input className="fs-input" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
        </div>
        <button type="submit" className="fs-btn" disabled={guardando}>
          {guardando ? 'Guardando...' : 'Guardar Cambios'}
        </button>
      </form>

      <form onSubmit={cambiarPassword} className="fs-card fs-grid" style={{ gap: '0.8rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Cambiar contraseña</h2>
        <div>
          <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Contraseña actual</label>
          <input
            type="password"
            className="fs-input"
            required
            value={passActual}
            onChange={(e) => setPassActual(e.target.value)}
          />
        </div>
        <div>
          <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Nueva contraseña (mín. 8 caracteres)</label>
          <input
            type="password"
            className="fs-input"
            required
            minLength={8}
            value={passNueva}
            onChange={(e) => setPassNueva(e.target.value)}
          />
        </div>
        <button type="submit" className="fs-btn fs-btn-outline">
          Actualizar Contraseña
        </button>
      </form>
    </div>
  );
};
export default PerfilPage;
