import React, { useRef, useState } from 'react';
import { FlatList, Text, TextInput, View, TouchableOpacity } from 'react-native';
import { apiFetch } from '../api';
import { useApp } from '../context';
import { Colores, Encabezado, Estilos } from '../ui';

interface Mensaje {
  id: string;
  rol: 'user' | 'assistant';
  texto: string;
  proveedor?: string;
  fuentes?: string[];
  baseDatos?: boolean;
}

const SUGERENCIAS = [
  '¿Qué prendas combinan con un vestido vino?',
  'Recomiéndame algo para una boda en diciembre',
  '¿Cuál es mi talla según mi peso/altura?',
];

export const AsistenteScreen: React.FC = () => {
  const { tenantSlug } = useApp();
  const sesionId = useRef(`mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [mensajes, setMensajes] = useState<Mensaje[]>([
    {
      id: 'bienvenida',
      rol: 'assistant',
      texto: '¡Hola! Puedo responder dudas generales, explicar cómo usar FashionStore y consultar los datos de tu tienda según tu rol y permisos.',
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
    const historialChat = mensajes.slice(-8).map((item) => ({
      role: item.rol,
      content: item.texto.slice(0, 800),
    }));
    setCargando(true);
    try {
      const res = await apiFetch('/ia/chat', {
        method: 'POST',
        tenantSlug,
        body: { mensaje: consulta, sesion_id: sesionId.current, historial: historialChat },
      });
      const respuesta =
        res?.respuesta || res?.message || res?.texto || 'No pude generar una respuesta ahora.';
      setMensajes((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          rol: 'assistant',
          texto: String(respuesta),
          proveedor: String(res?.proveedor || res?.modo_ia || 'local_rules'),
          fuentes: Array.isArray(res?.datos_consultados?.fuentes) ? res.datos_consultados.fuentes : [],
          baseDatos: Boolean(res?.datos_consultados?.base_datos),
        },
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
        <Encabezado titulo="🤖 Asistente inteligente" subtitulo="Responde dudas y consulta datos autorizados de tu tienda." />
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
        keyboardShouldPersistTaps="handled"
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
            {item.rol === 'assistant' && item.proveedor ? (
              <View style={{ marginTop: 6 }}>
                <Text style={{ color: '#64748b', fontSize: 10 }}>
                  Motor: {item.proveedor === 'gemini' ? 'Gemini' : item.proveedor === 'groq' ? 'Groq' : 'Respuesta local'}
                  {item.baseDatos === false ? ' · Base de datos no consultada' : item.baseDatos ? ' · Datos de tienda consultados' : ''}
                </Text>
                {!!item.fuentes?.length && (
                  <Text style={{ color: '#64748b', fontSize: 10, marginTop: 2 }}>
                    Fuentes: {item.fuentes.join(', ')}
                  </Text>
                )}
              </View>
            ) : null}
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
