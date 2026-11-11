import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Db } from '../common/db';
import { JwtTenantGuard, Roles } from '../common/auth';
import { TenantContext } from '../common/tenant-context';
import { generarCodigo } from '../common/util';

@Controller('catalogo')
export class CatalogoController {
  @Get('filtros')
  async obtenerFiltros() {
    const tenant = TenantContext.require();
    return Db.tx(async (client) => {
      const [categorias, temporadas, colecciones, sucursales, tallas, colores] = await Promise.all([
        client.query('SELECT id, nombre, slug, tipo_prenda FROM public.categorias WHERE tenant_id = $1 AND activa = TRUE ORDER BY nombre', [tenant.tenantId]),
        client.query('SELECT id, nombre, anio FROM public.temporadas WHERE tenant_id = $1 AND activa = TRUE ORDER BY anio DESC, nombre', [tenant.tenantId]),
        client.query('SELECT id, nombre, temporada_id, destacada FROM public.colecciones WHERE tenant_id = $1 AND activa = TRUE ORDER BY nombre', [tenant.tenantId]),
        client.query('SELECT id, codigo, nombre, direccion, ciudad, horario FROM public.sucursales WHERE tenant_id = $1 AND activa = TRUE ORDER BY id', [tenant.tenantId]),
        client.query('SELECT DISTINCT talla FROM public.variantes WHERE tenant_id = $1 AND activa = TRUE ORDER BY talla', [tenant.tenantId]),
        client.query('SELECT DISTINCT color, color_hex FROM public.variantes WHERE tenant_id = $1 AND activa = TRUE ORDER BY color', [tenant.tenantId]),
      ]);

      return {
        tenant_slug: tenant.tenantSlug,
        categorias: categorias.rows,
        temporadas: temporadas.rows,
        colecciones: colecciones.rows,
        sucursales: sucursales.rows,
        tallas: tallas.rows.map((r) => r.talla),
        colores: colores.rows,
      };
    });
  }

  @Get('productos')
  async listarProductos(
    @Query('q') q?: string,
    @Query('categoria_id') categoriaId?: string,
    @Query('temporada_id') temporadaId?: string,
    @Query('tipo_prenda') tipoPrenda?: string,
    @Query('talla') talla?: string,
    @Query('color') color?: string,
    @Query('sucursal_id') sucursalId?: string,
  ) {
    const tenant = TenantContext.require();
    return Db.tx(async (client) => {
      const res = await client.query(
        `
        SELECT
          p.id,
          p.codigo,
          p.nombre,
          p.descripcion,
          p.categoria_id,
          c.nombre AS categoria_nombre,
          p.temporada_id,
          t.nombre AS temporada_nombre,
          p.coleccion_id,
          col.nombre AS coleccion_nombre,
          p.tipo_prenda,
          p.genero,
          p.material,
          p.precio_base::FLOAT AS precio_base,
          p.costo_base::FLOAT AS costo_base,
          p.imagen_url,
          p.ar_overlay_url,
          p.ar_config_json,
          p.destacado,
          p.activo,
          COALESCE(
            JSON_AGG(
              DISTINCT JSONB_BUILD_OBJECT(
                'id', v.id,
                'sku', v.sku,
                'talla', v.talla,
                'color', v.color,
                'color_hex', v.color_hex,
                'precio_adicional', v.precio_adicional,
                'foto_url', COALESCE(v.foto_url, p.imagen_url),
                'ar_url', COALESCE(v.ar_url, p.ar_overlay_url)
              )
            ) FILTER (WHERE v.id IS NOT NULL),
            '[]'::json
          ) AS variantes,
          COALESCE(SUM(
            CASE
              WHEN $8::int IS NULL OR a.sucursal_id = $8::int THEN (s.cantidad - s.reservado)
              ELSE 0
            END
          ), 0)::INT AS stock_disponible
        FROM public.productos p
        JOIN public.categorias c ON c.tenant_id = p.tenant_id AND c.id = p.categoria_id
        LEFT JOIN public.temporadas t ON t.tenant_id = p.tenant_id AND t.id = p.temporada_id
        LEFT JOIN public.colecciones col ON col.tenant_id = p.tenant_id AND col.id = p.coleccion_id
        LEFT JOIN public.variantes v ON v.tenant_id = p.tenant_id AND v.producto_id = p.id AND v.activa = TRUE
        LEFT JOIN public.stock s ON s.tenant_id = v.tenant_id AND s.variante_id = v.id
        LEFT JOIN public.almacenes a ON a.tenant_id = s.tenant_id AND a.id = s.almacen_id
        WHERE p.tenant_id = $1
          AND p.activo = TRUE
          AND ($2::text IS NULL OR p.nombre ILIKE '%' || $2 || '%' OR p.descripcion ILIKE '%' || $2 || '%')
          AND ($3::int IS NULL OR p.categoria_id = $3::int)
          AND ($4::int IS NULL OR p.temporada_id = $4::int)
          AND ($5::text IS NULL OR p.tipo_prenda = LOWER($5))
          AND ($6::text IS NULL OR EXISTS (
            SELECT 1 FROM public.variantes vt
            WHERE vt.tenant_id = p.tenant_id AND vt.producto_id = p.id AND LOWER(vt.talla) = LOWER($6)
          ))
          AND ($7::text IS NULL OR EXISTS (
            SELECT 1 FROM public.variantes vc
            WHERE vc.tenant_id = p.tenant_id AND vc.producto_id = p.id AND LOWER(vc.color) = LOWER($7)
          ))
        GROUP BY p.id, c.nombre, t.nombre, col.nombre
        ORDER BY p.destacado DESC, p.id ASC
        `,
        [
          tenant.tenantId,
          q ? q.trim() : null,
          categoriaId ? Number(categoriaId) : null,
          temporadaId ? Number(temporadaId) : null,
          tipoPrenda ? tipoPrenda.trim() : null,
          talla ? talla.trim() : null,
          color ? color.trim() : null,
          sucursalId ? Number(sucursalId) : null,
        ],
      );
      return res.rows;
    });
  }

