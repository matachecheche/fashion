import React from 'react';
import { MANUAL_SECCIONES } from '../../lib/manual';

export const AyudaPage: React.FC = () => {
  return (
    <div className="fs-grid" style={{ gap: '1.25rem', maxWidth: 980, margin: '0 auto' }}>
      <div className="fs-card">
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>📖 Centro de Ayuda y Manual de Usuario</h1>
        <p style={{ margin: '0.3rem 0 0', color: '#475569', fontSize: '0.9rem' }}>
          Guía operativa completa del ecosistema FashionStore SaaS (tienda web, panel de gestión,
          Vestidor AR, pasarelas de pago Sandbox y modo offline-first).
        </p>
      </div>

      {MANUAL_SECCIONES.map((seccion) => (
        <div key={seccion.id} className="fs-card">
          <h2 style={{ fontSize: '1.15rem', marginTop: 0, color: '#0f172a' }}>{seccion.titulo}</h2>
          <p style={{ fontSize: '0.92rem', color: '#334155', marginTop: 0 }}>{seccion.resumen}</p>
          <ul style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.65, marginBottom: 0 }}>
            {seccion.pasos.map((paso, i) => (
              <li key={i}>{paso}</li>
            ))}
          </ul>
          <div style={{ marginTop: '0.6rem', fontSize: '0.75rem', color: '#64748b' }}>
            Roles: {seccion.roles.join(', ')}
          </div>
        </div>
      ))}
    </div>
  );
};
export default AyudaPage;
