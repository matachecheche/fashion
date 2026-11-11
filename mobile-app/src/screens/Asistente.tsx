import React, { useState } from 'react';
import { FlatList, Text, TextInput, View, TouchableOpacity } from 'react-native';
import { apiFetch } from '../api';
import { useApp } from '../context';
import { Colores, Encabezado, Estilos, Tarjeta } from '../ui';

interface Mensaje {
  id: string;
  rol: 'user' | 'assistant';
  texto: string;
}

const SUGERENCIAS = [
  '¿Qué prendas combinan con un vestido vino?',
  'Recomiéndame algo para una boda en diciembre',
  '¿Cuál es mi talla según mi peso/altura?',
];

export const AsistenteScreen: React.FC = () => {
  const { tenantSlug } = useApp();
  const [mensajes, setMensajes] = useState<Mensaje[]>([
    {
      id: 'bienvenida',
      rol: 'assistant',
      texto: '¡Hola! Soy el asistente de FashionStore. Pregúntame por combinaciones, tallas o tendencias.',
    },
  ]);
  const [texto, setTexto] = useState('');
  const [cargando, setCargando] = useState(false);

  const enviar = async (pregunta?: string) => {
    const consulta = (pregunta ?? texto).trim();
    if (!consulta || cargando) return;
    setTexto('');
    const userMsg: Mensaje = { id: `u-${Date.now()}`, rol: 'user', texto: consulta };
    setMensajes((prev) => [...prev, userMsg]);
    setCargando(true);
    try {
      const res = await apiFetch('/ia/chat', {
        method: 'POST',
        tenantSlug,
        body: { mensaje: consulta },
      });
      const respuesta =
        res?.respuesta || res?.message || res?.texto || 'No pude generar una respuesta ahora.';
      setMensajes((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, rol: 'assistant', texto: String(respuesta) },
      ]);
    } catch (err: any) {
      setMensajes((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          rol: 'assistant',
          texto: `El asistente no está disponible en este momento (${err?.message || 'sin conexión'}). Revisa tu internet o que el backend esté activo.`,
        },
      ]);
    } finally {
      setCargando(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colores.fondo }}>
      <View style={{ padding: 16, paddingBottom: 0 }}>
        <Encabezado titulo="🤖 Asistente de Compras" subtitulo="IA conectada al catálogo del tenant." />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {SUGERENCIAS.map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => enviar(s)}
              style={{ backgroundColor: '#e2e8f0', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}
            >
              <Text style={{ fontSize: 11, color: Colores.texto }}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <FlatList
        data={mensajes}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        renderItem={({ item }) => (
          <View
            style={{
              alignSelf: item.rol === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '82%',
              backgroundColor: item.rol === 'user' ? Colores.tinta : '#fff',
              borderRadius: 14,
              borderTopRightRadius: item.rol === 'user' ? 4 : 14,
              borderTopLeftRadius: item.rol === 'user' ? 14 : 4,
              padding: 10,
              borderWidth: 1,
              borderColor: Colores.borde,
            }}
          >
            <Text style={{ color: item.rol === 'user' ? '#fff' : Colores.texto, fontSize: 13 }}>
              {item.texto}
            </Text>
          </View>
        )}
      />

      <View
        style={{
          flexDirection: 'row',
          gap: 8,
          padding: 12,
          borderTopWidth: 1,
          borderTopColor: Colores.borde,
          backgroundColor: '#fff',
        }}
      >
        <TextInput
          style={[Estilos.input, { flex: 1 }]}
          placeholder="Escribe tu pregunta…"
          placeholderTextColor="#94a3b8"
          value={texto}
          onChangeText={setTexto}
          onSubmitEditing={() => enviar()}
          returnKeyType="send"
        />
        <TouchableOpacity
          onPress={() => enviar()}
          style={{ backgroundColor: Colores.acento, borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' }}
        >
          <Text style={{ color: '#fff', fontWeight: '800' }}>Enviar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
export default AsistenteScreen;
