import React, { useRef, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { apiFetch } from '../api';
import { useApp } from '../context';
import { useNav } from '../navigation';
import { Boton, Colores, Encabezado, Estilos, Tarjeta } from '../ui';

const PASOS = [
  { titulo: '🏬 Tu tienda propia en 14 días', texto: 'Crea tu boutique FashionStore con catálogo, carrito, POS e inventario multi-almacén.' },
  { titulo: '📸 8 tipos × 12 colores de prendas', texto: 'Pipeline gráfico incluido: cada producto muestra foto y overlay AR profesional.' },
  { titulo: '📡 Funciona sin internet', texto: 'Los vendedores venden y reservan offline; la app sincroniza y detecta conflictos de stock.' },
  { titulo: '💳 Cobros en modo Sandbox', texto: 'Prueba QR y tarjeta sin cargos reales; activa cobros reales solo con tu pasarela y tu cuenta.' },
];

export const OnboardingScreen: React.FC = () => {
  const { cambiarTenant, iniciarSesion, mostrarToast } = useApp();
  const nav = useNav();
  const [paso, setPaso] = useState(0);
  const [nombre, setNombre] = useState('');
  const [slug, setSlug] = useState('');
  const [nit, setNit] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [aceptaTrial, setAceptaTrial] = useState(false);
  const requestKeyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [procesando, setProcesando] = useState(false);

  const ultimo = paso === PASOS.length;

  const crearTienda = async () => {
    if (!nombre.trim() || !slug.trim() || nit.trim().length < 4 || !email.trim() || password.length < 8 || !aceptaTrial) {
      mostrarToast('Completa nombre, slug, NIT, correo, contraseña y acepta el Trial de 14 días.');
      return;
    }
    setProcesando(true);
    try {
      const payload = {
        nombre_tienda: nombre.trim(),
        slug: slug.trim().toLowerCase(),
        nit: nit.trim(),
        admin_nombre: nombre.trim(),
        admin_email: email.trim().toLowerCase(),
        admin_password: password,
        acepta_trial: aceptaTrial,
      };
      const fingerprint = JSON.stringify(payload);
      if (!requestKeyRef.current || requestKeyRef.current.fingerprint !== fingerprint) {
        requestKeyRef.current = { fingerprint, key: Crypto.randomUUID() };
      }
      const res = await apiFetch('/tenants/registro', {
        method: 'POST',
        headers: { 'Idempotency-Key': requestKeyRef.current.key },
        body: payload,
      });
      const newSlug = res?.tenant?.slug || slug.trim().toLowerCase();
      await cambiarTenant(newSlug);
      await iniciarSesion(res.access_token || res.token, res.usuario);
      mostrarToast(`Tienda /tienda/${newSlug} creada. Trial gratuito de 14 días activado.`);
      nav.popToRoot();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo crear la tienda. ¿El slug ya existe?');
    } finally {
      setProcesando(false);
    }
  };

  return (
    <ScrollView style={Estilos.contenedor} contentContainerStyle={Estilos.scroll}>
      <Encabezado
        titulo="🚀 Crear mi tienda SaaS"
        subtitulo="Trial gratuito de 14 días · sin tarjeta · sin cobros"
      />

      {!ultimo ? (
        <>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 14 }}>
            {PASOS.map((_, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: i <= paso ? Colores.acento : Colores.borde,
                }}
              />
            ))}
          </View>
          <Tarjeta style={{ alignItems: 'center', paddingVertical: 28 }}>
            <Text style={{ fontSize: 42 }}>{PASOS[paso].titulo.split(' ')[0]}</Text>
            <Text style={{ fontSize: 19, fontWeight: '900', color: Colores.tinta, textAlign: 'center', marginTop: 10 }}>
              {PASOS[paso].titulo}
            </Text>
            <Text style={[Estilos.texto, { textAlign: 'center', marginTop: 8 }]}>{PASOS[paso].texto}</Text>
          </Tarjeta>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {paso > 0 && <View style={{ flex: 1 }}><Boton titulo="← Atrás" variante="outline" onPress={() => setPaso(paso - 1)} /></View>}
            <View style={{ flex: 1 }}>
              <Boton titulo={paso === PASOS.length - 1 ? 'Crear tienda →' : 'Siguiente →'} variante="acento" onPress={() => setPaso(paso + 1)} />
            </View>
          </View>
        </>
      ) : (
        <Tarjeta>
          <Text style={Estilos.h3}>Datos de tu tienda</Text>
          <Text style={Estilos.label}>Nombre de la tienda</Text>
          <TextInput style={Estilos.input} value={nombre} onChangeText={setNombre} placeholder="Boutique Alondra" placeholderTextColor="#94a3b8" />
          <View style={{ height: 10 }} />
          <Text style={Estilos.label}>Slug (URL: /tienda/tu-slug)</Text>
          <TextInput
            style={Estilos.input}
            autoCapitalize="none"
            value={slug}
            onChangeText={(v) => setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            placeholder="boutique-alondra"
            placeholderTextColor="#94a3b8"
          />
          <View style={{ height: 10 }} />
          <Text style={Estilos.label}>NIT de la empresa</Text>
          <TextInput
            style={Estilos.input}
            value={nit}
            onChangeText={setNit}
            keyboardType="numeric"
            maxLength={40}
            placeholder="1234567890"
            placeholderTextColor="#94a3b8"
          />
          <View style={{ height: 10 }} />
          <Text style={Estilos.label}>Correo del administrador</Text>
          <TextInput style={Estilos.input} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="dueno@boutique.com" placeholderTextColor="#94a3b8" />
          <View style={{ height: 10 }} />
          <Text style={Estilos.label}>Contraseña (mín. 8 caracteres)</Text>
          <TextInput style={Estilos.input} secureTextEntry value={password} onChangeText={setPassword} placeholder="••••••••" placeholderTextColor="#94a3b8" />
          <View style={{ height: 14 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Switch value={aceptaTrial} onValueChange={setAceptaTrial} accessibilityLabel="Aceptar Trial de 14 días" />
            <Text style={[Estilos.texto, { flex: 1 }]}>Acepto el Trial de 14 días. Al vencer, la tienda pasa a solo lectura y conserva sus datos.</Text>
          </View>
          <View style={{ height: 14 }} />
          <Boton titulo={procesando ? 'Creando tienda…' : '✨ Crear mi tienda (Trial 14 días)'} variante="acento" onPress={crearTienda} deshabilitado={procesando || !aceptaTrial} />
          <View style={{ height: 8 }} />
          <Boton titulo="← Volver" variante="outline" onPress={() => setPaso(PASOS.length - 1)} />
        </Tarjeta>
      )}
    </ScrollView>
  );
};
export default OnboardingScreen;
