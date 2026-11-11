-- =============================================================================
-- FASHIONSTORE - DATOS SEMILLA IDEMPOTENTES (Tenant 'legacy')
-- Contrasena demo para todas las cuentas semilla: Fashion2026!
-- =============================================================================

BEGIN;

-- Configurar contexto transaccional para el tenant legacy durante el seed
SELECT set_config('app.tenant_id', 'legacy', true);

-- Asegurar tenant legacy con holgura para regresion CU-01..CU-14 mientras
-- todo nuevo tenant SaaS nace con limites estrictos Demo (5 / 2 / 500)
INSERT INTO tenants (
  id, slug, nombre, plan, estado, demo_inicia_en, demo_vence_en,
  max_usuarios, max_sucursales, max_productos, acepta_demo, onboarding_completado, email_propietario
)
VALUES (
  'legacy', 'legacy', 'FashionStore Bolivia', 'demo', 'activo',
  NOW(), NOW() + INTERVAL '14 days',
  25, 5, 500, TRUE, TRUE, 'admin@fashionstore.bo'
)
ON CONFLICT (id) DO UPDATE SET
  estado = 'activo',
  demo_vence_en = GREATEST(tenants.demo_vence_en, NOW() + INTERVAL '14 days'),
  max_usuarios = GREATEST(tenants.max_usuarios, 25),
  max_sucursales = GREATEST(tenants.max_sucursales, 5);

-- 1. Sucursales
INSERT INTO sucursales (id, tenant_id, codigo, nombre, direccion, ciudad, telefono, horario, latitud, longitud, activa)
VALUES
  (1, 'legacy', 'SCZ-CEN', 'Sucursal Centro', 'Calle 24 de Septiembre #145, Plaza Principal', 'Santa Cruz de la Sierra', '+591 3 3345601', 'Lun-Sab 09:00-20:30', -17.783327, -63.182140, TRUE),
  (2, 'legacy', 'SCZ-EQP', 'Sucursal Equipetrol', 'Av. San Martin esq. Calle 7 Oeste, Equipetrol Norte', 'Santa Cruz de la Sierra', '+591 3 3428910', 'Lun-Dom 10:00-22:00', -17.764890, -63.196520, TRUE)
ON CONFLICT (id) DO NOTHING;

