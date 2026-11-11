import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Db } from '../common/db';
import { JwtTenantGuard, Roles } from '../common/auth';
import { TenantContext } from '../common/tenant-context';
import { normalizarSlug } from '../common/util';

@Controller('maestros')
export class MaestrosController {
  @Get('categorias')
  async listarCategorias() {
    const tenant = TenantContext.require();
    return Db.query('SELECT * FROM public.categorias WHERE tenant_id = $1 ORDER BY id ASC', [tenant.tenantId]);
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin', 'encargado')
  @Post('categorias')
  async crearCategoria(@Body() body: any) {
    const tenant = TenantContext.require();
    const nombre = String(body?.nombre || '').trim();
    if (!nombre) throw new BadRequestException('El nombre de categoria es obligatorio.');
    const slug = String(body?.slug || normalizarSlug(nombre));
    const tipoPrenda = String(body?.tipo_prenda || 'blusa').toLowerCase();
    const rows = await Db.query(
      `
      INSERT INTO public.categorias (tenant_id, nombre, slug, tipo_prenda, descripcion, activa)
      VALUES ($1, $2, $3, $4, $5, TRUE)
      RETURNING *
      `,
      [tenant.tenantId, nombre, slug, tipoPrenda, String(body?.descripcion || '')],
      { requireWrite: true },
    );
    return rows[0];
  }

  @Get('temporadas')
  async listarTemporadas() {
    const tenant = TenantContext.require();
    return Db.query('SELECT * FROM public.temporadas WHERE tenant_id = $1 ORDER BY anio DESC, id ASC', [tenant.tenantId]);
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin', 'encargado')
  @Post('temporadas')
  async crearTemporada(@Body() body: any) {
    const tenant = TenantContext.require();
    const nombre = String(body?.nombre || '').trim();
    if (!nombre) throw new BadRequestException('El nombre de temporada es obligatorio.');
    const rows = await Db.query(
      `
      INSERT INTO public.temporadas (tenant_id, nombre, anio, activa)
      VALUES ($1, $2, $3, TRUE)
      RETURNING *
      `,
      [tenant.tenantId, nombre, Number(body?.anio || 2026)],
      { requireWrite: true },
    );
    return rows[0];
  }

  @Get('colecciones')
  async listarColecciones() {
    const tenant = TenantContext.require();
    return Db.query('SELECT * FROM public.colecciones WHERE tenant_id = $1 ORDER BY id ASC', [tenant.tenantId]);
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin', 'encargado')
  @Post('colecciones')
  async crearColeccion(@Body() body: any) {
    const tenant = TenantContext.require();
    const nombre = String(body?.nombre || '').trim();
    if (!nombre) throw new BadRequestException('El nombre de coleccion es obligatorio.');
    const rows = await Db.query(
      `
      INSERT INTO public.colecciones (tenant_id, temporada_id, nombre, descripcion, destacada, activa)
      VALUES ($1, $2, $3, $4, $5, TRUE)
      RETURNING *
      `,
      [
        tenant.tenantId,
        body?.temporada_id ? Number(body.temporada_id) : null,
        nombre,
        String(body?.descripcion || ''),
        Boolean(body?.destacada ?? false),
      ],
      { requireWrite: true },
    );
    return rows[0];
  }

  @Get('sucursales')
  async listarSucursales() {
    const tenant = TenantContext.require();
    return Db.query(
      `
      SELECT s.*,
             COALESCE(
               JSON_AGG(JSONB_BUILD_OBJECT('id', a.id, 'codigo', a.codigo, 'nombre', a.nombre, 'es_principal', a.es_principal))
               FILTER (WHERE a.id IS NOT NULL),
               '[]'::json
             ) AS almacenes
        FROM public.sucursales s
        LEFT JOIN public.almacenes a ON a.tenant_id = s.tenant_id AND a.sucursal_id = s.id
       WHERE s.tenant_id = $1
       GROUP BY s.id
       ORDER BY s.id ASC
      `,
      [tenant.tenantId],
    );
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin')
  @Post('sucursales')
  async crearSucursal(@Body() body: any) {
    const tenant = TenantContext.require();
    const nombre = String(body?.nombre || '').trim();
    const direccion = String(body?.direccion || '').trim();
    if (!nombre || !direccion) {
      throw new BadRequestException('Nombre y direccion de la sucursal son obligatorios.');
    }
    return Db.tx(
      async (client) => {
        const codigo = String(body?.codigo || `SUC-${Date.now().toString().slice(-4)}`);
        const sRes = await client.query(
          `
          INSERT INTO public.sucursales (tenant_id, codigo, nombre, direccion, ciudad, telefono, horario, activa)
          VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
          RETURNING *
          `,
          [
            tenant.tenantId,
            codigo,
            nombre,
            direccion,
            String(body?.ciudad || 'Santa Cruz de la Sierra'),
            String(body?.telefono || ''),
            String(body?.horario || 'Lun-Sab 09:00-20:00'),
          ],
        );
        const suc = sRes.rows[0];
        const aRes = await client.query(
          `
          INSERT INTO public.almacenes (tenant_id, sucursal_id, codigo, nombre, es_principal, activo)
          VALUES ($1, $2, $3, $4, TRUE, TRUE)
          RETURNING *
          `,
          [tenant.tenantId, suc.id, `ALM-${suc.id}`, `Almacen ${nombre}`],
        );
        return { ...suc, almacen_principal: aRes.rows[0] };
      },
      { requireWrite: true },
    );
  }

  @Get('almacenes')
  async listarAlmacenes() {
    const tenant = TenantContext.require();
    return Db.query(
      `
      SELECT a.*, s.nombre AS sucursal_nombre
        FROM public.almacenes a
        JOIN public.sucursales s ON s.tenant_id = a.tenant_id AND s.id = a.sucursal_id
       WHERE a.tenant_id = $1
       ORDER BY a.id ASC
      `,
      [tenant.tenantId],
    );
  }

  @Get('promociones')
  async listarPromociones() {
    const tenant = TenantContext.require();
    return Db.query('SELECT * FROM public.promociones WHERE tenant_id = $1 ORDER BY id DESC', [tenant.tenantId]);
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin', 'encargado')
  @Post('promociones')
  async crearPromocion(@Body() body: any) {
    const tenant = TenantContext.require();
    const codigo = String(body?.codigo || '').trim().toUpperCase();
    const nombre = String(body?.nombre || '').trim();
    const valor = Number(body?.valor ?? 0);
    if (!codigo || !nombre || valor <= 0) {
      throw new BadRequestException('Codigo, nombre y valor positivo son obligatorios.');
    }
    const rows = await Db.query(
      `
      INSERT INTO public.promociones (tenant_id, codigo, nombre, descripcion, tipo_descuento, valor, minimo_compra, activa)
      VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
      RETURNING *
      `,
      [
        tenant.tenantId,
        codigo,
        nombre,
        String(body?.descripcion || ''),
        body?.tipo_descuento === 'monto_fijo' ? 'monto_fijo' : 'porcentaje',
        valor,
        Number(body?.minimo_compra || 0),
      ],
      { requireWrite: true },
    );
    return rows[0];
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin', 'encargado')
  @Get('proveedores')
  async listarProveedores() {
    const tenant = TenantContext.require();
    return Db.query('SELECT * FROM public.proveedores WHERE tenant_id = $1 ORDER BY id ASC', [tenant.tenantId]);
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin', 'encargado')
  @Post('proveedores')
  async crearProveedor(@Body() body: any) {
    const tenant = TenantContext.require();
    const razonSocial = String(body?.razon_social || '').trim();
    if (!razonSocial) throw new BadRequestException('La razon social es obligatoria.');
    const rows = await Db.query(
      `
      INSERT INTO public.proveedores (tenant_id, razon_social, nit, contacto, telefono, email, direccion, activo)
      VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
      RETURNING *
      `,
      [
        tenant.tenantId,
        razonSocial,
        String(body?.nit || ''),
        String(body?.contacto || ''),
        String(body?.telefono || ''),
        String(body?.email || ''),
        String(body?.direccion || ''),
      ],
      { requireWrite: true },
    );
    return rows[0];
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin', 'encargado')
  @Patch('sucursales/:id')
  async actualizarSucursal(@Param('id') id: string, @Body() body: any) {
    const tenant = TenantContext.require();
    const rows = await Db.query(
      `
      UPDATE public.sucursales
         SET nombre = COALESCE($3, nombre),
             direccion = COALESCE($4, direccion),
             telefono = COALESCE($5, telefono),
             horario = COALESCE($6, horario),
             activa = COALESCE($7, activa)
       WHERE tenant_id = $1 AND id = $2
       RETURNING *
      `,
      [
        tenant.tenantId,
        Number(id),
        body?.nombre ?? null,
        body?.direccion ?? null,
        body?.telefono ?? null,
        body?.horario ?? null,
        body?.activa !== undefined ? Boolean(body.activa) : null,
      ],
      { requireWrite: true },
    );
    return rows[0];
  }
}

@Module({
  controllers: [MaestrosController],
})
export class MaestrosModule {}