  @Get('productos/:id')
  async obtenerProducto(@Param('id') id: string) {
    const tenant = TenantContext.require();
    return Db.tx(async (client) => {
      const prodRes = await client.query(
        `
        SELECT p.*, c.nombre AS categoria_nombre, t.nombre AS temporada_nombre, col.nombre AS coleccion_nombre
          FROM public.productos p
          JOIN public.categorias c ON c.tenant_id = p.tenant_id AND c.id = p.categoria_id
          LEFT JOIN public.temporadas t ON t.tenant_id = p.tenant_id AND t.id = p.temporada_id
          LEFT JOIN public.colecciones col ON col.tenant_id = p.tenant_id AND col.id = p.coleccion_id
         WHERE p.tenant_id = $1 AND p.id = $2
         LIMIT 1
        `,
        [tenant.tenantId, Number(id)],
      );
      if (prodRes.rowCount === 0) {
        throw new NotFoundException('Producto no encontrado en esta tienda.');
      }

      const [variantesRes, disponibilidadRes, imagenesRes] = await Promise.all([
        client.query(
          `
          SELECT v.*, COALESCE(SUM(s.cantidad - s.reservado), 0)::INT AS disponible_total
            FROM public.variantes v
            LEFT JOIN public.stock s ON s.tenant_id = v.tenant_id AND s.variante_id = v.id
           WHERE v.tenant_id = $1 AND v.producto_id = $2 AND v.activa = TRUE
           GROUP BY v.id
           ORDER BY v.id ASC
          `,
          [tenant.tenantId, Number(id)],
        ),
        client.query(
          `
          SELECT * FROM public.disponibilidad_sucursal
           WHERE tenant_id = $1 AND producto_id = $2
           ORDER BY sucursal_id ASC, variante_id ASC
          `,
          [tenant.tenantId, Number(id)],
        ),
        client.query(
          `
          SELECT * FROM public.producto_imagenes
           WHERE tenant_id = $1 AND producto_id = $2
           ORDER BY orden ASC
          `,
          [tenant.tenantId, Number(id)],
        ),
      ]);

      return {
        ...prodRes.rows[0],
        precio_base: Number(prodRes.rows[0].precio_base),
        variantes: variantesRes.rows,
        disponibilidad_sucursales: disponibilidadRes.rows,
        imagenes: imagenesRes.rows,
      };
    });
  }

