import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { apiFetch, getAuthToken } from '../api';
import { useApp } from '../context';
import { useNav } from '../navigation';
import { BadgeEstado, Boton, Colores, Encabezado, Estilos, Tarjeta } from '../ui';

export const CuentaScreen: React.FC = () => {
  const {
    tenantSlug,
    cambiarTenant,
    usuario,
    iniciarSesion,
    cerrarSesion,
    cola,
    pendientes,
    online,
    sincronizar,
    mostrarToast,
  } = useApp();
  const nav = useNav();
  const [slug, setSlug] = useState(tenantSlug);
  const [nombre, setNombre] = useState(usuario?.nombre || '');
  const [telefono, setTelefono] = useState(usuario?.telefono || '');
  const [passwordActual, setPasswordActual] = useState('');
  const [passwordNueva, setPasswordNueva] = useState('');
  const [guardandoPerfil, setGuardandoPerfil] = useState(false);
  const [guardandoPassword, setGuardandoPassword] = useState(false);

  useEffect(() => {
    setSlug(tenantSlug);
    setNombre(usuario?.nombre || '');
    setTelefono(usuario?.telefono || '');
  }, [tenantSlug, usuario?.nombre, usuario?.telefono]);

  const guardarPerfil = async () => {
    if (!nombre.trim()) { mostrarToast('El nombre no puede quedar vacío.'); return; }
    setGuardandoPerfil(true);
    try {
      const response = await apiFetch('/auth/me', { method: 'PATCH', tenantSlug, body: { nombre: nombre.trim(), telefono: telefono.trim() } });
      const token = await getAuthToken(tenantSlug);
      const user = response?.usuario || response || { ...usuario, nombre: nombre.trim(), telefono: telefono.trim() };
      if (token) await iniciarSesion(token, user);
      mostrarToast('Perfil actualizado correctamente.');
    } catch (error: any) {
      mostrarToast(error?.message || 'No se pudo actualizar el perfil.');
    } finally { setGuardandoPerfil(false); }
  };

  const cambiarPassword = async () => {
    if (!passwordActual || passwordNueva.length < 8) { mostrarToast('Ingresa tu contraseña actual y una nueva de al menos 8 caracteres.'); return; }
    setGuardandoPassword(true);
    try {
      await apiFetch('/auth/me/password', { method: 'POST', tenantSlug, body: { password_actual: passwordActual, password_nueva: passwordNueva } });
      setPasswordActual('');
      setPasswordNueva('');
      mostrarToast('Contraseña actualizada. Tu sesión continúa activa.');
    } catch (error: any) {
      mostrarToast(error?.message || 'No se pudo cambiar la contraseña.');
    } finally { setGuardandoPassword(false); }
  };

  return (
    <ScrollView style={Estilos.contenedor} contentContainerStyle={Estilos.scroll} keyboardShouldPersistTaps="handled">
      <Encabezado titulo="Mi cuenta" subtitulo={`Gestiona tu perfil y la tienda activa · /${tenantSlug}`} />

      {usuario ? (
        <>
          <Tarjeta>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 54, height: 54, borderRadius: 18, backgroundColor: Colores.acentoSuave, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: Colores.acentoOscuro, fontSize: 23, fontWeight: '900' }}>{String(usuario.nombre || 'U').trim().charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, fontWeight: '900', color: Colores.tinta }}>{usuario.nombre}</Text>
                <Text style={Estilos.subtitulo}>{usuario.email}</Text>
                <View style={{ marginTop: 5 }}><BadgeEstado estado={usuario.rol} /></View>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              {['admin', 'encargado', 'cajero', 'proveedor'].includes(String(usuario.rol)) && (
                <View style={{ flex: 1 }}><Boton titulo="Panel operativo" variante="acento" onPress={() => nav.push('Panel')} /></View>
              )}
              <View style={{ flex: 1 }}><Boton titulo="Notificaciones" variante="outline" onPress={() => nav.push('Notificaciones')} /></View>
            </View>
          </Tarjeta>

          <Tarjeta>
            <Text style={Estilos.h3}>Datos personales</Text>
            <Text style={Estilos.label}>Nombre completo</Text>
            <TextInput style={Estilos.input} value={nombre} onChangeText={setNombre} placeholder="Nombre completo" placeholderTextColor="#92999E" />
            <Text style={[Estilos.label, { marginTop: 12 }]}>Correo electrónico</Text>
            <TextInput style={[Estilos.input, { backgroundColor: Colores.superficie, color: Colores.suave }]} value={String(usuario.email || '')} editable={false} />
            <Text style={[Estilos.label, { marginTop: 12 }]}>Teléfono / WhatsApp</Text>
            <TextInput style={Estilos.input} value={telefono} onChangeText={setTelefono} keyboardType="phone-pad" placeholder="Número de contacto" placeholderTextColor="#92999E" />
            <Boton titulo={guardandoPerfil ? 'Guardando…' : 'Guardar cambios'} variante="acento" deshabilitado={guardandoPerfil || !nombre.trim()} onPress={() => void guardarPerfil()} estilo={{ marginTop: 16 }} />
          </Tarjeta>

          <Tarjeta>
            <Text style={Estilos.h3}>Seguridad</Text>
            <Text style={Estilos.label}>Contraseña actual</Text>
            <TextInput style={Estilos.input} value={passwordActual} onChangeText={setPasswordActual} secureTextEntry placeholder="Tu contraseña actual" placeholderTextColor="#92999E" />
            <Text style={[Estilos.label, { marginTop: 12 }]}>Nueva contraseña</Text>
            <TextInput style={Estilos.input} value={passwordNueva} onChangeText={setPasswordNueva} secureTextEntry placeholder="Mínimo 8 caracteres" placeholderTextColor="#92999E" />
            <Boton titulo={guardandoPassword ? 'Actualizando…' : 'Actualizar contraseña'} variante="outline" deshabilitado={guardandoPassword || !passwordActual || passwordNueva.length < 8} onPress={() => void cambiarPassword()} estilo={{ marginTop: 16 }} />
          </Tarjeta>
          <Boton titulo="Cerrar sesión" variante="peligro" onPress={cerrarSesion} estilo={{ marginBottom: 14 }} />
        </>
      ) : (
        <Tarjeta>
          <Text style={Estilos.texto}>No has iniciado sesión en esta tienda.</Text>
          <Boton titulo="Ingresar / Registrarme" variante="acento" onPress={() => nav.push('Auth')} estilo={{ marginTop: 14 }} />
        </Tarjeta>
      )}

      <Tarjeta>
        <Text style={Estilos.h3}>Tienda SaaS activa</Text>
        <Text style={[Estilos.texto, { fontSize: 12, marginBottom: 10 }]}>Cada tienda tiene sesión, carrito y cola offline independientes.</Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput style={[Estilos.input, { flex: 1 }]} autoCapitalize="none" value={slug} onChangeText={setSlug} placeholder="slug-de-tienda" placeholderTextColor="#92999E" />
          <TouchableOpacity onPress={() => void cambiarTenant(slug)} accessibilityRole="button" style={{ minHeight: 50, paddingHorizontal: 18, borderRadius: 13, justifyContent: 'center', backgroundColor: Colores.oscuro }}>
            <Text style={{ color: '#FFFFFF', fontWeight: '900' }}>Ir</Text>
          </TouchableOpacity>
        </View>
      </Tarjeta>

      <Tarjeta>
        <Text style={Estilos.h3}>Operación sin conexión</Text>
        <Text style={Estilos.texto}>{online ? 'Conectado al servidor' : 'Sin conexión al servidor'} · {pendientes} pendiente(s) · {cola.length} operación(es) en cola</Text>
        <Boton titulo={online ? 'Sincronizar operaciones' : 'Se sincronizará al reconectar'} variante="acento" onPress={sincronizar} deshabilitado={!online || pendientes === 0} estilo={{ marginTop: 14 }} />
      </Tarjeta>

      <Tarjeta>
        <Text style={Estilos.h3}>Accesos rápidos</Text>
        <View style={{ gap: 8 }}>
          <Boton titulo="Mis pedidos" variante="outline" onPress={() => nav.push('Pedidos')} />
          <Boton titulo="Mis reservas" variante="outline" onPress={() => nav.push('Reservas')} />
          <Boton titulo="Asistente inteligente" variante="outline" onPress={() => nav.push('Asistente')} />
          {['admin', 'encargado'].includes(String(usuario?.rol)) && <Boton titulo="Maestros comerciales" variante="outline" onPress={() => nav.push('Maestros')} />}
          <Boton titulo="Centro de ayuda" variante="outline" onPress={() => nav.push('Ayuda')} />
          <Boton titulo="Registrar una tienda" variante="outline" onPress={() => nav.push('Onboarding')} />
        </View>
      </Tarjeta>
    </ScrollView>
  );
};
export default CuentaScreen;
