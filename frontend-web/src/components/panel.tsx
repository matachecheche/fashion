import React from 'react';

export const PanelHeader: React.FC<{
  titulo: string;
  subtitulo?: string;
  acciones?: React.ReactNode;
}> = ({ titulo, subtitulo, acciones }) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: '1rem',
      flexWrap: 'wrap',
      marginBottom: '1.25rem',
    }}
  >
    <div>
      <h1 style={{ margin: 0, fontSize: '1.45rem', fontWeight: 800 }}>{titulo}</h1>
      {subtitulo && (
        <p style={{ margin: '0.25rem 0 0', color: '#475569', fontSize: '0.9rem' }}>{subtitulo}</p>
      )}
    </div>
    {acciones && <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>{acciones}</div>}
  </div>
);

export const EmptyState: React.FC<{ mensaje: string }> = ({ mensaje }) => (
  <div
    className="fs-card"
    style={{ textAlign: 'center', padding: '2.5rem 1rem', color: '#64748b' }}
  >
    {mensaje}
  </div>
);
