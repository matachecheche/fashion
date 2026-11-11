import React, { useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useApp } from '../context';
import { useNav } from '../navigation';
import { BadgeEstado, Boton, Colores, Encabezado, Estilos, Tarjeta } from '../ui';

export const CuentaScreen: React.FC = () => {
  const {
    tenantSlug,
    cambiarTenant,
    usuario,
    cerrarSesion,
    cola,
    pendientes,
    online,
    sincronizar,
  } = useApp();
  const nav = useNav();
  const [slug, setSlug] = useState(tenantSlug);

  return (
    <ScrollView style={Estilos.contenedor} contentContainerStyle={Estilos.scroll}>
      <Encabezado titulo="👤 Cuenta" subtitulo={`Tienda activa: /tienda/${tenantSlug}`} />

      {usuario ? (
        <Tarjeta>
          <Text style={Estilos.h3}>{usuario.nombre}</Text>
          <Text style={Estilos.texto}>{usuario.email}</Text>
          <View style={{ height: 6 }} />
          <BadgeEstado estado={usuario.rol} />
          <View style={{ height: 10 }} />
          {['admin', 'encargado', 'cajero', 'proveedor'].includes(String(usuario.rol)) && (
            <>
              <Boton titulo="Abrir panel operativo" variante="acento" onPress={() => nav.push('Panel')} />
              <View style={{ height: 8 }} />
            </>
          )}
          <Boton titulo="Cerrar sesión" variante="outline" onPress={cerrarSesion} />
        </Tarjeta>
      ) : (
        <Tarjeta>
          <Text style={Estilos.texto}>No has iniciado sesión en esta tienda.</Text>
          <View style={{ height: 10 }} />
          <Boton titulo="Ingresar / Registrarme" variante="acento" onPress={() => nav.push('Auth')} />
        </Tarjeta>
      )}

      <Tarjeta>
        <Text style={Estilos.h3}>🏬 Cambiar tienda SaaS</Text>
        <Text style={[Estilos.texto, { fontSize: 11, marginBottom: 8 }]}>
          Cada tienda tiene sesión, carrito y cola offline independientes.
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            style={[Estilos.input, { flex: 1 }]}
            autoCapitalize="none"
            value={slug}
            onChangeText={setSlug}
            placeholder="slug-de-tienda"
            placeholderTextColor="#94a3b8"
          />
          <TouchableOpacity
            onPress={() => cambiarTenant(slug)}
            style={{ backgroundColor: Colores.tinta, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' }}
          >
            <Text style={{ color: '#fff', fontWeight: '800' }}>Ir</Text>
          </TouchableOpacity>
        </View>
      </Tarjeta>

      <Tarjeta>
        <Text style={Estilos.h3}>📡 Operación offline (SQLite)</Text>
        <Text style={Estilos.texto}>
          {online ? 'Conectado al servidor' : 'Sin conexión al servidor'} · {pendientes} pendiente(s) · {cola.length} en total
        </Text>
        <View style={{ height: 8 }} />
        <Boton
          titulo={online ? 'Sincronizar cola ahora' : 'Se sincronizará al reconectar'}
          variante="acento"
          onPress={sincronizar}
          deshabilitado={!online || pendientes === 0}
        />
      </Tarjeta>

      <Tarjeta>
        <Text style={Estilos.h3}>Atajos</Text>
        <View style={{ gap: 8 }}>
          <Boton titulo="📦 Mis pedidos" variante="outline" onPress={() => nav.push('Pedidos')} />
          <Boton titulo="📅 Mis reservas" variante="outline" onPress={() => nav.push('Reservas')} />
          <Boton titulo="🤖 Asistente de compras" variante="outline" onPress={() => nav.push('Asistente')} />
          <Boton titulo="❓ Centro de ayuda" variante="outline" onPress={() => nav.push('Ayuda')} />
          <Boton titulo="🚀 Registrar una tienda" variante="outline" onPress={() => nav.push('Onboarding')} />
        </View>
      </Tarjeta>
    </ScrollView>
  );
};
export default CuentaScreen;
