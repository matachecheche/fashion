import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useApp } from '../context/App';
import { MANUAL_SECCIONES } from '../lib/manual';
import { createUuidV4 } from '../lib/format';
import { Modal } from './ui';

export const ModalsOnboardingYManual: React.FC = () => {
  const {
    abrirModalOnboarding,
    setAbrirModalOnboarding,
    abrirManual,
    setAbrirManual,
    cambiarTenant,
    iniciarSesion,
    mostrarToast,
  } = useApp();
  const navigate = useNavigate();

  const [nombreTienda, setNombreTienda] = useState('');
  const [slug, setSlug] = useState('');
  const [ciudad, setCiudad] = useState('Santa Cruz de la Sierra');
  const [adminNombre, setAdminNombre] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [nit, setNit] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [aceptaTrial, setAceptaTrial] = useState(true);
  const onboardingKeyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  const autogenerarSlug = (nombre: string) => {
    setNombreTienda(nombre);
    const limpio = nombre
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 45);
    setSlug(limpio);
    if (!adminEmail && limpio) {
      setAdminEmail(`admin@${limpio}.bo`);
    }
  };

  const registrarNuevaTienda = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreando(true);
    try {
      const body = {
        nombre_tienda: nombreTienda,
        slug,
        nit,
        ciudad,
        admin_nombre: adminNombre || `Admin ${nombreTienda}`,
        admin_email: adminEmail,
        admin_password: adminPassword,
        acepta_trial: aceptaTrial,
      };
      const fingerprint = JSON.stringify(body);
      if (!onboardingKeyRef.current || onboardingKeyRef.current.fingerprint !== fingerprint) {
        onboardingKeyRef.current = { fingerprint, key: createUuidV4() };
      }
      const res = await apiFetch('/tenants/registro', {
        method: 'POST',
        headers: { 'Idempotency-Key': onboardingKeyRef.current.key },
        body,
      });
      const nuevoSlug = res.tenant.slug;
      cambiarTenant(nuevoSlug);
      iniciarSesion(res.access_token || res.token, res.usuario);
      setAbrirModalOnboarding(false);
      mostrarToast(`¡Tienda '${nombreTienda}' creada con Trial gratuito de 14 días!`);
      navigate(`/tienda/${nuevoSlug}`);
    } catch (err: any) {
      setError(err?.message || 'No se pudo registrar la tienda.');
    } finally {
      setCreando(false);
    }
  };

  return (
    <>
      <Modal
        abierto={abrirModalOnboarding}
        titulo="🚀 Alta de Nueva Tienda SaaS (Trial 14 Días — Sin Cobro Real)"
        onCerrar={() => setAbrirModalOnboarding(false)}
        anchoMax={640}
      >
        <form onSubmit={registrarNuevaTienda} className="fs-grid" style={{ gap: '0.85rem' }}>
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: 8,
              padding: '0.75rem',
              fontSize: '0.83rem',
            }}
          >
            <strong>Aislamiento Multi-Tenant Garantizado:</strong> Tu tienda tendrá su propio espacio{' '}
            <code>/tienda/{slug || 'tu-boutique'}</code> protegido con PostgreSQL{' '}
            <code>FORCE ROW LEVEL SECURITY</code>. Incluye 14 días de prueba con tope de{' '}
            <strong>3 usuarios, 1 sucursal y 200 productos</strong>.
          </div>

          {error && (
            <div className="fs-badge fs-badge-danger" style={{ padding: '0.6rem', width: '100%' }}>
              {error}
            </div>
          )}

          <div>
            <label style={{ fontSize: '0.84rem', fontWeight: 600 }}>Nombre de la Boutique / Tienda *</label>
            <input
              className="fs-input"
              required
              placeholder="Ej: Atelier Andino"
              value={nombreTienda}
              onChange={(e) => autogenerarSlug(e.target.value)}
            />
          </div>

          <div>
            <label style={{ fontSize: '0.84rem', fontWeight: 600 }}>NIT de la empresa *</label>
            <input
              className="fs-input"
              required
              minLength={4}
              maxLength={40}
              inputMode="numeric"
              placeholder="Ej: 1234567890"
              value={nit}
              onChange={(e) => setNit(e.target.value.trim())}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.84rem', fontWeight: 600 }}>Identificador URL (slug) *</label>
              <input
                className="fs-input"
                required
                pattern="^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.84rem', fontWeight: 600 }}>Ciudad Principal *</label>
              <input
                className="fs-input"
                required
                value={ciudad}
                onChange={(e) => setCiudad(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.84rem', fontWeight: 600 }}>Nombre del Administrador *</label>
              <input
                className="fs-input"
                required
                placeholder="Ej: Valeria Suarez"
                value={adminNombre}
                onChange={(e) => setAdminNombre(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.84rem', fontWeight: 600 }}>Correo del Administrador *</label>
              <input
                className="fs-input"
                type="email"
                required
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '0.84rem', fontWeight: 600 }}>Contraseña Inicial *</label>
            <input
              className="fs-input"
              type="text"
              required
              minLength={8}
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.84rem' }}>
            <input
              type="checkbox"
              checked={aceptaTrial}
              onChange={(e) => setAceptaTrial(e.target.checked)}
              required
            />
            Acepto el Trial gratuito de 14 días. Al vencer, la tienda quedará en solo lectura y conservará sus datos.
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
            <button
              type="button"
              className="fs-btn fs-btn-outline"
              onClick={() => setAbrirModalOnboarding(false)}
            >
              Cancelar
            </button>
            <button type="submit" className="fs-btn fs-btn-accent" disabled={creando}>
              {creando ? 'Creando Tienda...' : 'Crear Tienda Ahora'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        abierto={abrirManual}
        titulo="📖 Manual Interactivo Contextual — FashionStore SaaS"
        onCerrar={() => setAbrirManual(false)}
        anchoMax={740}
      >
        <div className="fs-grid" style={{ gap: '1rem' }}>
          {MANUAL_SECCIONES.map((sec) => (
            <div
              key={sec.id}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                padding: '0.9rem 1rem',
                background: '#f8fafc',
              }}
            >
              <h4 style={{ margin: '0 0 0.35rem', color: '#0f172a' }}>{sec.titulo}</h4>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.86rem', color: '#334155' }}>
                {sec.resumen}
              </p>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.83rem', color: '#475569' }}>
                {sec.pasos.map((p, idx) => (
                  <li key={idx} style={{ marginBottom: 4 }}>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
};
export default ModalsOnboardingYManual;
