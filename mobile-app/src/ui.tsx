/** Sistema visual común de FashionStore Mobile. Mantener las pantallas sobre estas primitivas. */
import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';

export const Colores = {
  fondo: '#F7F6F3',
  card: '#FFFFFF',
  tinta: '#1D2935',
  texto: '#46525E',
  suave: '#77818B',
  borde: '#E7E5E0',
  acento: '#A86B43',
  acentoOscuro: '#855033',
  acentoSuave: '#F7EEE7',
  ok: '#247A59',
  error: '#B54747',
  warn: '#B7791F',
  superficie: '#F0EFEB',
  oscuro: '#17252B',
};

export const Estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: Colores.fondo },
  contenedor: { flex: 1, backgroundColor: Colores.fondo },
  scroll: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 36,
    width: '100%',
    maxWidth: 980,
    alignSelf: 'center',
  },
  card: {
    backgroundColor: Colores.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colores.borde,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#17252B',
    shadowOpacity: 0.035,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  titulo: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
    color: Colores.tinta,
    letterSpacing: -0.45,
  },
  subtitulo: { fontSize: 13, lineHeight: 19, color: Colores.suave, marginTop: 4 },
  h3: { fontSize: 16, lineHeight: 22, fontWeight: '800', color: Colores.tinta, marginBottom: 7 },
  texto: { fontSize: 14, color: Colores.texto, lineHeight: 21 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
    fontSize: 10,
    letterSpacing: 0.45,
    fontWeight: '800',
    color: '#fff',
  },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: '#DEDDD7',
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: Colores.tinta,
    backgroundColor: '#FFFFFF',
  },
  label: { fontSize: 12, fontWeight: '800', color: Colores.texto, marginBottom: 6 },
});

export const Tarjeta: React.FC<{ children: React.ReactNode; style?: ViewStyle }> = ({ children, style }) => (
  <View style={[Estilos.card, style]}>{children}</View>
);

export const Boton: React.FC<{
  titulo: string;
  onPress: () => void;
  variante?: 'primario' | 'acento' | 'outline' | 'peligro' | 'ok';
  deshabilitado?: boolean;
  estilo?: ViewStyle;
}> = ({ titulo, onPress, variante = 'primario', deshabilitado, estilo }) => {
  const palette = {
    primario: { backgroundColor: Colores.tinta, borderColor: Colores.tinta, text: '#FFFFFF' },
    acento: { backgroundColor: Colores.acento, borderColor: Colores.acento, text: '#FFFFFF' },
    outline: { backgroundColor: '#FFFFFF', borderColor: Colores.borde, text: Colores.tinta },
    peligro: { backgroundColor: Colores.error, borderColor: Colores.error, text: '#FFFFFF' },
    ok: { backgroundColor: Colores.ok, borderColor: Colores.ok, text: '#FFFFFF' },
  }[variante];

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(deshabilitado) }}
      disabled={deshabilitado}
      activeOpacity={0.82}
      onPress={onPress}
      style={[
        {
          minHeight: 48,
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderRadius: 13,
          borderWidth: 1,
          alignItems: 'center',
          justifyContent: 'center',
        },
        { backgroundColor: palette.backgroundColor, borderColor: palette.borderColor },
        deshabilitado && { opacity: 0.45 },
        estilo,
      ]}
    >
      <Text style={{ color: palette.text, fontWeight: '800', fontSize: 14, textAlign: 'center' }}>
        {titulo}
      </Text>
    </TouchableOpacity>
  );
};

export const Cargando: React.FC<{ texto?: string }> = ({ texto }) => (
  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: Colores.fondo }}>
    <ActivityIndicator size="large" color={Colores.acento} />
    {texto ? <Text style={[Estilos.texto, { marginTop: 14 }]}>{texto}</Text> : null}
  </View>
);

export const BadgeEstado: React.FC<{ estado: string }> = ({ estado }) => {
  const norm = String(estado || '').toLowerCase();
  const success = ['aprobado', 'pagada', 'sincronizada', 'activo', 'finalizada', 'entregada', 'confirmada'];
  const pending = ['pendiente', 'pendiente_pago', 'no_confirmado', 'preparada', 'en_atencion', 'trial'];
  const neutral = ['leida', 'admin', 'encargado', 'cajero', 'proveedor', 'cliente'];
  const color = success.includes(norm) ? Colores.ok : pending.includes(norm) ? Colores.warn : neutral.includes(norm) ? Colores.suave : Colores.error;
  const background = success.includes(norm) ? '#E7F3ED' : pending.includes(norm) ? '#FBF1DE' : neutral.includes(norm) ? Colores.superficie : '#F8EAEA';
  return (
    <View style={{ backgroundColor: background, borderRadius: 999, alignSelf: 'flex-start' }}>
      <Text style={[Estilos.badge, { color, backgroundColor: 'transparent' }]}>{norm.replace(/_/g, ' ').toUpperCase()}</Text>
    </View>
  );
};

export interface EncabezadoPantalla {
  titulo: string;
  subtitulo?: string;
}

export const Encabezado: React.FC<EncabezadoPantalla> = ({ titulo, subtitulo }) => (
  <View style={{ marginBottom: 18 }}>
    <Text style={Estilos.titulo}>{titulo}</Text>
    {subtitulo ? <Text style={Estilos.subtitulo}>{subtitulo}</Text> : null}
  </View>
);

export const Seccion: React.FC<{ titulo: string; accion?: React.ReactNode; children?: React.ReactNode }> = ({ titulo, accion, children }) => (
  <View style={{ marginBottom: 14 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
      <Text style={Estilos.h3}>{titulo}</Text>
      {accion}
    </View>
    {children}
  </View>
);
