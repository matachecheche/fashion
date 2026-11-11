-- =============================================================================
-- FASHIONSTORE - ESQUEMA BASE POSTGRESQL (Version base v4 -> migrable a v9)
-- Cubre CU-01 a CU-14: Catalogo, Inventario, Reservas, Ventas, Pagos, POS,
-- Proveedores, IA/AR, Notificaciones, Auditoria y Roles PostgREST.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Roles de base para PostgREST y ejecucion de aplicacion
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'web_anon') THEN
    CREATE ROLE web_anon NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    CREATE ROLE app_readonly NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

-- 1. Metadatos de esquema
CREATE TABLE IF NOT EXISTS meta (
  clave VARCHAR(64) PRIMARY KEY,
  valor TEXT NOT NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO meta (clave, valor)
VALUES ('esquema_version', '4')
ON CONFLICT (clave) DO NOTHING;

-- 2. Sucursales
CREATE TABLE IF NOT EXISTS sucursales (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(32) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  direccion TEXT NOT NULL,
  ciudad VARCHAR(80) NOT NULL DEFAULT 'Santa Cruz de la Sierra',
  telefono VARCHAR(40),
  horario VARCHAR(120) NOT NULL DEFAULT 'Lun-Sab 09:00-21:00',
  latitud NUMERIC(10, 6),
  longitud NUMERIC(10, 6),
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Almacenes
CREATE TABLE IF NOT EXISTS almacenes (
  id SERIAL PRIMARY KEY,
  sucursal_id INTEGER NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  codigo VARCHAR(32) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  es_principal BOOLEAN NOT NULL DEFAULT TRUE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Proveedores
CREATE TABLE IF NOT EXISTS proveedores (
  id SERIAL PRIMARY KEY,
  razon_social VARCHAR(160) NOT NULL,
  nit VARCHAR(40),
  contacto VARCHAR(120),
  telefono VARCHAR(40),
  email VARCHAR(160),
  direccion TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Usuarios (admin, encargado, cajero, proveedor, cliente)
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(140) NOT NULL,
  email VARCHAR(160) NOT NULL,
  password_hash TEXT NOT NULL,
  rol VARCHAR(24) NOT NULL CHECK (rol IN ('admin', 'encargado', 'cajero', 'proveedor', 'cliente')),
  telefono VARCHAR(40),
  sucursal_id INTEGER REFERENCES sucursales(id) ON DELETE SET NULL,
  proveedor_id INTEGER REFERENCES proveedores(id) ON DELETE SET NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  preferencias_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Maestros de catalogo
CREATE TABLE IF NOT EXISTS categorias (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  slug VARCHAR(80) NOT NULL,
  tipo_prenda VARCHAR(40) NOT NULL DEFAULT 'blusa',
  descripcion TEXT,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS temporadas (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  anio INTEGER NOT NULL DEFAULT 2026,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS colecciones (
  id SERIAL PRIMARY KEY,
  temporada_id INTEGER REFERENCES temporadas(id) ON DELETE SET NULL,
  nombre VARCHAR(100) NOT NULL,
  descripcion TEXT,
  destacada BOOLEAN NOT NULL DEFAULT FALSE,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Productos e imagenes
CREATE TABLE IF NOT EXISTS productos (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(40) NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  categoria_id INTEGER NOT NULL REFERENCES categorias(id) ON DELETE RESTRICT,
  temporada_id INTEGER REFERENCES temporadas(id) ON DELETE SET NULL,
  coleccion_id INTEGER REFERENCES colecciones(id) ON DELETE SET NULL,
  proveedor_id INTEGER REFERENCES proveedores(id) ON DELETE SET NULL,
  tipo_prenda VARCHAR(40) NOT NULL DEFAULT 'blusa'
    CHECK (tipo_prenda IN ('blusa', 'camiseta', 'cartera', 'chaqueta', 'falda', 'pantalon', 'vestido', 'zapato')),
  genero VARCHAR(24) NOT NULL DEFAULT 'unisex',
  material VARCHAR(100) NOT NULL DEFAULT 'Algodon Premium',
  precio_base NUMERIC(12, 2) NOT NULL CHECK (precio_base >= 0),
  costo_base NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (costo_base >= 0),
  imagen_url TEXT NOT NULL,
  ar_overlay_url TEXT NOT NULL,
  ar_config_json JSONB NOT NULL DEFAULT '{"anchor":"torso","scale":1.0,"offsetY":0}'::jsonb,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  destacado BOOLEAN NOT NULL DEFAULT FALSE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS producto_imagenes (
  id SERIAL PRIMARY KEY,
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  color VARCHAR(40) NOT NULL,
  foto_url TEXT NOT NULL,
  ar_url TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 1,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Variantes (Talla + Color + SKU)
CREATE TABLE IF NOT EXISTS variantes (
  id SERIAL PRIMARY KEY,
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  sku VARCHAR(64) NOT NULL,
  talla VARCHAR(24) NOT NULL,
  color VARCHAR(40) NOT NULL,
  color_hex VARCHAR(16) NOT NULL DEFAULT '#1C3F94',
  precio_adicional NUMERIC(12, 2) NOT NULL DEFAULT 0,
  foto_url TEXT,
  ar_url TEXT,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Promociones
CREATE TABLE IF NOT EXISTS promociones (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(40) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  descripcion TEXT,
  tipo_descuento VARCHAR(20) NOT NULL DEFAULT 'porcentaje'
    CHECK (tipo_descuento IN ('porcentaje', 'monto_fijo')),
  valor NUMERIC(12, 2) NOT NULL CHECK (valor >= 0),
  categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
  producto_id INTEGER REFERENCES productos(id) ON DELETE SET NULL,
  minimo_compra NUMERIC(12, 2) NOT NULL DEFAULT 0,
  inicia_en TIMESTAMPTZ NOT NULL DEFAULT NOW() - INTERVAL '1 day',
  termina_en TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '90 days',
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Stock e Inventario
CREATE TABLE IF NOT EXISTS stock (
  id SERIAL PRIMARY KEY,
  almacen_id INTEGER NOT NULL REFERENCES almacenes(id) ON DELETE CASCADE,
  variante_id INTEGER NOT NULL REFERENCES variantes(id) ON DELETE CASCADE,
  cantidad INTEGER NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  reservado INTEGER NOT NULL DEFAULT 0 CHECK (reservado >= 0 AND reservado <= cantidad),
  stock_minimo INTEGER NOT NULL DEFAULT 3 CHECK (stock_minimo >= 0),
  ubicacion VARCHAR(60) DEFAULT 'A-01',
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (almacen_id, variante_id)
);

CREATE TABLE IF NOT EXISTS movimientos_inventario (
  id BIGSERIAL PRIMARY KEY,
  almacen_id INTEGER NOT NULL REFERENCES almacenes(id) ON DELETE RESTRICT,
  variante_id INTEGER NOT NULL REFERENCES variantes(id) ON DELETE RESTRICT,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo VARCHAR(32) NOT NULL
    CHECK (tipo IN ('entrada', 'salida', 'reserva', 'liberacion', 'venta', 'devolucion', 'ajuste', 'transferencia', 'recepcion')),
  cantidad INTEGER NOT NULL,
  saldo_cantidad INTEGER NOT NULL,
  saldo_reservado INTEGER NOT NULL,
  referencia VARCHAR(80),
  motivo TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recepciones (
  id SERIAL PRIMARY KEY,
  almacen_id INTEGER NOT NULL REFERENCES almacenes(id) ON DELETE RESTRICT,
  proveedor_id INTEGER REFERENCES proveedores(id) ON DELETE SET NULL,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  numero_documento VARCHAR(60) NOT NULL,
  estado VARCHAR(24) NOT NULL DEFAULT 'completada',
  observaciones TEXT,
  total_costo NUMERIC(12, 2) NOT NULL DEFAULT 0,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recepcion_items (
  id SERIAL PRIMARY KEY,
  recepcion_id INTEGER NOT NULL REFERENCES recepciones(id) ON DELETE CASCADE,
  variante_id INTEGER NOT NULL REFERENCES variantes(id) ON DELETE RESTRICT,
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  costo_unitario NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (costo_unitario >= 0)
);

-- 11. Cajas POS
CREATE TABLE IF NOT EXISTS cajas (
  id SERIAL PRIMARY KEY,
  sucursal_id INTEGER NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  usuario_apertura_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  usuario_cierre_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada')),
  monto_inicial NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (monto_inicial >= 0),
  monto_ventas_efectivo NUMERIC(12, 2) NOT NULL DEFAULT 0,
  monto_ventas_digital NUMERIC(12, 2) NOT NULL DEFAULT 0,
  monto_cierre_declarado NUMERIC(12, 2),
  diferencia_arqueo NUMERIC(12, 2),
  observaciones TEXT,
  abierta_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cerrada_en TIMESTAMPTZ
);

-- 12. Reservas y Detalle de Reserva (CU-04 y CU-05)
CREATE TABLE IF NOT EXISTS reservas (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(32) NOT NULL UNIQUE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  sucursal_id INTEGER NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  almacen_id INTEGER NOT NULL REFERENCES almacenes(id) ON DELETE RESTRICT,
  atendido_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  estado VARCHAR(28) NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'preparada', 'en_atencion', 'finalizada', 'cancelada', 'vencida')),
  fecha_cita TIMESTAMPTZ NOT NULL,
  expira_en TIMESTAMPTZ NOT NULL,
  notas TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS detalle_reserva (
  id SERIAL PRIMARY KEY,
  reserva_id INTEGER NOT NULL REFERENCES reservas(id) ON DELETE CASCADE,
  variante_id INTEGER NOT NULL REFERENCES variantes(id) ON DELETE RESTRICT,
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(12, 2) NOT NULL CHECK (precio_unitario >= 0)
);

-- 13. Operaciones Offline e Idempotencia
CREATE TABLE IF NOT EXISTS operaciones_offline (
  id VARCHAR(80) PRIMARY KEY,
  tipo VARCHAR(40) NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  sucursal_id INTEGER REFERENCES sucursales(id) ON DELETE SET NULL,
  payload_hash VARCHAR(128) NOT NULL,
  payload_json JSONB NOT NULL,
  estado VARCHAR(28) NOT NULL DEFAULT 'sincronizada'
    CHECK (estado IN ('pendiente', 'sincronizada', 'conflicto', 'rechazada', 'error')),
  respuesta_json JSONB,
  motivo_error TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  procesado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. Ventas, Items, Pagos y Devoluciones (CU-07, CU-08, CU-09, CU-10)
CREATE TABLE IF NOT EXISTS ventas (
  id SERIAL PRIMARY KEY,
  numero_comprobante VARCHAR(40) NOT NULL UNIQUE,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  vendedor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  sucursal_id INTEGER NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  almacen_id INTEGER NOT NULL REFERENCES almacenes(id) ON DELETE RESTRICT,
  caja_id INTEGER REFERENCES cajas(id) ON DELETE SET NULL,
  reserva_id INTEGER REFERENCES reservas(id) ON DELETE SET NULL,
  origen VARCHAR(20) NOT NULL DEFAULT 'web' CHECK (origen IN ('web', 'movil', 'pos', 'offline_pos', 'offline_movil')),
  estado VARCHAR(28) NOT NULL DEFAULT 'pendiente_pago'
    CHECK (estado IN ('pendiente_pago', 'pagada', 'entregada', 'cancelada', 'reembolsada', 'conflicto_stock')),
  estado_pago VARCHAR(28) NOT NULL DEFAULT 'pendiente'
    CHECK (estado_pago IN ('pendiente', 'no_confirmado', 'aprobado', 'rechazado', 'reembolsado')),
  metodo_pago VARCHAR(28) NOT NULL DEFAULT 'efectivo'
    CHECK (metodo_pago IN ('efectivo', 'tarjeta', 'qr', 'transferencia', 'stripe_sandbox', 'libelula_sandbox')),
  subtotal NUMERIC(12, 2) NOT NULL CHECK (subtotal >= 0),
  descuento NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
  promocion_codigo VARCHAR(40),
  cliente_nombre VARCHAR(140),
  cliente_nit VARCHAR(40) DEFAULT '0',
  direccion_entrega TEXT,
  operacion_offline_id VARCHAR(80) REFERENCES operaciones_offline(id) ON DELETE SET NULL,
  notas TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS venta_items (
  id SERIAL PRIMARY KEY,
  venta_id INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  variante_id INTEGER NOT NULL REFERENCES variantes(id) ON DELETE RESTRICT,
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(12, 2) NOT NULL CHECK (precio_unitario >= 0),
  descuento_unitario NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (descuento_unitario >= 0),
  subtotal NUMERIC(12, 2) NOT NULL CHECK (subtotal >= 0)
);

CREATE TABLE IF NOT EXISTS pagos (
  id SERIAL PRIMARY KEY,
  venta_id INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  referencia_externa VARCHAR(80) NOT NULL UNIQUE,
  pasarela VARCHAR(32) NOT NULL DEFAULT 'sandbox'
    CHECK (pasarela IN ('sandbox', 'stripe_sandbox', 'libelula_sandbox', 'qr_sandbox', 'efectivo_pos')),
  metodo VARCHAR(28) NOT NULL,
  monto NUMERIC(12, 2) NOT NULL CHECK (monto >= 0),
  moneda VARCHAR(8) NOT NULL DEFAULT 'BOB',
  modo VARCHAR(16) NOT NULL DEFAULT 'sandbox' CHECK (modo IN ('sandbox')),
  estado VARCHAR(28) NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'no_confirmado', 'aprobado', 'rechazado', 'expirado', 'reembolsado')),
  confirmado_proveedor BOOLEAN NOT NULL DEFAULT FALSE,
  motivo_rechazo TEXT,
  webhook_id VARCHAR(80),
  payload_proveedor JSONB NOT NULL DEFAULT '{}'::jsonb,
  expira_en TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 minutes',
  confirmado_en TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devoluciones (
  id SERIAL PRIMARY KEY,
  venta_id INTEGER NOT NULL REFERENCES ventas(id) ON DELETE RESTRICT,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  almacen_id INTEGER NOT NULL REFERENCES almacenes(id) ON DELETE RESTRICT,
  motivo TEXT NOT NULL,
  monto_reembolsado NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (monto_reembolsado >= 0),
  estado VARCHAR(24) NOT NULL DEFAULT 'procesada',
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devolucion_items (
  id SERIAL PRIMARY KEY,
  devolucion_id INTEGER NOT NULL REFERENCES devoluciones(id) ON DELETE CASCADE,
  variante_id INTEGER NOT NULL REFERENCES variantes(id) ON DELETE RESTRICT,
  cantidad INTEGER NOT NULL CHECK (cantidad > 0)
);

-- 15. Propuestas de Proveedor
CREATE TABLE IF NOT EXISTS propuestas_producto (
  id SERIAL PRIMARY KEY,
  proveedor_id INTEGER NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  nombre VARCHAR(160) NOT NULL,
  tipo_prenda VARCHAR(40) NOT NULL DEFAULT 'blusa',
  color VARCHAR(40) NOT NULL DEFAULT 'azul',
  tallas_sugeridas VARCHAR(80) NOT NULL DEFAULT 'S,M,L',
  costo_propuesto NUMERIC(12, 2) NOT NULL CHECK (costo_propuesto >= 0),
  precio_sugerido NUMERIC(12, 2) NOT NULL CHECK (precio_sugerido >= 0),
  cantidad_disponible INTEGER NOT NULL DEFAULT 20 CHECK (cantidad_disponible > 0),
  descripcion TEXT,
  estado VARCHAR(24) NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  comentario_revision TEXT,
  revisado_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. IA, Recomendaciones, Conversaciones, Notificaciones y Auditoria
CREATE TABLE IF NOT EXISTS interacciones (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  producto_id INTEGER REFERENCES productos(id) ON DELETE CASCADE,
  variante_id INTEGER REFERENCES variantes(id) ON DELETE SET NULL,
  tipo VARCHAR(32) NOT NULL CHECK (tipo IN ('vista', 'carrito', 'probador_ar', 'reserva', 'compra', 'busqueda')),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recomendaciones_ia (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  producto_origen_id INTEGER REFERENCES productos(id) ON DELETE SET NULL,
  productos_recomendados JSONB NOT NULL DEFAULT '[]'::jsonb,
  explicacion TEXT,
  algoritmo VARCHAR(40) NOT NULL DEFAULT 'hibrido_reglas_contenido',
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversaciones_ia (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  sesion_id VARCHAR(64) NOT NULL,
  mensaje_usuario TEXT NOT NULL,
  respuesta_asistente TEXT NOT NULL,
  intencion VARCHAR(48),
  proveedor_llm VARCHAR(32) NOT NULL DEFAULT 'local_rules',
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notificaciones (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo VARCHAR(140) NOT NULL,
  mensaje TEXT NOT NULL,
  tipo VARCHAR(32) NOT NULL DEFAULT 'info',
  leida BOOLEAN NOT NULL DEFAULT FALSE,
  referencia_url TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auditoria (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  entidad VARCHAR(64) NOT NULL,
  entidad_id VARCHAR(64),
  accion VARCHAR(48) NOT NULL,
  detalle_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip VARCHAR(64),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 17. Vistas operativas iniciales (seran recreadas tenant-scoped en migracion 005)
CREATE OR REPLACE VIEW disponibilidad_sucursal AS
SELECT
  s.id AS stock_id,
  suc.id AS sucursal_id,
  suc.nombre AS sucursal_nombre,
  suc.ciudad,
  a.id AS almacen_id,
  a.nombre AS almacen_nombre,
  p.id AS producto_id,
  p.codigo AS producto_codigo,
  p.nombre AS producto_nombre,
  p.tipo_prenda,
  p.precio_base,
  v.id AS variante_id,
  v.sku,
  v.talla,
  v.color,
  v.color_hex,
  COALESCE(v.foto_url, p.imagen_url) AS foto_url,
  COALESCE(v.ar_url, p.ar_overlay_url) AS ar_url,
  (p.precio_base + v.precio_adicional) AS precio_final,
  s.cantidad,
  s.reservado,
  (s.cantidad - s.reservado) AS disponible,
  s.stock_minimo
FROM stock s
JOIN almacenes a ON a.id = s.almacen_id
JOIN sucursales suc ON suc.id = a.sucursal_id
JOIN variantes v ON v.id = s.variante_id
JOIN productos p ON p.id = v.producto_id
WHERE p.activo = TRUE AND v.activa = TRUE AND suc.activa = TRUE;

CREATE OR REPLACE VIEW catalogo_publico AS
SELECT
  p.id,
  p.codigo,
  p.nombre,
  p.descripcion,
  p.tipo_prenda,
  p.genero,
  p.material,
  p.precio_base,
  p.imagen_url,
  p.ar_overlay_url,
  p.ar_config_json,
  p.destacado,
  c.id AS categoria_id,
  c.nombre AS categoria_nombre,
  t.id AS temporada_id,
  t.nombre AS temporada_nombre,
  col.id AS coleccion_id,
  col.nombre AS coleccion_nombre,
  COALESCE(SUM(s.cantidad - s.reservado), 0)::INTEGER AS stock_disponible_total
FROM productos p
JOIN categorias c ON c.id = p.categoria_id
LEFT JOIN temporadas t ON t.id = p.temporada_id
LEFT JOIN colecciones col ON col.id = p.coleccion_id
LEFT JOIN variantes v ON v.producto_id = p.id AND v.activa = TRUE
LEFT JOIN stock s ON s.variante_id = v.id
WHERE p.activo = TRUE
GROUP BY p.id, c.id, t.id, col.id;

CREATE OR REPLACE VIEW inventario_critico AS
SELECT
  suc.id AS sucursal_id,
  suc.nombre AS sucursal_nombre,
  a.id AS almacen_id,
  a.nombre AS almacen_nombre,
  p.id AS producto_id,
  p.nombre AS producto_nombre,
  v.id AS variante_id,
  v.sku,
  v.talla,
  v.color,
  s.cantidad,
  s.reservado,
  (s.cantidad - s.reservado) AS disponible,
  s.stock_minimo
FROM stock s
JOIN almacenes a ON a.id = s.almacen_id
JOIN sucursales suc ON suc.id = a.sucursal_id
JOIN variantes v ON v.id = s.variante_id
JOIN productos p ON p.id = v.producto_id
WHERE (s.cantidad - s.reservado) <= s.stock_minimo;
