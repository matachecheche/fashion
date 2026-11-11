import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Db } from '../common/db';
import { JwtTenantGuard, Roles } from '../common/auth';
import { TenantContext } from '../common/tenant-context';
import { generarCodigo } from '../common/util';

@Controller('propuestas')
@UseGuards(JwtTenantGuard)
export class PropuestasController {
  @Roles('admin', 'encargado', 'proveedor')
  @Get()
  async listarPropuestas(@Req() req: any) {
    const tenant = TenantContext.require();
    const filtroProv = req.user.rol === 'proveedor' && req.user.proveedor_id ? Number(req.user.proveedor_id) : null;
    return Db.query(
      `
      SELECT pr.*, pv.razon_social AS proveedor_nombre
        FROM public.propuestas_producto pr
        JOIN public.proveedores pv ON pv.tenant_id = pr.tenant_id AND pv.id = pr.proveedor_id
       WHERE pr.tenant_id = $1
         AND ($2::int IS NULL OR pr.proveedor_id = $2::int)
       ORDER BY pr.id DESC
      `,
      [tenant.tenantId, filtroProv],
    );
  }

  @Roles('admin', 'encargado', 'proveedor')
  @Post()
  async crearPropuesta(@Req() req: any, @Body() body: any) {
    const tenant = TenantContext.require();
    const nombre = String(body?.nombre || '').trim();
    if (!nombre) throw new BadRequestException('El nombre de la prenda propuesta es obligatorio.');

    return Db.tx(
      async (client) => {
        let proveedorId = Number(body?.proveedor_id || req.user.proveedor_id || 0);
        if (!proveedorId) {
          const pRes = await client.query(
            'SELECT id FROM public.proveedores WHERE tenant_id = $1 ORDER BY id ASC LIMIT 1',
            [tenant.tenantId],
          );
          if (pRes.rowCount === 0) {
            const nuevoP = await client.query(
              `INSERT INTO public.proveedores (tenant_id, razon_social, activo) VALUES ($1, 'Proveedor General', TRUE) RETURNING id`,
              [tenant.tenantId],
            );
            proveedorId = Number(nuevoP.rows[0].id);
          } else {
            proveedorId = Number(pRes.rows[0].id);
          }
        }

        const ins = await client.query(
          `
          INSERT INTO public.propuestas_producto (
            tenant_id, proveedor_id, usuario_id, nombre, tipo_prenda, color,
            tallas_sugeridas, costo_propuesto, precio_sugerido, cantidad_disponible, descripcion, estado
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pendiente')
          RETURNING *
          `,
          [
            tenant.tenantId,
            proveedorId,
            Number(req.user.sub),
            nombre,
            String(body?.tipo_prenda || 'blusa').toLowerCase(),
            String(body?.color || 'azul').toLowerCase(),
            String(body?.tallas_sugeridas || 'S,M,L'),
            Number(body?.costo_propuesto || 80),
            Number(body?.precio_sugerido || 160),
            Math.max(1, Number(body?.cantidad_disponible || 20)),
            String(body?.descripcion || ''),
          ],
        );
        return ins.rows[0];
      },
      { requireWrite: true },
    );
  }

  @Roles('admin', 'encargado')
  @Post(':id/aprobar')
  async aprobarPropuesta(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    const tenant = TenantContext.require();
    return Db.tx(
      async (client) => {
        const pRes = await client.query(
          'SELECT * FROM public.propuestas_producto WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
          [tenant.tenantId, Number(id)],
        );
        if (pRes.rowCount === 0) throw new NotFoundException('Propuesta no encontrada.');
        const prop = pRes.rows[0];

        const catRes = await client.query(
          'SELECT id FROM public.categorias WHERE tenant_id = $1 ORDER BY id ASC LIMIT 1',
          [tenant.tenantId],
        );
        const categoriaId = catRes.rows[0]?.id || 1;
        const codigo = generarCodigo('PRD');
        const tipo = String(prop.tipo_prenda || 'blusa').toLowerCase();
        const color = String(prop.color || 'azul').toLowerCase();

        const prodIns = await client.query(
          `
          INSERT INTO public.productos (
            tenant_id, codigo, nombre, descripcion, categoria_id, proveedor_id,
            tipo_prenda, precio_base, costo_base, imagen_url, ar_overlay_url, activo
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE)
          RETURNING *
          `,
          [
            tenant.tenantId,
            codigo,
            prop.nombre,
            prop.descripcion || '',
            categoriaId,
            prop.proveedor_id,
            tipo,
            Number(prop.precio_sugerido),
            Number(prop.costo_propuesto),
            `/assets/prendas/${tipo}-${color}-foto.jpg`,
            `/assets/prendas/${tipo}-${color}-ar.png`,
          ],
        );
        const producto = prodIns.rows[0];

        const upd = await client.query(
          `
          UPDATE public.propuestas_producto
             SET estado = 'aprobada',
                 comentario_revision = $3,
                 revisado_por_id = $4,
                 actualizado_en = NOW()
           WHERE tenant_id = $1 AND id = $2
           RETURNING *
          `,
          [
            tenant.tenantId,
            prop.id,
            String(body?.comentario || 'Propuesta aprobada e incorporada al catalogo'),
            Number(req.user.sub),
          ],
        );

        return { propuesta: upd.rows[0], producto_creado: producto };
      },
      { requireWrite: true },
    );
  }

  @Roles('admin', 'encargado')
  @Post(':id/rechazar')
  async rechazarPropuesta(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    const tenant = TenantContext.require();
    const rows = await Db.query(
      `
      UPDATE public.propuestas_producto
         SET estado = 'rechazada',
             comentario_revision = $3,
             revisado_por_id = $4,
             actualizado_en = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *
      `,
      [
        tenant.tenantId,
        Number(id),
        String(body?.comentario || 'No se ajusta a la temporada actual'),
        Number(req.user.sub),
      ],
      { requireWrite: true },
    );
    if (rows.length === 0) throw new NotFoundException('Propuesta no encontrada.');
    return rows[0];
  }
}

@Module({
  controllers: [PropuestasController],
})
export class PropuestasModule {}
