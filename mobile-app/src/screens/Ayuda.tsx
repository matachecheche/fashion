import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { MANUAL_SECCIONES } from '../manual';
import { Colores, Encabezado, Estilos, Tarjeta } from '../ui';

export const AyudaScreen: React.FC = () => (
  <ScrollView style={Estilos.contenedor} contentContainerStyle={Estilos.scroll}>
    <Encabezado
      titulo="❓ Centro de Ayuda"
      subtitulo="Guía rápida del ecosistema FashionStore (disponible offline)."
    />
    {MANUAL_SECCIONES.map((seccion) => (
      <Tarjeta key={seccion.id}>
        <Text style={Estilos.h3}>{seccion.titulo}</Text>
        <Text style={[Estilos.texto, { marginBottom: 8 }]}>{seccion.resumen}</Text>
        {seccion.pasos.map((paso, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
            <Text style={{ color: Colores.acento, fontWeight: '900' }}>{i + 1}.</Text>
            <Text style={[Estilos.texto, { flex: 1 }]}>{paso}</Text>
          </View>
        ))}
      </Tarjeta>
    ))}
  </ScrollView>
);
export default AyudaScreen;
