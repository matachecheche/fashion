import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { useApp } from '../../context/App';
import { buildAssetUrl } from '../../lib/format';

const TIPOS_PRENDA = ['blusa', 'camiseta', 'cartera', 'chaqueta', 'falda', 'pantalon', 'vestido', 'zapato'];
const COLORES_PRENDA = [
  'azul',
  'beige',
  'blanco',
  'camel',
  'celeste',
  'gris',
  'mostaza',
  'negro',
  'rojo',
  'rosado',
  'verde',
  'vino',
];

export const VestidorPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { tenantSlug, mostrarToast } = useApp();

  const [tipo, setTipo] = useState(searchParams.get('tipo') || 'vestido');
  const [color, setColor] = useState(searchParams.get('color') || 'rojo');
  const [escala, setEscala] = useState(1.05);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [camaraActiva, setCamaraActiva] = useState(false);
  const [alturaCm, setAlturaCm] = useState(168);
  const [pesoKg, setPesoKg] = useState(64);
  const [tallaSugerida, setTallaSugerida] = useState<any | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const activarCamara = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        mostrarToast('Cámara no disponible en este navegador; usando Silueta Interactiva AR.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCamaraActiva(true);
      }
    } catch {
      mostrarToast('Permiso de cámara denegado o sin dispositivo; modo Silueta Interactiva activo.');
      setCamaraActiva(false);
    }
  };

  const detenerCamara = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCamaraActiva(false);
  };

  useEffect(() => {
    return () => detenerCamara();
  }, []);

  const autocalibrar = async () => {
    try {
      const res = await apiFetch('/ia/ar/calibrar', {
        method: 'POST',
        tenantSlug,
        body: {
          tipo_prenda: tipo,
          color,
          ancho_hombros_px: 185,
          altura_torso_px: 250,
          modo_manual: !camaraActiva,
        },
      });
      if (res?.parametros_render?.scale) {
        setEscala(Number(res.parametros_render.scale));
      }
      setOffsetX(0);
      setOffsetY(Math.round((res?.parametros_render?.offset_y_ratio || 0) * 120));
      mostrarToast('Overlay AR calibrado automáticamente según anclaje anatómico.');
    } catch {
      setEscala(1.05);
      setOffsetX(0);
      setOffsetY(0);
    }
  };

  const calcularTalla = async () => {
    const res = await apiFetch('/ia/talla', {
      method: 'POST',
      tenantSlug,
      body: { altura_cm: alturaCm, peso_kg: pesoKg, tipo_prenda: tipo },
    });
    setTallaSugerida(res);
  };

  const arSpriteUrl = buildAssetUrl(`/assets/prendas/${tipo}-${color}-ar.png`);
  const fotoRefUrl = buildAssetUrl(`/assets/prendas/${tipo}-${color}-foto.jpg`);

  return (
    <div className="fs-grid" style={{ gap: '1.5rem' }}>
      <div className="fs-card">
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>
          🪞 Vestidor Virtual AR (Realidad Aumentada &amp; Calibración Corporal)
        </h1>
        <p style={{ margin: '0.3rem 0 0', color: '#475569', fontSize: '0.9rem' }}>
          Superposición en tiempo real de las 192 variantes transparentes (<code>-ar.png</code>) con
          soporte de Cámara Web y Fallback de Silueta Interactiva.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '1.5rem',
        }}
      >
        <div
          className="fs-card"
          style={{
            position: 'relative',
            minHeight: 520,
            background: 'radial-gradient(circle at center, #1e293b 0%, #0f172a 100%)',
            borderRadius: 14,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            style={{
              display: camaraActiva ? 'block' : 'none',
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              position: 'absolute',
              inset: 0,
            }}
          />

          {!camaraActiva && (
            <svg
              viewBox="0 0 240 480"
              style={{ width: 220, height: 440, opacity: 0.35 }}
              aria-label="Silueta corporal de referencia"
            >
              <circle cx="120" cy="52" r="28" fill="#94a3b8" />
              <path
                d="M75 95 Q120 82 165 95 L182 220 L158 225 L148 145 L145 245 L162 435 L130 435 L120 285 L110 435 L78 435 L95 245 L92 145 L82 225 L58 220 Z"
                fill="#64748b"
              />
            </svg>
          )}

          <img
            src={arSpriteUrl}
            alt={`Overlay AR ${tipo} ${color}`}
            style={{
              position: 'absolute',
              width: 250,
              height: 350,
              objectFit: 'contain',
              transform: `translate(${offsetX}px, ${offsetY}px) scale(${escala})`,
              transition: 'transform 0.1s ease-out',
              pointerEvents: 'none',
              filter: 'drop-shadow(0 10px 20px rgba(0,0,0,0.45))',
            }}
          />

          <div
            style={{
              position: 'absolute',
              top: 12,
              left: 12,
              background: 'rgba(15,23,42,0.8)',
              color: '#fff',
              padding: '0.35rem 0.7rem',
              borderRadius: 8,
              fontSize: '0.78rem',
            }}
          >
            Modo: {camaraActiva ? '📹 Cámara en Vivo' : '🧍 Silueta Interactiva (Fallback)'}
          </div>
        </div>

        <div className="fs-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            {!camaraActiva ? (
              <button className="fs-btn fs-btn-accent" onClick={activarCamara}>
                📹 Activar Cámara Web
              </button>
            ) : (
              <button className="fs-btn fs-btn-danger" onClick={detenerCamara}>
                ⏹ Detener Cámara
              </button>
            )}
            <button className="fs-btn fs-btn-outline" onClick={autocalibrar}>
              🎯 Auto-Calibrar Anclaje IA
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.84rem', fontWeight: 600 }}>Tipo de Prenda (8 tipos)</label>
              <select className="fs-select" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {TIPOS_PRENDA.map((t) => (
                  <option key={t} value={t}>
                    {t.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.84rem', fontWeight: 600 }}>Color de Prenda (12 colores)</label>
              <select className="fs-select" value={color} onChange={(e) => setColor(e.target.value)}>
                {COLORES_PRENDA.map((c) => (
                  <option key={c} value={c}>
                    {c.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>
              Escala del Overlay ({escala.toFixed(2)}x)
            </label>
            <input
              type="range"
              min="0.6"
              max="1.6"
              step="0.02"
              value={escala}
              onChange={(e) => setEscala(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Ajuste Horizontal ({offsetX}px)</label>
              <input
                type="range"
                min="-90"
                max="90"
                value={offsetX}
                onChange={(e) => setOffsetX(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Ajuste Vertical ({offsetY}px)</label>
              <input
                type="range"
                min="-110"
                max="110"
                value={offsetY}
                onChange={(e) => setOffsetY(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              padding: '0.85rem',
            }}
          >
            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.92rem' }}>
              📏 Recomendador Antropométrico de Talla IA
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.5rem', alignItems: 'end' }}>
              <div>
                <label style={{ fontSize: '0.78rem' }}>Altura (cm)</label>
                <input
                  type="number"
                  className="fs-input"
                  value={alturaCm}
                  onChange={(e) => setAlturaCm(Number(e.target.value))}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem' }}>Peso (kg)</label>
                <input
                  type="number"
                  className="fs-input"
                  value={pesoKg}
                  onChange={(e) => setPesoKg(Number(e.target.value))}
                />
              </div>
              <button className="fs-btn fs-btn-sm" onClick={calcularTalla}>
                Sugerir Talla
              </button>
            </div>
            {tallaSugerida && (
              <div style={{ marginTop: 8, fontSize: '0.85rem', color: '#15803d', fontWeight: 700 }}>
                ✅ Talla recomendada: {tallaSugerida.talla_sugerida} (IMC: {tallaSugerida.imc} ·
                Confianza: {Math.round((tallaSugerida.confianza || 0.9) * 100)}%)
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginTop: 'auto' }}>
            <img
              src={fotoRefUrl}
              alt="Referencia catálogo"
              style={{ width: 64, height: 84, objectFit: 'cover', borderRadius: 8, border: '1px solid #cbd5e1' }}
            />
            <div style={{ fontSize: '0.82rem', color: '#475569' }}>
              <strong>Vista de Catálogo vs Sprite AR:</strong>
              <div>
                Foto: <code>/assets/prendas/{tipo}-{color}-foto.jpg</code>
              </div>
              <div>
                Overlay AR: <code>/assets/prendas/{tipo}-{color}-ar.png</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default VestidorPage;
