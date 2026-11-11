/**
 * Vestidor Virtual AR móvil.
 *
 * - Con cámara: overlay de la prenda (PNG transparente -ar) sobre la vista previa
 *   con arrastre de un dedo y botones de escala (±). Botón de captura guarda la FOTO.
 * - Sin cámara: silueta interactiva con los mismos controles (fallback offline).
 * - "Guardar look" registra tipo/color/escala/posición en el dispositivo (AsyncStorage).
 * - "Tracking corporal (beta)" abre un WebView con MediaPipe (requiere red para el modelo).
 *   Nunca es obligatorio: el vestidor funciona sin él.
 *
 * Nota honesta: el overlay compuesto no se fusiona en la foto guardada; la captura es
 * la imagen de la cámara y el ajuste AR queda guardado como configuración del look.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  useWindowDimensions,
  Image,
  Modal,
  PanResponder,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { apiFetch } from '../api';
import { apiAssetUrl } from '../config';
import { useApp } from '../context';
import { useNav } from '../navigation';
import { SEGUIMIENTO_HTML } from '../seguimientoHtml';
import { Boton, Colores, Estilos, Tarjeta } from '../ui';

const TIPOS = ['blusa', 'camiseta', 'cartera', 'chaqueta', 'falda', 'pantalon', 'vestido', 'zapato'];
const COLORES = ['azul', 'beige', 'blanco', 'camel', 'celeste', 'gris', 'mostaza', 'negro', 'rojo', 'rosado', 'verde', 'vino'];
const LOOKS_KEY = 'fs_mobile_looks_v1';

export const ProbadorARScreen: React.FC<{ navParams?: any }> = ({ navParams }) => {
  const { tenantSlug, mostrarToast } = useApp();
  const nav = useNav();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const canvasHeight = Math.min(500, Math.max(320, screenHeight * 0.43));
  const overlayWidth = Math.min(220, Math.max(170, screenWidth - 76));
  const overlayHeight = overlayWidth * 1.41;
  const [permiso, solicitarPermiso] = useCameraPermissions();
  const [tipo, setTipo] = useState<string>(navParams?.tipo || 'vestido');
  const [color, setColor] = useState<string>(navParams?.color || 'rojo');
  const [escala, setEscala] = useState(1.0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [altura, setAltura] = useState('168');
  const [peso, setPeso] = useState('64');
  const [talla, setTalla] = useState<any | null>(null);
  const [tracking, setTracking] = useState(false);
  const [looks, setLooks] = useState<any[]>([]);
  const [usandoCamara, setUsandoCamara] = useState(true);
  const camaraRef = useRef<CameraView>(null);
  const offsetRef = useRef(offset);
  const panStartRef = useRef(offset);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  const applyOffset = (next: { x: number; y: number }) => {
    offsetRef.current = next;
    setOffset(next);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        panStartRef.current = offsetRef.current;
      },
      onPanResponderMove: (_, g) => {
        applyOffset({
          x: panStartRef.current.x + g.dx * 0.35,
          y: panStartRef.current.y + g.dy * 0.35,
        });
      },
    }),
  ).current;

  useEffect(() => {
    AsyncStorage.getItem(LOOKS_KEY)
      .then((raw) => setLooks(raw ? JSON.parse(raw) : []))
      .catch(() => setLooks([]));
  }, []);

  const overlayUrl = useMemo(
    () => apiAssetUrl(`/assets/prendas/${tipo}-${color}-ar.png`),
    [tipo, color],
  );
  const fotoUrl = useMemo(
    () => apiAssetUrl(`/assets/prendas/${tipo}-${color}-foto.jpg`),
    [tipo, color],
  );

  const sugerirTalla = async () => {
    const h = Number(altura);
    const p = Number(peso);
    if (!h || !p) {
      mostrarToast('Ingresa altura (cm) y peso (kg) válidos.');
      return;
    }
    try {
      const res = await apiFetch('/ia/talla', {
        method: 'POST',
        tenantSlug,
        body: { altura_cm: h, peso_kg: p, tipo_prenda: tipo },
      });
      setTalla(res);
    } catch {
      const imc = p / Math.pow(h / 100, 2);
      const tallaLocal = imc < 20 ? 'S' : imc < 25 ? 'M' : imc < 30 ? 'L' : 'XL';
      setTalla({ fuente: 'local (offline)', talla_sugerida: tallaLocal, imc: imc.toFixed(1), confianza: 0.6 });
    }
  };

  const capturar = async () => {
    try {
      const foto = await camaraRef.current?.takePictureAsync({ quality: 0.85, skipProcessing: true });
      if (foto?.uri) {
        const disponible = await Sharing.isAvailableAsync();
        if (disponible) await Sharing.shareAsync(foto.uri);
        else mostrarToast(`Foto guardada: ${foto.uri}`);
      }
    } catch (e: any) {
      mostrarToast(`No se pudo capturar: ${e?.message || 'cámara no disponible'}`);
    }
  };

  const guardarLook = async () => {
    const look = {
      id: `LOOK-${Date.now()}`,
      tipo,
      color,
      escala,
      offset,
      producto_id: navParams?.productoId ?? null,
      fecha: new Date().toISOString(),
    };
    const next = [look, ...looks].slice(0, 30);
    setLooks(next);
    await AsyncStorage.setItem(LOOKS_KEY, JSON.stringify(next));
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    mostrarToast('Look guardado en este dispositivo.');
  };

  const cargarLook = (look: any) => {
    setTipo(look.tipo);
    setColor(look.color);
    setEscala(look.escala ?? 1);
    setOffset(look.offset ?? { x: 0, y: 0 });
  };

  const confianzaCamara = permiso?.granted && usandoCamara;

  return (
    <ScrollView style={Estilos.contenedor} contentContainerStyle={Estilos.scroll}>
      <Text style={Estilos.titulo}>🪞 Vestidor Virtual AR</Text>
      <Text style={Estilos.subtitulo}>
        Superposición de prendas con overlay transparente. Arrastra con un dedo; escala con los botones.
      </Text>
      <View style={{ height: 10 }} />

      {/* Lienzo AR */}
      <View
        style={{
          height: canvasHeight,
          borderRadius: 18,
          overflow: 'hidden',
          backgroundColor: '#0f172a',
          borderWidth: 1,
          borderColor: '#1e293b',
        }}
        {...pan.panHandlers}
      >
        {confianzaCamara ? (
          <CameraView ref={camaraRef} style={{ flex: 1 }} facing="front" mute />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {/* Silueta de referencia (fallback sin cámara) */}
            <View
              style={{
                width: Math.min(150, screenWidth * 0.42),
                height: Math.min(300, canvasHeight * 0.72),
                borderRadius: 80,
                borderWidth: 6,
                borderColor: '#475569',
                opacity: 0.6,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  borderWidth: 5,
                  borderColor: '#475569',
                  marginTop: -Math.min(210, canvasHeight * 0.5),
                }}
              />
            </View>
            <Text style={{ color: '#94a3b8', fontSize: 12, marginTop: 16, textAlign: 'center', paddingHorizontal: 24 }}>
              {permiso && !permiso.granted
                ? 'Permiso de cámara denegado. Modo silueta activo.'
                : 'Vista de silueta (sin cámara).'}
            </Text>
          </View>
        )}

        <Image
          source={{ uri: overlayUrl }}
          resizeMode="contain"
          style={{
            position: 'absolute',
            width: overlayWidth,
            height: overlayHeight,
            left: (screenWidth - 36 - overlayWidth) / 2 + offset.x,
            top: Math.max(28, canvasHeight * 0.16) + offset.y,
            transform: [{ scale: escala }],
          }}
        />

        <View
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            backgroundColor: 'rgba(15,23,42,0.75)',
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 5,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 11 }}>
            {confianzaCamara ? '📹 Cámara en vivo' : '🧍 Silueta'} · {tipo}/{color} · {escala.toFixed(2)}x
          </Text>
        </View>
      </View>

      {/* Controles cámara / captura */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        {!permiso?.granted ? (
          <View style={{ flex: 1 }}>
            <Boton titulo="📹 Permitir cámara" variante="acento" onPress={solicitarPermiso} />
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <Boton
              titulo={usandoCamara ? '🧍 Usar silueta' : '📹 Usar cámara'}
              variante="outline"
              onPress={() => setUsandoCamara(!usandoCamara)}
            />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Boton titulo="🎯 Auto-calibrar" variante="outline" onPress={() => { setEscala(1.05); setOffset({ x: 0, y: 0 }); }} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <View style={{ flex: 1 }}>
          <Boton titulo="📸 Capturar foto" variante="acento" onPress={capturar} deshabilitado={!confianzaCamara} />
        </View>
        <View style={{ flex: 1 }}>
          <Boton titulo="💾 Guardar look" variante="ok" onPress={guardarLook} />
        </View>
      </View>
      <View style={{ height: 8 }} />
      <Boton titulo="Tracking corporal (beta, requiere red)" variante="outline" onPress={() => setTracking(true)} />

      {/* Selector de prenda */}
      <Tarjeta style={{ marginTop: 12 }}>
        <Text style={Estilos.h3}>Prenda y color (8 × 12 = 96 overlays AR)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {TIPOS.map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setTipo(t)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 8,
                marginRight: 6,
                backgroundColor: tipo === t ? Colores.tinta : '#e2e8f0',
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: '800', color: tipo === t ? '#fff' : Colores.texto }}>
                {t.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={{ height: 8 }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {COLORES.map((c) => (
            <TouchableOpacity
              key={c}
              onPress={() => setColor(c)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 8,
                marginRight: 6,
                backgroundColor: color === c ? Colores.acento : '#e2e8f0',
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: '800', color: color === c ? '#fff' : Colores.texto }}>
                {c.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={{ height: 10 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={Estilos.label}>Escala {escala.toFixed(2)}x</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity onPress={() => setEscala((s) => Math.max(0.5, +(s - 0.1).toFixed(2)))} style={{ backgroundColor: '#e2e8f0', borderRadius: 8, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 18, fontWeight: '900' }}>−</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEscala((s) => Math.min(1.8, +(s + 0.1).toFixed(2)))} style={{ backgroundColor: '#e2e8f0', borderRadius: 8, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 18, fontWeight: '900' }}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={{ height: 6 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[Estilos.label, { marginBottom: 0 }]}>Posición ({Math.round(offset.x)}, {Math.round(offset.y)})</Text>
          <TouchableOpacity onPress={() => setOffset({ x: 0, y: 0 })}>
            <Text style={{ color: Colores.acentoOscuro, fontWeight: '700', fontSize: 12 }}>Centrar</Text>
          </TouchableOpacity>
        </View>
      </Tarjeta>

      {/* Calculadora de talla */}
      <Tarjeta>
        <Text style={Estilos.h3}>📏 Talla sugerida (IA)</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={Estilos.label}>Altura (cm)</Text>
            <TextInput style={Estilos.input} keyboardType="numeric" value={altura} onChangeText={setAltura} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={Estilos.label}>Peso (kg)</Text>
            <TextInput style={Estilos.input} keyboardType="numeric" value={peso} onChangeText={setPeso} />
          </View>
        </View>
        <View style={{ height: 8 }} />
        <Boton titulo="Calcular talla" onPress={sugerirTalla} />
        {talla && (
          <Text style={{ marginTop: 8, color: Colores.ok, fontWeight: '800' }}>
            Talla {talla.talla_sugerida} · IMC {talla.imc} · Fuente: {talla.fuente || 'servidor'}
          </Text>
        )}
      </Tarjeta>

      {/* Referencia de catálogo */}
      <Tarjeta>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Image source={{ uri: fotoUrl }} style={{ width: 84, height: 118, borderRadius: 10, backgroundColor: '#f1f5f9' }} />
          <View style={{ flex: 1 }}>
            <Text style={Estilos.h3}>Foto de catálogo (referencia)</Text>
            <Text style={[Estilos.texto, { fontSize: 11 }]}>
              Overlay AR: /assets/prendas/{tipo}-{color}-ar.png{'\n'}Foto: /assets/prendas/{tipo}-{color}-foto.jpg
            </Text>
          </View>
        </View>
      </Tarjeta>

      {/* Looks guardados */}
      {looks.length > 0 && (
        <Tarjeta>
          <Text style={Estilos.h3}>💾 Mis looks guardados</Text>
          {looks.slice(0, 6).map((l) => (
            <TouchableOpacity
              key={l.id}
              onPress={() => cargarLook(l)}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingVertical: 8,
                borderBottomWidth: 1,
                borderBottomColor: '#f1f5f9',
              }}
            >
              <Text style={Estilos.texto}>{l.tipo} / {l.color} · {Number(l.escala).toFixed(2)}x</Text>
              <Text style={{ fontSize: 11, color: Colores.suave }}>{new Date(l.fecha).toLocaleDateString()}</Text>
            </TouchableOpacity>
          ))}
        </Tarjeta>
      )}

      {/* WebView tracking */}
      <Modal visible={tracking} animationType="slide" onRequestClose={() => setTracking(false)}>
        <View style={{ flex: 1, backgroundColor: '#0f172a' }}>
          <View style={{ padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontWeight: '800' }}>Tracking corporal (beta)</Text>
            <TouchableOpacity onPress={() => setTracking(false)} style={{ padding: 8 }}>
              <Text style={{ color: '#fbbf24', fontWeight: '800' }}>Cerrar ✕</Text>
            </TouchableOpacity>
          </View>
          <WebView
            source={{ html: SEGUIMIENTO_HTML }}
            style={{ flex: 1 }}
            mediaPlaybackRequiresUserAction={false}
            onMessage={(e) => {
              try {
                const msg = JSON.parse(e.nativeEvent.data);
                if (msg?.tipo === 'landmarks' && msg.ancho_hombros_px) {
                  // Calibración guiada: ajusta escala según ancho de hombros estimado (210px base)
                  setEscala(Math.min(1.6, Math.max(0.6, msg.ancho_hombros_px / 210)));
                }
              } catch {
                /* mensaje no JSON: ignorar */
              }
            }}
          />
        </View>
      </Modal>
    </ScrollView>
  );
};
export default ProbadorARScreen;
