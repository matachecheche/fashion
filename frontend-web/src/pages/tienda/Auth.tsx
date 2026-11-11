import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { useApp } from '../../context/App';

export const AuthPage: React.FC = () => {
  const { tenantSlug, iniciarSesion, setAbrirModalOnboarding } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [modo, setModo] = useState<'login' | 'registro'>('login');
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('admin@fashionstore.bo');
  const [password, setPassword] = useState('Fashion2026!');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const destino = (location.state as any)?.from || '/catalogo';

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    setError(null);
    try {
      const endpoint = modo === 'login' ? '/auth/login' : '/auth/registro';
      const body =
        modo === 'login'
          ? { email, password }
          : { nombre, email, password, rol: 'cliente' };
      const res = await apiFetch(endpoint, { method: 'POST', tenantSlug, body });
      iniciarSesion(res.access_token, res.usuario);
      navigate(destino, { replace: true });
    } catch (err: any) {
      setError(err?.message || 'No se pudo autenticar con el servicio.');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="fs-card" style={{ maxWidth: 460, margin: '1rem auto' }}>
      <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.4rem' }}>
        {modo === 'login' ? '🔐 Iniciar Sesión' : '👤 Crear Cuenta'}
      </h1>
      <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
        Tienda SaaS <code>/tienda/{tenantSlug}</code> · Autenticación aislada por Tenant con JWT.
      </p>

      {error && (
        <div className="fs-badge fs-badge-danger" style={{ display: 'block', marginBottom: '0.85rem', padding: '0.6rem' }}>
          {error}
        </div>
      )}

      <form onSubmit={enviar} className="fs-grid" style={{ gap: '0.85rem' }}>
        {modo === 'registro' && (
          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Nombre completo</label>
            <input
              className="fs-input"
              required
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: María González"
            />
          </div>
        )}
        <div>
          <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Correo Electrónico</label>
          <input
            type="email"
            className="fs-input"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Contraseña</label>
          <input
            type="password"
            className="fs-input"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="fs-btn fs-btn-accent" disabled={cargando}>
          {cargando ? 'Verificando credenciales...' : modo === 'login' ? 'Ingresar' : 'Registrarme'}
        </button>
      </form>

      <div
        style={{
          marginTop: '1rem',
          borderTop: '1px solid #e2e8f0',
          paddingTop: '0.85rem',
          fontSize: '0.84rem',
        }}
      >
        {modo === 'login' ? (
          <div>
            ¿Aún no tienes cuenta?{' '}
            <button className="fs-link" onClick={() => setModo('registro')}>
              Crear cuenta de cliente
            </button>
          </div>
        ) : (
          <div>
            ¿Ya tienes cuenta?{' '}
            <button className="fs-link" onClick={() => setModo('login')}>
              Iniciar sesión
            </button>
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          ¿Eres comerciante y deseas crear tu propia tienda?{' '}
          <button className="fs-link" onClick={() => setAbrirModalOnboarding(true)}>
            Crear Tienda SaaS (Trial 14 días)
          </button>
        </div>
      </div>
    </div>
  );
};
export default AuthPage;
