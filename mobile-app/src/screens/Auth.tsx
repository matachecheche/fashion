import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { apiFetch } from '../api';
import { useApp } from '../context';
import { useNav } from '../navigation';
import { Boton, Colores, Encabezado, Estilos, Tarjeta } from '../ui';

export const AuthScreen: React.FC<{ navParams?: any }> = ({ navParams }) => {
  const { tenantSlug, iniciarSesion, mostrarToast } = useApp();
  const nav = useNav();
  const [modo, setModo] = useState<'login' | 'registro'>('login');
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const destino: string | undefined = navParams?.volver;

  const enviar = async () => {
    setCargando(true);
    setError(null);
    try {
      const endpoint = modo === 'login' ? '/auth/login' : '/auth/registro';
      const body =
        modo === 'login'
          ? { email, password }
          : { nombre, email, password, rol: 'cliente' };
      const res = await apiFetch(endpoint, { method: 'POST', tenantSlug, body });
      await iniciarSesion(res.access_token, res.usuario);
      if (destino === 'Checkout') nav.push('Checkout');
      else nav.popToRoot();
    } catch (err: any) {
      setError(err?.message || 'No se pudo autenticar. Revisa tu conexión o credenciales.');
      mostrarToast('Error de autenticación');
    } finally {
      setCargando(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={Estilos.contenedor} contentContainerStyle={Estilos.scroll}>
        <Encabezado
          titulo={modo === 'login' ? '🔐 Iniciar Sesión' : '👤 Crear Cuenta'}
          subtitulo={`Tienda: /tienda/${tenantSlug} · Autenticación por tenant con JWT`}
        />

        {error && (
          <View
            style={{
              backgroundColor: '#fee2e2',
              borderColor: '#fecaca',
              borderWidth: 1,
              borderRadius: 10,
              padding: 10,
              marginBottom: 12,
            }}
          >
            <Text style={{ color: '#b91c1c', fontSize: 13 }}>{error}</Text>
          </View>
        )}

        <Tarjeta>
          {modo === 'registro' && (
            <>
              <Text style={Estilos.label}>Nombre completo</Text>
              <TextInput
                style={Estilos.input}
                value={nombre}
                onChangeText={setNombre}
                placeholder="Ej: María González"
                placeholderTextColor="#94a3b8"
              />
              <View style={{ height: 12 }} />
            </>
          )}

          <Text style={Estilos.label}>Correo electrónico</Text>
          <TextInput
            style={Estilos.input}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            placeholder="usuario@correo.com"
            placeholderTextColor="#94a3b8"
          />
          <View style={{ height: 12 }} />

          <Text style={Estilos.label}>Contraseña (mín. 8 caracteres)</Text>
          <TextInput
            style={Estilos.input}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor="#94a3b8"
          />
          <View style={{ height: 16 }} />

          <Boton
            titulo={cargando ? 'Verificando…' : modo === 'login' ? 'Ingresar' : 'Registrarme'}
            onPress={enviar}
            variante="acento"
            deshabilitado={cargando}
          />
        </Tarjeta>

        <View style={{ alignItems: 'center', gap: 10 }}>
          <TouchableOpacity onPress={() => setModo(modo === 'login' ? 'registro' : 'login')}>
            <Text style={{ color: Colores.acentoOscuro, fontWeight: '700' }}>
              {modo === 'login' ? '¿Sin cuenta? Crear registro' : '¿Ya tienes cuenta? Iniciar sesión'}
            </Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 11, color: Colores.suave, textAlign: 'center' }}>
            Trial admin: admin@fashionstore.bo / Fashion2026!
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};
export default AuthScreen;