  @Get('disponibilidad')
  async consultarDisponibilidad(
    @Query('producto_id') productoId?: string,
    @Query('sucursal_id') sucursalId?: string,
  ) {
    const tenant = TenantContext.require();
    return Db.query(
      `
      SELECT *
        FROM public.disponibilidad_sucursal
       WHERE tenant_id = $1
         AND ($2::int IS NULL OR producto_id = $2::int)
         AND ($3::int IS NULL OR sucursal_id = $3::int)
       ORDER BY sucursal_id ASC, producto_id ASC, variante_id ASC
      `,
      [
        tenant.tenantId,
        productoId ? Number(productoId) : null,
        sucursalId ? Number(sucursalId) : null,
      ],
    );
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin', 'encargado')
  @Post('productos')
  async crearProducto(@Body() body: any) {
    const tenant = TenantContext.require();
    const nombre = String(body?.nombre || '').trim();
    const categoriaId = Number(body?.categoria_id);
    const tipoPrenda = String(body?.tipo_prenda || 'blusa').trim().toLowerCase();
    const colorDefault = String(body?.color_inicial || 'azul').trim().toLowerCase();
    const precioBase = Number(body?.precio_base ?? 150);

    if (!nombre || !categoriaId || isNaN(precioBase) || precioBase < 0) {
      throw new BadRequestException('Nombre, categoria_id y precio_base valido son obligatorios.');
    }

    const imagenUrl = body?.imagen_url || `/assets/prendas/${tipoPrenda}-${colorDefault}-foto.jpg`;
    const arOverlayUrl = body?.ar_overlay_url || `/assets/prendas/${tipoPrenda}-${colorDefault}-ar.png`;
    const codigo = String(body?.codigo || generarCodigo('PRD')).trim();

    return Db.tx(
      async (client) => {
        const prodRes = await client.query(
          `
          INSERT INTO public.productos (
            tenant_id, codigo, nombre, descripcion, categoria_id, temporada_id, coleccion_id,
            proveedor_id, tipo_prenda, genero, material, precio_base, costo_base,
            imagen_url, ar_overlay_url, destacado, activo
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, TRUE)
          RETURNING *
          `,
          [
            tenant.tenantId,
            codigo,
            nombre,
            String(body?.descripcion || ''),
            categoriaId,
            body?.temporada_id ? Number(body.temporada_id) : null,
            body?.coleccion_id ? Number(body.coleccion_id) : null,
            body?.proveedor_id ? Number(body.proveedor_id) : null,
            tipoPrenda,
            String(body?.genero || 'femenino'),
            String(body?.material || 'Algodon Premium'),
            precioBase,
            Number(body?.costo_base ?? precioBase * 0.5),
            imagenUrl,
            arOverlayUrl,
            Boolean(body?.destacado ?? false),
          ],
        );
        const prod = prodRes.rows[0];

        // Si se enviaron variantes iniciales o crear una por defecto
        const variantesInput = Array.isArray(body?.variantes) && body.variantes.length > 0
          ? body.variantes
          : [
              {
                sku: `${codigo}-${colorDefault.toUpperCase()}-M`,
                talla: String(body?.talla_inicial || 'M'),
                color: colorDefault,
                color_hex: '#1C3F94',
                stock_inicial: Number(body?.stock_inicial ?? 10),
              },
            ];

        const almRes = await client.query(
          'SELECT id FROM public.almacenes WHERE tenant_id = $1 AND activo = TRUE ORDER BY es_principal DESC, id ASC LIMIT 1',
          [tenant.tenantId],
        );
        const almacenId = almRes.rows[0]?.id;

        const variantesCreadas = [];
        for (const v of variantesInput) {
          const vColor = String(v.color || colorDefault).toLowerCase();
          const vRes = await client.query(
            `
            INSERT INTO public.variantes (
              tenant_id, producto_id, sku, talla, color, color_hex, precio_adicional, foto_url, ar_url, activa
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
            RETURNING *
            `,
            [
              tenant.tenantId,
              prod.id,
              String(v.sku || generarCodigo('SKU')),
              String(v.talla || 'M'),
              vColor,
              String(v.color_hex || '#1C3F94'),
              Number(v.precio_adicional || 0),
              v.foto_url || `/assets/prendas/${tipoPrenda}-${vColor}-foto.jpg`,
              v.ar_url || `/assets/prendas/${tipoPrenda}-${vColor}-ar.png`,
            ],
          );
          const variante = vRes.rows[0];
          variantesCreadas.push(variante);

          if (almacenId && Number(v.stock_inicial ?? 0) >= 0) {
            await client.query(
              `
              INSERT INTO public.stock (tenant_id, almacen_id, variante_id, cantidad, reservado, stock_minimo)
              VALUES ($1, $2, $3, $4, 0, 3)
              ON CONFLICT (almacen_id, variante_id) DO UPDATE SET cantidad = EXCLUDED.cantidad
              `,
              [tenant.tenantId, almacenId, variante.id, Number(v.stock_inicial ?? 10)],
            );
          }
        }

        return { ...prod, variantes: variantesCreadas };
      },
      { requireWrite: true },
    );
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin', 'encargado')
  @Patch('productos/:id')
  async actualizarProducto(@Param('id') id: string, @Body() body: any) {
    const tenant = TenantContext.require();
    return Db.tx(
      async (client) => {
        const res = await client.query(
          `
          UPDATE public.productos
             SET nombre = COALESCE($3, nombre),
                 descripcion = COALESCE($4, descripcion),
                 precio_base = COALESCE($5, precio_base),
                 categoria_id = COALESCE($6, categoria_id),
                 destacado = COALESCE($7, destacado),
                 activo = COALESCE($8, activo),
                 actualizado_en = NOW()
           WHERE tenant_id = $1 AND id = $2
           RETURNING *
          `,
          [
            tenant.tenantId,
            Number(id),
            body?.nombre ?? null,
            body?.descripcion ?? null,
            body?.precio_base !== undefined ? Number(body.precio_base) : null,
            body?.categoria_id !== undefined ? Number(body.categoria_id) : null,
            body?.destacado !== undefined ? Boolean(body.destacado) : null,
            body?.activo !== undefined ? Boolean(body.activo) : null,
          ],
        );
        if (res.rowCount === 0) {
          throw new NotFoundException('Producto no encontrado.');
        }
        return res.rows[0];
      },
      { requireWrite: true },
    );
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin', 'encargado')
  @Delete('productos/:id')
  async desactivarProducto(@Param('id') id: string) {
    const tenant = TenantContext.require();
    return Db.tx(
      async (client) => {
        const res = await client.query(
          'UPDATE public.productos SET activo = FALSE, actualizado_en = NOW() WHERE tenant_id = $1 AND id = $2 RETURNING id, activo',
          [tenant.tenantId, Number(id)],
        );
        if (res.rowCount === 0) {
          throw new NotFoundException('Producto no encontrado.');
        }
        return res.rows[0];
      },
      { requireWrite: true },
    );
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin', 'encargado')
  @Post('productos/:id/variantes')
  async crearVariante(@Param('id') id: string, @Body() body: any) {
    const tenant = TenantContext.require();
    return Db.tx(
      async (client) => {
        const pRes = await client.query(
          'SELECT id, tipo_prenda FROM public.productos WHERE tenant_id = $1 AND id = $2',
          [tenant.tenantId, Number(id)],
        );
        if (pRes.rowCount === 0) {
          throw new NotFoundException('Producto padre no encontrado en esta tienda.');
        }
        const tipo = pRes.rows[0].tipo_prenda;
        const color = String(body?.color || 'azul').toLowerCase();
        const vRes = await client.query(
          `
          INSERT INTO public.variantes (
            tenant_id, producto_id, sku, talla, color, color_hex, precio_adicional, foto_url, ar_url, activa
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
          RETURNING *
          `,
          [
            tenant.tenantId,
            Number(id),
            String(body?.sku || generarCodigo('VAR')),
            String(body?.talla || 'M'),
            color,
            String(body?.color_hex || '#1C3F94'),
            Number(body?.precio_adicional || 0),
            body?.foto_url || `/assets/prendas/${tipo}-${color}-foto.jpg`,
            body?.ar_url || `/assets/prendas/${tipo}-${color}-ar.png`,
          ],
        );
        return vRes.rows[0];
      },
      { requireWrite: true },
    );
  }
}

@Module({
  controllers: [CatalogoController],
})
export class CatalogoModule {}