SELECT setval('sucursales_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM sucursales), 2));

-- 2. Almacenes
INSERT INTO almacenes (id, tenant_id, sucursal_id, codigo, nombre, es_principal, activo)
VALUES
  (1, 'legacy', 1, 'ALM-CEN', 'Almacen Central Centro', TRUE, TRUE),
  (2, 'legacy', 2, 'ALM-EQP', 'Almacen Boutique Equipetrol', TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

SELECT setval('almacenes_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM almacenes), 2));

-- 3. Proveedores
INSERT INTO proveedores (id, tenant_id, razon_social, nit, contacto, telefono, email, direccion, activo)
VALUES
  (1, 'legacy', 'Textiles Andinos S.R.L.', '1029384021', 'Lucia Salvatierra', '+591 70011223', 'proveedor@fashionstore.bo', 'Parque Industrial Mz. 14, Santa Cruz', TRUE),
  (2, 'legacy', 'Atelier Moda Oriental S.A.', '3049582019', 'Carlos Mendez', '+591 75099881', 'contacto@atelieroriental.bo', 'Av. Cristo Redentor Km 4.5, Santa Cruz', TRUE)
ON CONFLICT (id) DO NOTHING;

SELECT setval('proveedores_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM proveedores), 2));

-- 4. Usuarios (5 roles oficiales: admin, encargado, cajero, proveedor, cliente)
-- Password para todos: Fashion2026!
INSERT INTO usuarios (id, tenant_id, nombre, email, password_hash, rol, telefono, sucursal_id, proveedor_id, activo)
VALUES
  (1, 'legacy', 'Valeria Suarez (Admin)', 'admin@fashionstore.bo', crypt('Fashion2026!', gen_salt('bf', 10)), 'admin', '+591 70010001', 1, NULL, TRUE),
  (2, 'legacy', 'Marco Aguilera (Encargado)', 'encargado@fashionstore.bo', crypt('Fashion2026!', gen_salt('bf', 10)), 'encargado', '+591 70010002', 1, NULL, TRUE),
  (3, 'legacy', 'Camila Rojas (Cajera POS)', 'cajero@fashionstore.bo', crypt('Fashion2026!', gen_salt('bf', 10)), 'cajero', '+591 70010003', 1, NULL, TRUE),
  (4, 'legacy', 'Lucia Salvatierra (Proveedor)', 'proveedor@fashionstore.bo', crypt('Fashion2026!', gen_salt('bf', 10)), 'proveedor', '+591 70010004', 1, 1, TRUE),
  (5, 'legacy', 'Andrea Justiniano (Cliente)', 'cliente@fashionstore.bo', crypt('Fashion2026!', gen_salt('bf', 10)), 'cliente', '+591 70010005', 1, NULL, TRUE)
ON CONFLICT (id) DO NOTHING;

SELECT setval('usuarios_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM usuarios), 5));

-- 5. Categorias, Temporadas y Colecciones
INSERT INTO categorias (id, tenant_id, nombre, slug, tipo_prenda, descripcion, activa)
VALUES
  (1, 'legacy', 'Blusas', 'blusas', 'blusa', 'Blusas elegantes y casuales de confeccion fina', TRUE),
  (2, 'legacy', 'Camisetas', 'camisetas', 'camiseta', 'Camisetas basicas y urbanas de algodon peinado', TRUE),
  (3, 'legacy', 'Carteras', 'carteras', 'cartera', 'Carteras y bolsos de diseno estructurado', TRUE),
  (4, 'legacy', 'Chaquetas', 'chaquetas', 'chaqueta', 'Chaquetas, blazers y abrigos de estacion', TRUE),
  (5, 'legacy', 'Faldas', 'faldas', 'falda', 'Faldas plisadas y de corte midi', TRUE),
  (6, 'legacy', 'Pantalones', 'pantalones', 'pantalon', 'Pantalones sastre y palazzo', TRUE),
  (7, 'legacy', 'Vestidos', 'vestidos', 'vestido', 'Vestidos de gala, coctel y dia', TRUE),
  (8, 'legacy', 'Zapatos', 'zapatos', 'zapato', 'Calzado femenino de tacon y vestir', TRUE)
ON CONFLICT (id) DO NOTHING;

SELECT setval('categorias_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM categorias), 8));

INSERT INTO temporadas (id, tenant_id, nombre, anio, activa)
VALUES
  (1, 'legacy', 'Primavera - Verano', 2026, TRUE),
  (2, 'legacy', 'Otono - Invierno', 2026, TRUE)
ON CONFLICT (id) DO NOTHING;

SELECT setval('temporadas_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM temporadas), 2));

INSERT INTO colecciones (id, tenant_id, temporada_id, nombre, descripcion, destacada, activa)
VALUES
  (1, 'legacy', 1, 'Brisa Cruceña 2026', 'Prendas frescas en tonos pastel y vibrantes con soporte AR', TRUE, TRUE),
  (2, 'legacy', 2, 'Elegancia Nocturna 2026', 'Sastreria, chaquetas y vestidos en tonos vino, negro y camel', TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

SELECT setval('colecciones_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM colecciones), 2));

-- 6. Productos (8 productos insignia que cubren los 8 tipos AR y sus colores)
INSERT INTO productos (
  id, tenant_id, codigo, nombre, descripcion, categoria_id, temporada_id, coleccion_id, proveedor_id,
  tipo_prenda, genero, material, precio_base, costo_base, imagen_url, ar_overlay_url, ar_config_json, tags, destacado, activo
)
VALUES
  (1, 'legacy', 'PRD-BLU-001', 'Blusa Seda Imperial', 'Blusa fluida con escote en V y manga acampanada, ideal para oficina y eventos.', 1, 1, 1, 1, 'blusa', 'femenino', 'Seda Satén', 185.00, 95.00, '/assets/prendas/blusa-azul-foto.jpg', '/assets/prendas/blusa-azul-ar.png', '{"anchor":"torso","scale":1.05,"offsetY":-0.02}'::jsonb, ARRAY['blusa','seda','elegante','ar'], TRUE, TRUE),
  (2, 'legacy', 'PRD-CAM-002', 'Camiseta Algodon Pima Urban', 'Camiseta suave de algodon Pima con calce moderno y alta durabilidad.', 2, 1, 1, 1, 'camiseta', 'unisex', 'Algodon Pima 100%', 110.00, 52.00, '/assets/prendas/camiseta-blanco-foto.jpg', '/assets/prendas/camiseta-blanco-ar.png', '{"anchor":"torso","scale":1.0,"offsetY":0.0}'::jsonb, ARRAY['camiseta','basico','algodon','ar'], TRUE, TRUE),
  (3, 'legacy', 'PRD-CAR-003', 'Cartera Estructurada Milano', 'Cartera de mano y hombro con herraje metalico y solapa magnetica.', 3, 2, 2, 2, 'cartera', 'femenino', 'Eco-Cuero Graneado', 260.00, 130.00, '/assets/prendas/cartera-camel-foto.jpg', '/assets/prendas/cartera-camel-ar.png', '{"anchor":"hip","scale":0.85,"offsetY":0.15}'::jsonb, ARRAY['cartera','accesorio','camel','ar'], TRUE, TRUE),
  (4, 'legacy', 'PRD-CHA-004', 'Chaqueta Sastre Atelier', 'Blazer entallado de cuatro botones con corte arquitectonico.', 4, 2, 2, 2, 'chaqueta', 'femenino', 'Lino y Viscosa', 340.00, 175.00, '/assets/prendas/chaqueta-negro-foto.jpg', '/assets/prendas/chaqueta-negro-ar.png', '{"anchor":"torso","scale":1.12,"offsetY":0.0}'::jsonb, ARRAY['chaqueta','blazer','sastre','ar'], TRUE, TRUE),
  (5, 'legacy', 'PRD-FAL-005', 'Falda Midi Plisada Soleil', 'Falda midi de tiro alto con pliegues definidos y caida ligera.', 5, 1, 1, 1, 'falda', 'femenino', 'Crepe Georgette', 195.00, 92.00, '/assets/prendas/falda-beige-foto.jpg', '/assets/prendas/falda-beige-ar.png', '{"anchor":"hips","scale":1.05,"offsetY":0.22}'::jsonb, ARRAY['falda','midi','plisada','ar'], TRUE, TRUE),
  (6, 'legacy', 'PRD-PAN-006', 'Pantalon Palazzo Riviera', 'Pantalon palazzo de pierna ancha y cintura estructurada.', 6, 1, 1, 1, 'pantalon', 'femenino', 'Gabardina Ligera', 230.00, 110.00, '/assets/prendas/pantalon-vino-foto.jpg', '/assets/prendas/pantalon-vino-ar.png', '{"anchor":"legs","scale":1.08,"offsetY":0.28}'::jsonb, ARRAY['pantalon','palazzo','formal','ar'], TRUE, TRUE),
  (7, 'legacy', 'PRD-VES-007', 'Vestido Gala Aurora', 'Vestido evasé con tirantes y falda fluida para recepciones y coctel.', 7, 1, 2, 2, 'vestido', 'femenino', 'Chiffon Seda', 380.00, 190.00, '/assets/prendas/vestido-rojo-foto.jpg', '/assets/prendas/vestido-rojo-ar.png', '{"anchor":"full_body","scale":1.18,"offsetY":0.08}'::jsonb, ARRAY['vestido','gala','coctel','ar'], TRUE, TRUE),
  (8, 'legacy', 'PRD-ZAP-008', 'Stiletto Clasico Verano', 'Zapato de tacon fino estilizado con plantilla acolchada de confort.', 8, 2, 2, 2, 'zapato', 'femenino', 'Cuero Nobuck', 290.00, 145.00, '/assets/prendas/zapato-negro-foto.jpg', '/assets/prendas/zapato-negro-ar.png', '{"anchor":"feet","scale":0.75,"offsetY":0.42}'::jsonb, ARRAY['zapato','tacon','stiletto','ar'], TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

SELECT setval('productos_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM productos), 8));

-- 7. Variantes (24 variantes con fotos y overlays AR reales)
INSERT INTO variantes (id, tenant_id, producto_id, sku, talla, color, color_hex, precio_adicional, foto_url, ar_url, activa)
VALUES
  (1,  'legacy', 1, 'BLU-AZU-S', 'S', 'azul',    '#1C3F94', 0,  '/assets/prendas/blusa-azul-foto.jpg',     '/assets/prendas/blusa-azul-ar.png', TRUE),
  (2,  'legacy', 1, 'BLU-AZU-M', 'M', 'azul',    '#1C3F94', 0,  '/assets/prendas/blusa-azul-foto.jpg',     '/assets/prendas/blusa-azul-ar.png', TRUE),
  (3,  'legacy', 1, 'BLU-ROS-M', 'M', 'rosado',  '#E094B2', 10, '/assets/prendas/blusa-rosado-foto.jpg',   '/assets/prendas/blusa-rosado-ar.png', TRUE),
  (4,  'legacy', 2, 'CAM-BLA-M', 'M', 'blanco',  '#F2F1EE', 0,  '/assets/prendas/camiseta-blanco-foto.jpg','/assets/prendas/camiseta-blanco-ar.png', TRUE),
  (5,  'legacy', 2, 'CAM-NEG-L', 'L', 'negro',   '#202124', 0,  '/assets/prendas/camiseta-negro-foto.jpg', '/assets/prendas/camiseta-negro-ar.png', TRUE),
  (6,  'legacy', 2, 'CAM-VER-M', 'M', 'verde',   '#2A6C4A', 5,  '/assets/prendas/camiseta-verde-foto.jpg', '/assets/prendas/camiseta-verde-ar.png', TRUE),
  (7,  'legacy', 3, 'CAR-CAM-U', 'U', 'camel',   '#B68452', 0,  '/assets/prendas/cartera-camel-foto.jpg',  '/assets/prendas/cartera-camel-ar.png', TRUE),
  (8,  'legacy', 3, 'CAR-NEG-U', 'U', 'negro',   '#202124', 0,  '/assets/prendas/cartera-negro-foto.jpg',  '/assets/prendas/cartera-negro-ar.png', TRUE),
  (9,  'legacy', 3, 'CAR-VIN-U', 'U', 'vino',    '#6C1E3A', 15, '/assets/prendas/cartera-vino-foto.jpg',   '/assets/prendas/cartera-vino-ar.png', TRUE),
  (10, 'legacy', 4, 'CHA-NEG-M', 'M', 'negro',   '#202124', 0,  '/assets/prendas/chaqueta-negro-foto.jpg', '/assets/prendas/chaqueta-negro-ar.png', TRUE),
  (11, 'legacy', 4, 'CHA-CAM-L', 'L', 'camel',   '#B68452', 20, '/assets/prendas/chaqueta-camel-foto.jpg', '/assets/prendas/chaqueta-camel-ar.png', TRUE),
  (12, 'legacy', 4, 'CHA-BEI-S', 'S', 'beige',   '#D6C2A1', 0,  '/assets/prendas/chaqueta-beige-foto.jpg', '/assets/prendas/chaqueta-beige-ar.png', TRUE),
  (13, 'legacy', 5, 'FAL-BEI-S', 'S', 'beige',   '#D6C2A1', 0,  '/assets/prendas/falda-beige-foto.jpg',    '/assets/prendas/falda-beige-ar.png', TRUE),
  (14, 'legacy', 5, 'FAL-MOS-M', 'M', 'mostaza', '#D69E2E', 10, '/assets/prendas/falda-mostaza-foto.jpg',  '/assets/prendas/falda-mostaza-ar.png', TRUE),
  (15, 'legacy', 5, 'FAL-CEL-M', 'M', 'celeste', '#80B2DB', 0,  '/assets/prendas/falda-celeste-foto.jpg',  '/assets/prendas/falda-celeste-ar.png', TRUE),
  (16, 'legacy', 6, 'PAN-VIN-M', 'M', 'vino',    '#6C1E3A', 0,  '/assets/prendas/pantalon-vino-foto.jpg',  '/assets/prendas/pantalon-vino-ar.png', TRUE),
  (17, 'legacy', 6, 'PAN-GRI-L', 'L', 'gris',    '#84888E', 0,  '/assets/prendas/pantalon-gris-foto.jpg',  '/assets/prendas/pantalon-gris-ar.png', TRUE),
  (18, 'legacy', 6, 'PAN-NEG-M', 'M', 'negro',   '#202124', 0,  '/assets/prendas/pantalon-negro-foto.jpg', '/assets/prendas/pantalon-negro-ar.png', TRUE),
  (19, 'legacy', 7, 'VES-ROJ-S', 'S', 'rojo',    '#B8222A', 0,  '/assets/prendas/vestido-rojo-foto.jpg',   '/assets/prendas/vestido-rojo-ar.png', TRUE),
  (20, 'legacy', 7, 'VES-VIN-M', 'M', 'vino',    '#6C1E3A', 25, '/assets/prendas/vestido-vino-foto.jpg',   '/assets/prendas/vestido-vino-ar.png', TRUE),
  (21, 'legacy', 7, 'VES-AZU-L', 'L', 'azul',    '#1C3F94', 0,  '/assets/prendas/vestido-azul-foto.jpg',   '/assets/prendas/vestido-azul-ar.png', TRUE),
  (22, 'legacy', 8, 'ZAP-NEG-37','37','negro',   '#202124', 0,  '/assets/prendas/zapato-negro-foto.jpg',   '/assets/prendas/zapato-negro-ar.png', TRUE),
  (23, 'legacy', 8, 'ZAP-BEI-38','38','beige',   '#D6C2A1', 0,  '/assets/prendas/zapato-beige-foto.jpg',   '/assets/prendas/zapato-beige-ar.png', TRUE),
  (24, 'legacy', 8, 'ZAP-ROJ-37','37','rojo',    '#B8222A', 15, '/assets/prendas/zapato-rojo-foto.jpg',    '/assets/prendas/zapato-rojo-ar.png', TRUE)
ON CONFLICT (id) DO NOTHING;

SELECT setval('variantes_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM variantes), 24));

-- Galeria de imagenes adicionales por producto
INSERT INTO producto_imagenes (tenant_id, producto_id, color, foto_url, ar_url, orden)
SELECT 'legacy', v.producto_id, v.color, v.foto_url, v.ar_url, v.id
FROM variantes v
WHERE v.tenant_id = 'legacy'
  AND NOT EXISTS (
    SELECT 1 FROM producto_imagenes pi
    WHERE pi.tenant_id = 'legacy' AND pi.producto_id = v.producto_id AND pi.color = v.color
  );

-- 8. Stock en ambas sucursales (incluyendo algunos con stock critico para alertas/reportes)
INSERT INTO stock (tenant_id, almacen_id, variante_id, cantidad, reservado, stock_minimo, ubicacion)
VALUES
  ('legacy', 1, 1,  18, 1, 4, 'A-01'),
  ('legacy', 1, 2,  14, 0, 4, 'A-02'),
  ('legacy', 1, 3,   2, 0, 4, 'A-03'), -- Stock bajo en Sucursal Centro
  ('legacy', 1, 4,  25, 0, 5, 'B-01'),
  ('legacy', 1, 5,  20, 0, 5, 'B-02'),
  ('legacy', 1, 6,  12, 0, 4, 'B-03'),
  ('legacy', 1, 7,   9, 0, 3, 'C-01'),
  ('legacy', 1, 8,  11, 0, 3, 'C-02'),
  ('legacy', 1, 9,   2, 0, 3, 'C-03'), -- Stock bajo
  ('legacy', 1, 10, 10, 0, 3, 'D-01'),
  ('legacy', 1, 11,  8, 0, 3, 'D-02'),
  ('legacy', 1, 12,  7, 0, 3, 'D-03'),
  ('legacy', 1, 13, 15, 0, 4, 'E-01'),
  ('legacy', 1, 14, 10, 0, 4, 'E-02'),
  ('legacy', 1, 15,  9, 0, 4, 'E-03'),
  ('legacy', 1, 16, 13, 0, 4, 'F-01'),
  ('legacy', 1, 17, 11, 0, 4, 'F-02'),
  ('legacy', 1, 18, 16, 0, 4, 'F-03'),
  ('legacy', 1, 19,  8, 0, 3, 'G-01'),
  ('legacy', 1, 20,  6, 0, 3, 'G-02'),
  ('legacy', 1, 21,  7, 0, 3, 'G-03'),
  ('legacy', 1, 22, 10, 0, 3, 'H-01'),
  ('legacy', 1, 23,  9, 0, 3, 'H-02'),
  ('legacy', 1, 24,  1, 0, 3, 'H-03'), -- Stock critico (ultima unidad)
  ('legacy', 2, 1,  12, 0, 3, 'EQ-01'),
  ('legacy', 2, 2,  16, 0, 3, 'EQ-02'),
  ('legacy', 2, 4,  19, 0, 4, 'EQ-03'),
  ('legacy', 2, 7,  14, 0, 3, 'EQ-04'),
  ('legacy', 2, 10, 11, 0, 3, 'EQ-05'),
  ('legacy', 2, 13,  2, 0, 4, 'EQ-06'), -- Stock bajo en Equipetrol
  ('legacy', 2, 16, 10, 0, 3, 'EQ-07'),
  ('legacy', 2, 19,  9, 0, 3, 'EQ-08'),
  ('legacy', 2, 20,  8, 0, 3, 'EQ-09'),
  ('legacy', 2, 22,  7, 0, 3, 'EQ-10')
ON CONFLICT (almacen_id, variante_id) DO NOTHING;

-- 9. Promociones
INSERT INTO promociones (id, tenant_id, codigo, nombre, descripcion, tipo_descuento, valor, minimo_compra, activa)
VALUES
  (1, 'legacy', 'BIENVENIDA10', '10% Descuento Primera Compra', 'Descuento promocional del 10% en compras mayores a Bs. 150', 'porcentaje', 10.00, 150.00, TRUE),
  (2, 'legacy', 'MODA50', 'Bono Bs. 50 en Coleccion Gala', 'Descuento directo de Bs. 50 en compras superiores a Bs. 350', 'monto_fijo', 50.00, 350.00, TRUE)
ON CONFLICT (id) DO NOTHING;

SELECT setval('promociones_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM promociones), 2));

-- 10. Caja POS abierta en Sucursal Centro
INSERT INTO cajas (id, tenant_id, sucursal_id, usuario_apertura_id, estado, monto_inicial, monto_ventas_efectivo, monto_ventas_digital, observaciones)
VALUES
  (1, 'legacy', 1, 3, 'abierta', 500.00, 370.00, 565.00, 'Apertura turno manana Sucursal Centro')
ON CONFLICT (id) DO NOTHING;

SELECT setval('cajas_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM cajas), 1));

-- 11. Reserva activa de demostracion (retiene 1 unidad de variante 1 en almacen 1)
INSERT INTO reservas (id, tenant_id, codigo, usuario_id, sucursal_id, almacen_id, estado, fecha_cita, expira_en, notas)
VALUES
  (1, 'legacy', 'RES-DEMO-001', 5, 1, 1, 'preparada', NOW() + INTERVAL '4 hours', NOW() + INTERVAL '24 hours', 'Reserva para prueba en probador fisico Sucursal Centro')
ON CONFLICT (id) DO NOTHING;

SELECT setval('reservas_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM reservas), 1));

INSERT INTO detalle_reserva (id, tenant_id, reserva_id, variante_id, cantidad, precio_unitario)
VALUES
  (1, 'legacy', 1, 1, 1, 185.00)
ON CONFLICT (id) DO NOTHING;

SELECT setval('detalle_reserva_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM detalle_reserva), 1));

-- 12. Ventas historicas para reportes multi-tabla y dashboard
INSERT INTO ventas (
  id, tenant_id, numero_comprobante, usuario_id, vendedor_id, sucursal_id, almacen_id, caja_id,
  origen, estado, estado_pago, metodo_pago, subtotal, descuento, total, cliente_nombre, cliente_nit, creado_en
)
VALUES
  (1, 'legacy', 'VTA-2026-0001', 5, 3, 1, 1, 1, 'pos', 'pagada', 'aprobado', 'efectivo', 370.00, 0.00, 370.00, 'Andrea Justiniano', '4829102', NOW() - INTERVAL '15 days'),
  (2, 'legacy', 'VTA-2026-0002', 5, NULL, 1, 1, 1, 'web', 'entregada', 'aprobado', 'tarjeta', 565.00, 0.00, 565.00, 'Andrea Justiniano', '4829102', NOW() - INTERVAL '7 days'),
  (3, 'legacy', 'VTA-2026-0003', 5, 2, 2, 2, NULL, 'web', 'pagada', 'aprobado', 'qr', 490.00, 0.00, 490.00, 'Andrea Justiniano', '4829102', NOW() - INTERVAL '2 days')
ON CONFLICT (id) DO NOTHING;

SELECT setval('ventas_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM ventas), 3));

INSERT INTO venta_items (id, tenant_id, venta_id, variante_id, cantidad, precio_unitario, descuento_unitario, subtotal)
VALUES
  (1, 'legacy', 1, 1,  2, 185.00, 0.00, 370.00),
  (2, 'legacy', 2, 7,  1, 260.00, 0.00, 260.00),
  (3, 'legacy', 2, 20, 1, 305.00, 0.00, 305.00),
  (4, 'legacy', 3, 10, 1, 340.00, 0.00, 340.00),
  (5, 'legacy', 3, 4,  1, 150.00, 0.00, 150.00)
ON CONFLICT (id) DO NOTHING;

SELECT setval('venta_items_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM venta_items), 5));

INSERT INTO pagos (
  id, tenant_id, venta_id, referencia_externa, pasarela, metodo, monto, moneda, modo,
  estado, confirmado_proveedor, confirmado_en, creado_en
)
VALUES
  (1, 'legacy', 1, 'PAY-DEMO-0001', 'efectivo_pos', 'efectivo', 370.00, 'BOB', 'sandbox', 'aprobado', TRUE, NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days'),
  (2, 'legacy', 2, 'PAY-DEMO-0002', 'stripe_sandbox', 'tarjeta', 565.00, 'BOB', 'sandbox', 'aprobado', TRUE, NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days'),
  (3, 'legacy', 3, 'PAY-DEMO-0003', 'libelula_sandbox', 'qr', 490.00, 'BOB', 'sandbox', 'aprobado', TRUE, NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days')
ON CONFLICT (id) DO NOTHING;

SELECT setval('pagos_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM pagos), 3));

-- 13. Propuesta de proveedor inicial
INSERT INTO propuestas_producto (
  id, tenant_id, proveedor_id, usuario_id, nombre, tipo_prenda, color, tallas_sugeridas,
  costo_propuesto, precio_sugerido, cantidad_disponible, descripcion, estado
)
VALUES
  (1, 'legacy', 1, 4, 'Blusa Lino Botanico Celeste', 'blusa', 'celeste', 'S,M,L', 88.00, 179.00, 40, 'Lote de blusas en lino natural teñido artesanalmente', 'pendiente')
ON CONFLICT (id) DO NOTHING;

SELECT setval('propuestas_producto_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM propuestas_producto), 1));

-- 14. Notificaciones iniciales
INSERT INTO notificaciones (id, tenant_id, usuario_id, titulo, mensaje, tipo, leida, referencia_url)
VALUES
  (1, 'legacy', 1, 'Bienvenido a FashionStore SaaS Multi-Tenant', 'El entorno legacy se encuentra activo y protegido con Row-Level Security (RLS).', 'sistema', FALSE, '/panel/dashboard'),
  (2, 'legacy', 5, 'Reserva RES-DEMO-001 Preparada', 'Tu prenda Blusa Seda Imperial (Talla S, Azul) esta lista en Sucursal Centro.', 'reserva', FALSE, '/mis-reservas')
ON CONFLICT (id) DO NOTHING;

SELECT setval('notificaciones_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM notificaciones), 2));

-- =============================================================================
-- 15. DATOS DE EJEMPLO PARA TODOS LOS MODULOS (estado pendiente / rechazada /
--     en transito / reembolsada / offline) para que NINGUNA pantalla quede vacia
-- =============================================================================

-- 15.1 Venta PENDIENTE DE PAGO + pago pendiente (flujo "reintentar pago")
INSERT INTO ventas (
  id, tenant_id, numero_comprobante, usuario_id, vendedor_id, sucursal_id, almacen_id, caja_id,
  origen, estado, estado_pago, metodo_pago, subtotal, descuento, total, promocion_codigo,
  cliente_nombre, cliente_nit, creado_en
)
VALUES
  (4, 'legacy', 'VTA-2026-0004', 5, NULL, 1, 1, NULL, 'web', 'pendiente_pago', 'pendiente', 'stripe_sandbox',
   295.00, 29.50, 265.50, 'BIENVENIDA10', 'Andrea Justiniano', '4829102', NOW() - INTERVAL '3 hours'),
  (5, 'legacy', 'VTA-2026-0005', 5, NULL, 2, 2, NULL, 'web', 'cancelada', 'rechazado', 'stripe_sandbox',
   230.00, 0.00, 230.00, NULL, 'Andrea Justiniano', '4829102', NOW() - INTERVAL '1 day')
ON CONFLICT (id) DO NOTHING;

SELECT setval('ventas_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM ventas), 5));

INSERT INTO venta_items (id, tenant_id, venta_id, variante_id, cantidad, precio_unitario, descuento_unitario, subtotal)
VALUES
  (6, 'legacy', 4, 2,  1, 185.00, 0.00, 185.00),   -- Blusa Seda Imperial (M, azul)
  (7, 'legacy', 4, 4,  1, 110.00, 0.00, 110.00),   -- Camiseta Algodon Pima (M, blanco)
  (8, 'legacy', 5, 16, 1, 230.00, 0.00, 230.00)    -- Pantalon Palazzo Riviera (M, vino)
ON CONFLICT (id) DO NOTHING;

SELECT setval('venta_items_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM venta_items), 8));

INSERT INTO pagos (
  id, tenant_id, venta_id, referencia_externa, pasarela, metodo, monto, moneda, modo,
  estado, confirmado_proveedor, motivo_rechazo, expira_en, creado_en
)
VALUES
  (4, 'legacy', 4, 'PAY-DEMO-0004', 'stripe_sandbox', 'tarjeta', 265.50, 'BOB', 'sandbox',
   'pendiente', FALSE, NULL, NOW() + INTERVAL '30 minutes', NOW() - INTERVAL '3 hours'),
  (5, 'legacy', 5, 'PAY-DEMO-0005', 'stripe_sandbox', 'tarjeta', 230.00, 'BOB', 'sandbox',
   'rechazado', FALSE, 'Tarjeta rechazada: fondos insuficientes (simulacion sandbox)', NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '1 day')
ON CONFLICT (id) DO NOTHING;

SELECT setval('pagos_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM pagos), 5));

-- 15.2 Devolucion REEMBOLSADA de la venta 2 (entregada)
INSERT INTO devoluciones (id, tenant_id, venta_id, usuario_id, almacen_id, motivo, monto_reembolsado, estado, creado_en)
VALUES
  (1, 'legacy', 2, 2, 1, 'Devolucion por talla incorrecta del Vestido Gala Aurora; cliente solicita reembolso a tarjeta', 305.00, 'reembolsada', NOW() - INTERVAL '6 days')
ON CONFLICT (id) DO NOTHING;

SELECT setval('devoluciones_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM devoluciones), 1));

INSERT INTO devolucion_items (id, tenant_id, devolucion_id, variante_id, cantidad)
VALUES
  (1, 'legacy', 1, 20, 1)   -- Vestido Gala Aurora (M, vino)
ON CONFLICT (id) DO NOTHING;

SELECT setval('devolucion_items_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM devolucion_items), 1));

-- 15.3 Recepciones de proveedor: una completada (Centro) y una EN TRANSITO (Equipetrol)
INSERT INTO recepciones (id, tenant_id, almacen_id, proveedor_id, usuario_id, numero_documento, estado, observaciones, total_costo, creado_en)
VALUES
  (1, 'legacy', 1, 1, 2, 'REC-2026-0001', 'completada', 'Recepcion completa PV-2026: faldas y blusas de Textiles Andinos', 1325.00, NOW() - INTERVAL '20 days'),
  (2, 'legacy', 2, 2, 2, 'REC-2026-0002', 'en_transito', 'Entrega programada de Atelier Moda Oriental: prendas en transito', 1750.00, NOW() - INTERVAL '1 day')
ON CONFLICT (id) DO NOTHING;

SELECT setval('recepciones_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM recepciones), 2));

INSERT INTO recepcion_items (id, tenant_id, recepcion_id, variante_id, cantidad, costo_unitario)
VALUES
  (1, 'legacy', 1, 14, 10,  92.00),   -- Falda Midi Plisada Soleil (M, mostaza)
  (2, 'legacy', 1, 13,  5,  81.00),   -- Falda Midi Plisada Soleil (S, beige)
  (3, 'legacy', 2, 11,  5, 175.00),   -- Chaqueta Sastre Atelier (L, camel)
  (4, 'legacy', 2, 12, 10,  87.50)    -- Chaqueta Sastre Atelier (S, beige)
ON CONFLICT (id) DO NOTHING;

SELECT setval('recepcion_items_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM recepcion_items), 4));

-- 15.4 Movimientos de inventario (saldos tomados del stock actual para coherencia)
INSERT INTO movimientos_inventario (tenant_id, almacen_id, variante_id, usuario_id, tipo, cantidad, saldo_cantidad, saldo_reservado, referencia, motivo, creado_en)
SELECT 'legacy', 1, 14, 2, 'recepcion', 10, s.cantidad, s.reservado, 'REC-2026-0001', 'Ingreso por recepcion de proveedor Textiles Andinos', NOW() - INTERVAL '20 days' FROM stock s WHERE s.tenant_id='legacy' AND s.almacen_id=1 AND s.variante_id=14
UNION ALL
SELECT 'legacy', 1, 13, 2, 'recepcion', 5, s.cantidad, s.reservado, 'REC-2026-0001', 'Ingreso por recepcion de proveedor Textiles Andinos', NOW() - INTERVAL '20 days' FROM stock s WHERE s.tenant_id='legacy' AND s.almacen_id=1 AND s.variante_id=13
UNION ALL
SELECT 'legacy', 1, 1, 3, 'venta', -2, s.cantidad, s.reservado, 'VTA-2026-0001', 'Venta POS efectivo comprobante VTA-2026-0001', NOW() - INTERVAL '15 days' FROM stock s WHERE s.tenant_id='legacy' AND s.almacen_id=1 AND s.variante_id=1
UNION ALL
SELECT 'legacy', 1, 1, 5, 'reserva', 1, s.cantidad, s.reservado, 'RES-DEMO-001', 'Unidad retenida para probador en sucursal', NOW() - INTERVAL '2 days' FROM stock s WHERE s.tenant_id='legacy' AND s.almacen_id=1 AND s.variante_id=1
UNION ALL
SELECT 'legacy', 1, 20, 2, 'devolucion', 1, s.cantidad, s.reservado, 'VTA-2026-0002', 'Reingreso por devolucion reembolsada', NOW() - INTERVAL '6 days' FROM stock s WHERE s.tenant_id='legacy' AND s.almacen_id=1 AND s.variante_id=20;

-- 15.5 Operaciones offline del POS (una sincronizada y una pendiente de sync)
INSERT INTO operaciones_offline (
  id, tenant_id, tipo, usuario_id, sucursal_id, actor_rol, payload_hash, payload_json,
  estado, respuesta_json, motivo_error, intentos, codigo_conflicto, compensacion_json, creado_en, procesado_en
)
VALUES
  ('OP-DEMO-0001', 'legacy', 'venta', 3, 1, 'cajero', md5('fashionstore-op-demo-0001'),
   '{"items":[{"variante_id":1,"cantidad":1}],"total":185.00,"metodo":"efectivo","sucursal_id":1}'::jsonb,
   'sincronizada', '{"ok":true,"comprobante":"VTA-2026-POS-DEMO"}'::jsonb, NULL, 1, NULL, NULL,
   NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days' + INTERVAL '2 minutes'),
  ('OP-DEMO-0002', 'legacy', 'venta', 3, 1, 'cajero', md5('fashionstore-op-demo-0002'),
   '{"items":[{"variante_id":4,"cantidad":1}],"total":110.00,"metodo":"efectivo","sucursal_id":1}'::jsonb,
   'pendiente', NULL, NULL, 2, NULL, NULL,
   NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours')
ON CONFLICT (id) DO NOTHING;

-- 15.6 Interacciones del cliente (web, vestidor AR, busqueda, compra)
INSERT INTO interacciones (tenant_id, usuario_id, producto_id, variante_id, tipo, metadata_json, creado_en)
VALUES
  ('legacy', 5, 1, 1, 'vista', '{"origen":"catalogo"}'::jsonb, NOW() - INTERVAL '30 days'),
  ('legacy', 5, 1, 2, 'probador_ar', '{"resultado":"talla_m","precision":0.91}'::jsonb, NOW() - INTERVAL '20 days'),
  ('legacy', 5, 7, 19, 'carrito', '{}'::jsonb, NOW() - INTERVAL '12 days'),
  ('legacy', 5, 2, 4, 'compra', '{}'::jsonb, NOW() - INTERVAL '15 days'),
  ('legacy', 5, NULL, NULL, 'busqueda', '{"query":"vestido gala","resultados":3}'::jsonb, NOW() - INTERVAL '2 days'),
  ('legacy', 5, 8, 22, 'vista', '{"origen":"recomendacion_ia"}'::jsonb, NOW() - INTERVAL '6 days');

-- 15.7 Recomendaciones IA (motor local determinista)
INSERT INTO recomendaciones_ia (tenant_id, usuario_id, producto_origen_id, productos_recomendados, explicacion, algoritmo)
VALUES
  ('legacy', 5, 1, '[{"producto_id":2,"score":0.91},{"producto_id":8,"score":0.74}]'::jsonb,
   'Clientes que probaron Blusa Seda Imperial tambien consideraron Camiseta Algodon Pima y Stiletto Clasico Verano.', 'hibrido_reglas_contenido'),
  ('legacy', 5, 7, '[{"producto_id":3,"score":0.82},{"producto_id":4,"score":0.69}]'::jsonb,
   'La Cartera Milano y la Chaqueta Sastre Atelier combinan con Vestido Gala Aurora para noche.', 'hibrido_reglas_contenido');

-- 15.8 Conversaciones con el Asistente IA (Motor Local Determinista)
INSERT INTO conversaciones_ia (tenant_id, usuario_id, sesion_id, mensaje_usuario, respuesta_asistente, intencion, proveedor_llm)
VALUES
  ('legacy', 5, 'SES-DEMO-0001', '¿Que talla me queda mejor en la Blusa Seda Imperial?',
   'Segun el probador virtual, tu talla ideal es M: el corte a la cintura favorece tu silueta y el escote en V estiliza.', 'recomendacion_talla', 'local_rules'),
  ('legacy', 5, 'SES-DEMO-0002', '¿Tienen stock de la chaqueta sastre en camel talla L?',
   'Si. La Chaqueta Sastre Atelier (CHA-CAM-L) tiene unidades disponibles en Sucursal Centro.', 'consulta_stock', 'local_rules'),
  ('legacy', 1, 'SES-DEMO-0003', 'Resumen de ventas de la ultima semana',
   'Ultimos 7 dias: 2 ventas aprobadas por Bs. 1,055.00; ticket promedio Bs. 527.50. Producto estrella: Blusa Seda Imperial.', 'reporte_ventas', 'local_rules');

-- 15.9 Auditoria (login, venta POS, alerta de stock critico, devolucion)
INSERT INTO auditoria (tenant_id, usuario_id, entidad, entidad_id, accion, detalle_json, ip, creado_en)
VALUES
  ('legacy', 1, 'usuarios', '1', 'login', '{"ip":"127.0.0.1","resultado":"ok"}'::jsonb, '127.0.0.1', NOW() - INTERVAL '1 day'),
  ('legacy', 3, 'ventas', '3', 'venta_pos_pagada', '{"total":490.00,"metodo":"qr","sucursal_id":2}'::jsonb, '127.0.0.1', NOW() - INTERVAL '2 days'),
  ('legacy', 2, 'stock', '24', 'stock_critico', '{"sku":"ZAP-ROJ-37","disponible":1}'::jsonb, '127.0.0.1', NOW() - INTERVAL '4 days'),
  ('legacy', 1, 'devoluciones', '1', 'devolucion_reembolsada', '{"monto":305.00,"venta":"VTA-2026-0002"}'::jsonb, '127.0.0.1', NOW() - INTERVAL '6 days');

-- 15.10 Caja CERRADA en Boutique Equipetrol (historial de arqueos)
INSERT INTO cajas (id, tenant_id, sucursal_id, usuario_apertura_id, usuario_cierre_id, estado, monto_inicial, monto_ventas_efectivo, monto_ventas_digital, monto_cierre_declarado, diferencia_arqueo, observaciones, abierta_en, cerrada_en)
VALUES
  (2, 'legacy', 2, 2, 2, 'cerrada', 300.00, 210.00, 120.00, 630.00, 0.00, 'Cierre sin novedad - turno tarde Boutique Equipetrol',
   NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days' + INTERVAL '9 hours')
ON CONFLICT (id) DO NOTHING;

SELECT setval('cajas_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM cajas), 2));

-- 15.11 Reserva FINALIZADA (recogida) en Equipetrol + su detalle
INSERT INTO reservas (id, tenant_id, codigo, usuario_id, sucursal_id, almacen_id, atendido_por_id, estado, fecha_cita, expira_en, notas)
VALUES
  (2, 'legacy', 'RES-DEMO-002', 5, 2, 2, 2, 'finalizada', NOW() - INTERVAL '5 days', NOW() - INTERVAL '4 days', 'Reserva recogida y probada en boutique; venta posterior registrada')
ON CONFLICT (id) DO NOTHING;

SELECT setval('reservas_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM reservas), 2));

INSERT INTO detalle_reserva (id, tenant_id, reserva_id, variante_id, cantidad, precio_unitario)
VALUES
  (2, 'legacy', 2, 10, 1, 340.00)   -- Chaqueta Sastre Atelier (M, negro)
ON CONFLICT (id) DO NOTHING;

SELECT setval('detalle_reserva_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM detalle_reserva), 2));

-- 15.12 Propuesta de proveedor APROBADA (ademas de la pendiente existente)
INSERT INTO propuestas_producto (
  id, tenant_id, proveedor_id, usuario_id, nombre, tipo_prenda, color, tallas_sugeridas,
  costo_propuesto, precio_sugerido, cantidad_disponible, descripcion, estado, comentario_revision, revisado_por_id
)
VALUES
  (2, 'legacy', 1, 4, 'Falda Saten Verde Bosque', 'falda', 'verde', 'S,M,L',
   78.00, 165.00, 60, 'Lote de faldas en saten verde bosque con forro de viscosa', 'aprobada',
   'Aprobada para la coleccion Primavera - Verano 2026.', 1)
ON CONFLICT (id) DO NOTHING;

SELECT setval('propuestas_producto_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM propuestas_producto), 2));

-- 15.13 Notificaciones adicionales (alerta de stock, reembolso, en transito)
INSERT INTO notificaciones (id, tenant_id, usuario_id, titulo, mensaje, tipo, leida, referencia_url)
VALUES
  (3, 'legacy', 1, 'Stock critico: Stiletto Clasico Verano', 'Queda 1 unidad de ZAP-ROJ-37 en Sucursal Centro: supero el punto de reorden.', 'alerta', FALSE, '/panel/inventario'),
  (4, 'legacy', 5, 'Devolucion reembolsada', 'Tu devolucion del Vestido Gala Aurora por Bs. 305.00 fue reembolsada a tu tarjeta.', 'devolucion', FALSE, '/mis-pedidos'),
  (5, 'legacy', 2, 'Recepcion REC-2026-0002 en transito', 'Atelier Moda Oriental: 15 unidades en camino a Boutique Equipetrol.', 'recepcion', FALSE, '/panel/inventario')
ON CONFLICT (id) DO NOTHING;

SELECT setval('notificaciones_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM notificaciones), 5));

-- 15.14 Solicitudes de suscripcion SaaS (pendiente de aprobacion + aprobada sandbox)
INSERT INTO solicitudes_suscripcion (id, tenant_id, usuario_id, plan_actual, plan_solicitado, estado, cobro_real, notas)
VALUES
  (1, 'legacy', 1, 'demo', 'profesional', 'pendiente_aprobacion', FALSE, 'Solicitud para evaluar el plan Profesional Multitienda (modo sandbox, sin cobro real).'),
  (2, 'legacy', 1, 'demo', 'basico', 'aprobada_sandbox', FALSE, 'Aprobada en modo sandbox para pruebas de flujo; sin cobro automatico.')
ON CONFLICT (id) DO NOTHING;

SELECT setval('solicitudes_suscripcion_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM solicitudes_suscripcion), 2));

-- 16. Datos de fábrica de tablas SaaS, sincronización y ML
-- Los ejemplos son sintéticos. Se restablecen junto con el tenant legacy en cada inicio normal.

-- Asegurar la suscripción visible y renovarla con la ventana de demo de esta instalación.
INSERT INTO public.suscripciones
  (tenant_id, plan_codigo, estado, inicio, vence_en, modo_cobro, metadata_json, actualizado_en)
VALUES
  ('legacy', 'demo', 'activa', NOW(), NOW() + INTERVAL '14 days', 'prueba',
   '{"origen":"seed_fabrica","es_sintetico":true,"cobro_real":false}'::jsonb, NOW())
ON CONFLICT (tenant_id) DO UPDATE SET
  plan_codigo = EXCLUDED.plan_codigo, estado = 'activa', inicio = EXCLUDED.inicio,
  vence_en = EXCLUDED.vence_en, modo_cobro = 'prueba', metadata_json = EXCLUDED.metadata_json,
  actualizado_en = NOW();

-- Venta a crédito con un abono parcial, para poblar cuentas por cobrar.
INSERT INTO public.ventas (
  id, tenant_id, numero_comprobante, usuario_id, vendedor_id, sucursal_id, almacen_id, caja_id,
  origen, estado, estado_pago, metodo_pago, subtotal, descuento, total,
  cliente_nombre, cliente_nit, creado_en, es_credito, credito_vencimiento
)
VALUES
  (6, 'legacy', 'VTA-2026-CRED-0001', 5, 3, 1, 1, 1, 'pos', 'pendiente_pago', 'pendiente', 'credito',
   295.00, 0.00, 295.00, 'Andrea Justiniano', '4829102', NOW() - INTERVAL '4 days', TRUE, NOW() + INTERVAL '10 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.venta_items (id, tenant_id, venta_id, variante_id, cantidad, precio_unitario, descuento_unitario, subtotal)
VALUES
  (9, 'legacy', 6, 2, 1, 185.00, 0.00, 185.00),
  (10, 'legacy', 6, 4, 1, 110.00, 0.00, 110.00)
ON CONFLICT (id) DO NOTHING;

SELECT setval('ventas_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM public.ventas), 6));
SELECT setval('venta_items_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM public.venta_items), 10));

INSERT INTO public.cuentas_por_cobrar
  (id, tenant_id, venta_id, cliente_id, cliente_nombre, cliente_telefono, cliente_correo,
   monto_original, monto_abonado, saldo, estado, vence_en, creado_en, actualizado_en)
VALUES
  (1, 'legacy', 6, 5, 'Andrea Justiniano', '+591 70010005', 'cliente@fashionstore.bo',
   295.00, 100.00, 195.00, 'PARCIAL', NOW() + INTERVAL '10 days', NOW() - INTERVAL '4 days', NOW() - INTERVAL '1 day')
ON CONFLICT (tenant_id, venta_id) DO NOTHING;

SELECT setval('public.cuentas_por_cobrar_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM public.cuentas_por_cobrar), 1));

INSERT INTO public.abonos_cuenta
  (id, tenant_id, cuenta_id, monto, metodo_pago, referencia, registrado_por, notas, creado_en)
VALUES
  (1, 'legacy', 1, 100.00, 'efectivo', 'ABONO-DEMO-0001', 3,
   'Abono parcial de ejemplo; saldo restante Bs. 195.00.', NOW() - INTERVAL '1 day')
ON CONFLICT (id) DO NOTHING;

SELECT setval('public.abonos_cuenta_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM public.abonos_cuenta), 1));

-- Dispositivos y conflicto de sincronización visible como caso de recuperación.
INSERT INTO public.dispositivos_sync
  (id, tenant_id, usuario_id, device_key, plataforma, etiqueta, cursor_pull, ultima_sync_en, ultimo_visto_en, activo, metadata_json)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'legacy', 3, 'factory-web-pos-centro', 'web', 'POS Web · Sucursal Centro', 25, NOW() - INTERVAL '3 minutes', NOW(), TRUE, '{"es_sintetico":true,"sucursal_id":1}'::jsonb),
  ('00000000-0000-4000-8000-000000000002', 'legacy', 2, 'factory-android-equipetrol', 'android', 'Android · Equipetrol', 21, NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '10 minutes', TRUE, '{"es_sintetico":true,"sucursal_id":2}'::jsonb)
ON CONFLICT (tenant_id, device_key) DO NOTHING;

INSERT INTO public.operaciones_offline (
  id, tenant_id, tipo, usuario_id, sucursal_id, actor_rol, payload_hash, payload_json,
  estado, respuesta_json, motivo_error, intentos, codigo_conflicto, compensacion_json, creado_en, procesado_en
)
VALUES
  ('OP-DEMO-0003', 'legacy', 'venta', 3, 1, 'cajero', md5('fashionstore-op-demo-0003'),
   '{"items":[{"variante_id":24,"cantidad":3}],"total":870.00,"metodo":"efectivo","sucursal_id":1}'::jsonb,
   'conflicto', NULL, 'Stock insuficiente al sincronizar: se conserva para resolución manual.', 3,
   'STOCK_INSUFICIENTE', NULL, NOW() - INTERVAL '45 minutes', NOW() - INTERVAL '44 minutes')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.conflictos_sync
  (tenant_id, operacion_id, dispositivo_id, tipo, estado, regla, payload_local, payload_servidor, creado_en)
VALUES
  ('legacy', 'OP-DEMO-0003', '00000000-0000-4000-8000-000000000001', 'VENTA_POS', 'PENDIENTE',
   'STOCK_ATOMICO_PRIMERA_CONFIRMADA',
   '{"sku":"ZAP-ROJ-37","cantidad_solicitada":3,"sucursal_id":1,"es_sintetico":true}'::jsonb,
   '{"sku":"ZAP-ROJ-37","stock_disponible":1,"sucursal_id":1,"es_sintetico":true}'::jsonb,
   NOW() - INTERVAL '45 minutes')
ON CONFLICT (tenant_id, operacion_id) DO NOTHING;

INSERT INTO public.idempotencia
  (tenant_id, clave, hash_request, estado, respuesta, creado_en, actualizado_en)
VALUES
  ('legacy', 'FACTORY-DEMO-IDEMP-0001', encode(digest('fashionstore factory idempotency demo 2026', 'sha256'), 'hex'),
   'COMPLETADA', '{"ok":true,"replay_demo":true,"es_sintetico":true}'::jsonb, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day')
ON CONFLICT (tenant_id, clave) DO NOTHING;

-- El backfill de la migración 010 ocurre antes del seed; completar sagas para pagos semilla 4–5.
INSERT INTO public.saga_pago
  (tenant_id, operacion_id, venta_id, pago_id, estado, paso_actual, datos_json, creado_en, actualizado_en)
SELECT p.tenant_id, p.referencia_externa, p.venta_id, p.id,
       CASE WHEN p.estado = 'aprobado' THEN 'VENTA_CONFIRMADA'
            WHEN p.estado IN ('rechazado', 'expirado', 'reembolsado') THEN 'COMPENSADA'
            ELSE 'PAGO_PENDIENTE' END,
       CASE WHEN p.estado = 'aprobado' THEN 'T4'
            WHEN p.estado IN ('rechazado', 'expirado', 'reembolsado') THEN 'C1'
            ELSE 'T2' END,
       jsonb_build_object('es_sintetico', TRUE, 'origen', 'seed_fabrica'), p.creado_en, NOW()
  FROM public.pagos p WHERE p.tenant_id = 'legacy'
ON CONFLICT (tenant_id, operacion_id) DO NOTHING;

INSERT INTO public.webhooks_recibidos
  (tenant_id, provider, event_id, referencia, monto, firma_valida, procesado, intentos, payload_json, recibido_en, procesado_en)
VALUES
  ('legacy', 'stripe_sandbox', 'EVT-FACTORY-APPROVED-0002', 'PAY-DEMO-0002', 565.00, TRUE, TRUE, 1,
   '{"event_id":"EVT-FACTORY-APPROVED-0002","reference":"PAY-DEMO-0002","currency":"BOB","status":"succeeded","es_sintetico":true,"sandbox":true}'::jsonb,
   NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days')
ON CONFLICT (event_id) DO NOTHING;

UPDATE public.pagos SET webhook_id = 'EVT-FACTORY-APPROVED-0002'
 WHERE tenant_id = 'legacy' AND referencia_externa = 'PAY-DEMO-0002';

INSERT INTO public.reportes_generados
  (tenant_id, usuario_id, solicitud, especificacion_json, filtros_json, resultado_json, motor, creado_en)
VALUES
  ('legacy', 1, 'Ventas confirmadas de los últimos 30 días por sucursal',
   '{"tipo_reporte":"ventas_resumen","agrupacion":"sucursal","es_sintetico":true}'::jsonb,
   '{"periodo_dias":30,"tenant_slug":"legacy"}'::jsonb,
   '{"titulo":"Ventas demo por sucursal","filas":[{"sucursal":"Sucursal Centro","ventas_confirmadas":2,"total_bob":935.00},{"sucursal":"Sucursal Equipetrol","ventas_confirmadas":1,"total_bob":490.00}],"es_sintetico":true}'::jsonb,
   'reglas_locales', NOW() - INTERVAL '1 day'),
  ('legacy', 1, 'Stock crítico para reposición',
   '{"tipo_reporte":"inventario_critico","es_sintetico":true}'::jsonb,
   '{"tenant_slug":"legacy"}'::jsonb,
   '{"titulo":"Alertas de reposición demo","filas":[{"sku":"ZAP-ROJ-37","disponible":1,"minimo":3},{"sku":"CAR-VIN-U","disponible":2,"minimo":3}],"es_sintetico":true}'::jsonb,
   'reglas_locales', NOW() - INTERVAL '2 hours');

INSERT INTO public.modelos_ml
  (id, tenant_id, algoritmo, version, estado, semilla, metricas, features_json, modelo, creado_en)
VALUES
  (1, 'legacy', $alg$propension_compra_logistica$alg$, 1, 'APROBADO', 2026, $metrics${"holdout":{"muestras_evaluadas":160,"accuracy":0.95,"accuracy_pct":95.0,"precision":0.957,"precision_pct":95.7,"recall":0.957,"recall_pct":95.7,"f1":0.957,"f1_pct":95.7,"matriz_confusion":{"tp":89,"fp":4,"tn":63,"fn":4}},"es_dataset_sintetico":true,"gobernanza":"Artefacto de demostración entrenado solo con datos sintéticos reproducibles; no usar para decisiones comerciales ni clientes/inventario real."}$metrics$::jsonb, $features$["dias_desde_compra","compras_12m","gasto_12m_bs","interacciones_30d"]$features$::jsonb, convert_to($model${"formato":1,"dataset":"sintetico_reproducible","seed":2026,"features":["dias_desde_compra","compras_12m","gasto_12m_bs","interacciones_30d"],"scaler":{"media":[58.8171875,6.146875,1742.5884531250001,10.6296875],"desviacion":[46.67283009160448,4.623237514704484,1678.1599150426564,7.814279687747372]},"pesos":[-2.003372800523679,1.1444165811884996,0.8003015332944452,1.2462078291723113],"intercepto":1.506697818532034}$model$, 'UTF8'), NOW() - INTERVAL '1 hours'),
  (2, 'legacy', $alg$riesgo_quiebre_logistica$alg$, 1, 'APROBADO', 2026, $metrics${"holdout":{"muestras_evaluadas":80,"accuracy":0.9125,"accuracy_pct":91.25,"precision":1.0,"precision_pct":100.0,"recall":0.7941,"recall_pct":79.41,"f1":0.8852,"f1_pct":88.52,"matriz_confusion":{"tp":27,"fp":0,"tn":46,"fn":7}},"es_dataset_sintetico":true,"gobernanza":"Artefacto de demostración entrenado solo con datos sintéticos reproducibles; no usar para decisiones comerciales ni clientes/inventario real."}$metrics$::jsonb, $features$["stock_disponible","ventas_30d","rotacion_diaria","plazo_reposicion_dias","indice_temporada"]$features$::jsonb, convert_to($model${"formato":1,"dataset":"sintetico_reproducible","seed":2026,"features":["stock_disponible","ventas_30d","rotacion_diaria","plazo_reposicion_dias","indice_temporada"],"scaler":{"media":[17.5,30.90625,1.0301875,11.915625,1.13125],"desviacion":[10.188813092097888,17.232795472932192,0.5744452653235681,5.553027888495386,0.18221125222903078]},"pesos":[-2.4172696934355957,0.9460772062010049,0.9459540605253285,1.5518292031091032,0.5845393846183901],"intercepto":-1.066222626718158}$model$, 'UTF8'), NOW() - INTERVAL '2 hours'),
  (3, 'legacy', $alg$segmentacion_clientes_kmeans$alg$, 1, 'APROBADO', 2026, $metrics${"k":3,"muestras_analizadas":300,"inercia":318.69,"curva_codo_inercia":{"2":525.11,"3":318.69,"4":233.74,"5":200.32},"es_dataset_sintetico":true,"gobernanza":"Artefacto de demostración entrenado solo con datos sintéticos reproducibles; no usar para decisiones comerciales ni clientes/inventario real."}$metrics$::jsonb, $features$["dias_desde_compra","compras_12m","gasto_12m_bs","interacciones_30d"]$features$::jsonb, convert_to($model${"formato":1,"dataset":"sintetico_reproducible","seed":2026,"features":["dias_desde_compra","compras_12m","gasto_12m_bs","interacciones_30d"],"scaler":{"media":[57.53,6.236666666666666,1823.0767666666668,11.01],"desviacion":[47.28822638368931,4.541225751561396,1729.850413650431,7.835467343750676]},"centroides_escalados":[[-0.8488,1.4685,1.4841,1.1715],[-0.3264,-0.2513,-0.2895,-0.0334],[1.4024,-0.9078,-0.8516,-1.0352]],"segmentos":[{"cluster_id":0,"nombre_segmento":"Cluster 0 - Clientes VIP / Alta Frecuencia","tamano":74,"porcentaje":24.67,"centroide_escalado":{"dias_desde_compra":-0.8488,"compras_12m":1.4685,"gasto_12m_bs":1.4841,"interacciones_30d":1.1715},"centroide_original":{"dias_desde_compra":17.39,"compras_12m":12.91,"gasto_12m_bs":4390.39,"interacciones_30d":20.19},"decision_negocio":"Acceso anticipado a nueva coleccion, invitacion al probador AR y reservas prioritarias."},{"cluster_id":1,"nombre_segmento":"Cluster 1 - Compradores Regulares Estacionales","tamano":147,"porcentaje":49.0,"centroide_escalado":{"dias_desde_compra":-0.3264,"compras_12m":-0.2513,"gasto_12m_bs":-0.2895,"interacciones_30d":-0.0334},"centroide_original":{"dias_desde_compra":42.1,"compras_12m":5.1,"gasto_12m_bs":1322.36,"interacciones_30d":10.75},"decision_negocio":"Promociones cruzadas por temporada (combos blusa + pantalon) para elevar ticket promedio."},{"cluster_id":2,"nombre_segmento":"Cluster 2 - Clientes en Riesgo de Inactividad","tamano":79,"porcentaje":26.33,"centroide_escalado":{"dias_desde_compra":1.4024,"compras_12m":-0.9078,"gasto_12m_bs":-0.8516,"interacciones_30d":-1.0352},"centroide_original":{"dias_desde_compra":123.85,"compras_12m":2.11,"gasto_12m_bs":349.97,"interacciones_30d":2.9},"decision_negocio":"Campana de reactivacion con cupon controlado y recordatorio de novedades en su talla."}]}$model$, 'UTF8'), NOW() - INTERVAL '3 hours')
ON CONFLICT (tenant_id, algoritmo, version) DO NOTHING;

SELECT setval('public.modelos_ml_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM public.modelos_ml), 3));

INSERT INTO public.predicciones
  (id, tenant_id, modelo_id, entidad_tipo, entidad_id, valor_json, es_sintetico, creado_en)
VALUES
  (1, 'legacy', 1, 'muestra_sintetica', 'demo-seed-42', $prediction${"probabilidad":0.911618,"clase":1,"features_sinteticas":{"dias_desde_compra":23,"compras_12m":7,"gasto_12m_bs":1358.03,"interacciones_30d":6}}$prediction$::jsonb, TRUE, NOW() - INTERVAL '1 hours'),
  (2, 'legacy', 2, 'muestra_sintetica', 'demo-seed-42', $prediction${"probabilidad":0.469535,"clase":0,"features_sinteticas":{"stock_disponible":11,"ventas_30d":55,"rotacion_diaria":1.833,"plazo_reposicion_dias":4,"indice_temporada":0.81}}$prediction$::jsonb, TRUE, NOW() - INTERVAL '2 hours'),
  (3, 'legacy', 3, 'muestra_sintetica', 'demo-seed-42', $prediction${"cluster_id":1,"nombre_segmento":"Cluster 1 - Compradores Regulares Estacionales","recomendacion":"Promociones cruzadas por temporada (combos blusa + pantalon) para elevar ticket promedio.","features_sinteticas":{"dias_desde_compra":23,"compras_12m":7,"gasto_12m_bs":1358.03,"interacciones_30d":6}}$prediction$::jsonb, TRUE, NOW() - INTERVAL '3 hours')
ON CONFLICT (id) DO NOTHING;

SELECT setval('public.predicciones_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM public.predicciones), 3));

INSERT INTO public.segmentos_cliente
  (tenant_id, modelo_id, cliente_id, cluster_id, perfil_json, recomendacion, es_sintetico, creado_en)
VALUES
  ('legacy', 3, NULL, 0, $profile${"nombre_segmento":"Cluster 0 - Clientes VIP / Alta Frecuencia","tamano_sintetico":74,"porcentaje_sintetico":24.67,"centroide_sintetico":{"dias_desde_compra":17.39,"compras_12m":12.91,"gasto_12m_bs":4390.39,"interacciones_30d":20.19}}$profile$::jsonb, $recommendation$Acceso anticipado a nueva coleccion, invitacion al probador AR y reservas prioritarias.$recommendation$, TRUE, NOW() - INTERVAL '1 day'),
  ('legacy', 3, NULL, 1, $profile${"nombre_segmento":"Cluster 1 - Compradores Regulares Estacionales","tamano_sintetico":147,"porcentaje_sintetico":49.0,"centroide_sintetico":{"dias_desde_compra":42.1,"compras_12m":5.1,"gasto_12m_bs":1322.36,"interacciones_30d":10.75}}$profile$::jsonb, $recommendation$Promociones cruzadas por temporada (combos blusa + pantalon) para elevar ticket promedio.$recommendation$, TRUE, NOW() - INTERVAL '1 day'),
  ('legacy', 3, NULL, 2, $profile${"nombre_segmento":"Cluster 2 - Clientes en Riesgo de Inactividad","tamano_sintetico":79,"porcentaje_sintetico":26.33,"centroide_sintetico":{"dias_desde_compra":123.85,"compras_12m":2.11,"gasto_12m_bs":349.97,"interacciones_30d":2.9}}$profile$::jsonb, $recommendation$Campana de reactivacion con cupon controlado y recordatorio de novedades en su talla.$recommendation$, TRUE, NOW() - INTERVAL '1 day');

-- Auditoría de fábrica y etiquetas de origen sintético para toda la demo legacy.
INSERT INTO public.auditoria_aprovisionamiento
  (tenant_id, tenant_slug, idempotency_key, request_hash, estado, respuesta_json, creado_en, actualizado_en)
VALUES
  ('legacy', 'legacy', 'FACTORY-BOOTSTRAP-0001', encode(digest('fashionstore factory bootstrap demo 2026', 'sha256'), 'hex'),
   'COMPLETADA', '{"tenant_slug":"legacy","origen":"seed_fabrica","es_sintetico":true,"cobro_real":false}'::jsonb,
   NOW(), NOW())
ON CONFLICT (tenant_slug, idempotency_key) DO NOTHING;

UPDATE public.usuarios SET es_sintetico = TRUE WHERE tenant_id = 'legacy';
UPDATE public.productos SET es_sintetico = TRUE WHERE tenant_id = 'legacy';
UPDATE public.variantes SET es_sintetico = TRUE WHERE tenant_id = 'legacy';
UPDATE public.stock SET es_sintetico = TRUE WHERE tenant_id = 'legacy';
UPDATE public.ventas SET es_sintetico = TRUE WHERE tenant_id = 'legacy';
UPDATE public.venta_items SET es_sintetico = TRUE WHERE tenant_id = 'legacy';
UPDATE public.movimientos_inventario SET es_sintetico = TRUE WHERE tenant_id = 'legacy';

-- Frontends detectan un reset de fábrica y descartan JWT, tenant y cachés de la corrida anterior.
INSERT INTO public.meta (clave, valor, actualizado_en)
VALUES ('factory_generation', gen_random_uuid()::text, NOW())
ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = EXCLUDED.actualizado_en;

COMMIT;
