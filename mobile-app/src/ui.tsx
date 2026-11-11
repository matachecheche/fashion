/**
 * Primitivas UI compartidas (sin dependencias externas de diseño).
 */
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
  fondo: '#f8fafc',
  card: '#ffffff',
  tinta: '#0f172a',
  texto: '#334155',
  suave: '#64748b',
  borde: '#e2e8f0',
  acento: '#b45309',
  acentoOscuro: '#92400e',
  ok: '#15803d',
  error: '#b91c1c',
  warn: '#d97706',
};

export const Estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: Colores.fondo },
  contenedor: { flex: 1, backgroundColor: Colores.fondo },
  scroll: { padding: 16, paddingBottom: 48 },
  card: {
    backgroundColor: Colores.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colores.borde,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  titulo: { fontSize: 22, fontWeight: '800', color: Colores.tinta },
  subtitulo: { fontSize: 13, color: Colores.suave, marginTop: 2 },
  h3: { fontSize: 15, fontWeight: '700', color: Colores.tinta, marginBottom: 6 },
  texto: { fontSize: 13, color: Colores.texto, lineHeight: 18 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
  },
  input: {
    borderWidth: 1,
    borderColor: Colores.borde,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colores.tinta,
    backgroundColor: '#fff',
  },
  label: { fontSize: 12, fontWeight: '700', color: Colores.texto, marginBottom: 4 },
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
  const base: ViewStyle =
    variante === 'acento'
      ? { backgroundColor: Colores.acento }
      : variante === 'peligro'
        ? { backgroundColor: Colores.error }
        : variante === 'ok'
          ? { backgroundColor: Colores.ok }
          : variante === 'outline'
            ? { backgroundColor: '#fff', borderWidth: 1, borderColor: Colores.tinta }
            : { backgroundColor: Colores.tinta };
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={deshabilitado}
      onPress={onPress}
      style={[
        { paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
        base,
        deshabilitado && { opacity: 0.45 },
        estilo,
      ]}
    >
      <Text
        style={{
          color: variante === 'outline' ? Colores.tinta : '#fff',
          fontWeight: '800',
          fontSize: 14,
        }}
      >
        {titulo}
      </Text>
    </TouchableOpacity>
  );
};

export const Cargando: React.FC<{ texto?: string }> = ({ texto }) => (
  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
    <ActivityIndicator size="large" color={Colores.acento} />
    {texto ? <Text style={[Estilos.texto, { marginTop: 12 }]}>{texto}</Text> : null}
  </View>
);

export const BadgeEstado: React.FC<{ estado: string }> = ({ estado }) => {
  const norm = String(estado || '').toLowerCase();
  const color = ['aprobado', 'pagada', 'sincronizada', 'activo', 'finalizada', 'entregada'].includes(norm)
    ? Colores.ok
    : ['pendiente', 'pendiente_pago', 'no_confirmado', 'preparada', 'en_atencion', 'trial'].includes(norm)
      ? Colores.warn
      : Colores.error;
  return (
    <View style={{ backgroundColor: color, borderRadius: 999, alignSelf: 'flex-start' }}>
      <Text style={Estilos.badge}>{norm.toUpperCase()}</Text>
    </View>
  );
};

export interface EncabezadoPantalla {
  titulo: string;
  subtitulo?: string;
}

export const Encabezado: React.FC<EncabezadoPantalla> = ({ titulo, subtitulo }) => (
  <View style={{ marginBottom: 12 }}>
    <Text style={Estilos.titulo}>{titulo}</Text>
    {subtitulo ? <Text style={Estilos.subtitulo}>{subtitulo}</Text> : null}
  </View>
);
