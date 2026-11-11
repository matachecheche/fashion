import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Db } from '../common/db';
import { JwtTenantGuard, Roles } from '../common/auth';
import { TenantContext } from '../common/tenant-context';
import { InventarioCore } from '../common/inventario-core';
import { generarCodigo } from '../common/util';

@Controller('inventario')
@UseGuards(JwtTenantGuard)
export class InventarioController {
  @Roles('admin', 'encargado', 'cajero')
  @Get()
  async listarStock(@Query('sucursal_id') sucursalId?: string, @Query('almacen_id') almacenId?: string) {
    const tenant = TenantContext.require();
    return Db.query(
      `
      SELECT
        s.id AS stock_id,
        s.almacen_id,
        a.nombre AS almacen_nombre,
        a.sucursal_id,
        suc.nombre AS sucursal_nombre,
        v.id AS variante_id,
        v.sku,
        v.talla,
        v.color,
        p.id AS producto_id,
        p.codigo AS producto_codigo,
        p.nombre AS producto_nombre,
        p.tipo_prenda,
        s.cantidad,
        s.reservado,
        (s.cantidad - s.reservado) AS disponible,
        s.stock_minimo,
        s.ubicacion,
        s.actualizado_en
      FROM public.stock s
      JOIN public.almacenes a ON a.tenant_id = s.tenant_id AND a.id = s.almacen_id
      JOIN public.sucursales suc ON suc.tenant_id = a.tenant_id AND suc.id = a.sucursal_id
      JOIN public.variantes v ON v.tenant_id = s.tenant_id AND v.id = s.variante_id
      JOIN public.productos p ON p.tenant_id = v.tenant_id AND p.id = v.producto_id
      WHERE s.tenant_id = $1
        AND ($2::int IS NULL OR a.sucursal_id = $2::int)
        AND ($3::int IS NULL OR s.almacen_id = $3::int)
      ORDER BY suc.id ASC, p.nombre ASC, v.sku ASC
      `,
      [tenant.tenantId, sucursalId ? Number(sucursalId) : null, almacenId ? Number(almacenId) : null],
    );
  }

  @Roles('admin', 'encargado', 'cajero')
  @Get('alertas')
  async listarAlertasCriticas() {
    const tenant = TenantContext.require();
    return Db.query('SELECT * FROM public.inventario_critico WHERE tenant_id = $1 ORDER BY disponible ASC', [
      tenant.tenantId,
    ]);
  }

  @Roles('admin', 'encargado')
  @Get('movimientos')
  async listarMovimientos(@Query('limite') limite?: string) {
    const tenant = TenantContext.require();
    const lim = Math.min(250, Math.max(1, Number(limite || 100)));
    return Db.query(
      `
      SELECT
        m.*,
        a.nombre AS almacen_nombre,
        v.sku,
        v.talla,
        v.color,
        p.nombre AS producto_nombre,
        u.nombre AS usuario_nombre
      FROM public.movimientos_inventario m
      JOIN public.almacenes a ON a.tenant_id = m.tenant_id AND a.id = m.almacen_id
      JOIN public.variantes v ON v.tenant_id = m.tenant_id AND v.id = m.variante_id
      JOIN public.productos p ON p.tenant_id = v.tenant_id AND p.id = v.producto_id
      LEFT JOIN public.usuarios u ON u.tenant_id = m.tenant_id AND u.id = m.usuario_id
      WHERE m.tenant_id = $1
      ORDER BY m.id DESC
      LIMIT $2
      `,
      [tenant.tenantId, lim],
    );
  }

  @Roles('admin', 'encargado')
  @Post('movimientos')
  async registrarAjusteMovimiento(@Req() req: any, @Body() body: any) {
    const tenant = TenantContext.require();
    const almacenId = Number(body?.almacen_id);
    const varianteId = Number(body?.variante_id);
    const tipo = String(body?.tipo || 'entrada') as any;
    const cantidad = Number(body?.cantidad);

    if (!almacenId || !varianteId || isNaN(cantidad) || cantidad === 0) {
      throw new BadRequestException('almacen_id, variante_id y cantidad distinta de 0 son obligatorios.');
    }

    const delta = tipo === 'salida' ? -Math.abs(cantidad) : cantidad;
    return Db.tx(
      async (client) => {
        return InventarioCore.mover(client, {
          tenantId: tenant.tenantId,
          almacenId,
          varianteId,
          usuarioId: Number(req.user.sub),
          tipo: ['entrada', 'salida', 'ajuste'].includes(tipo) ? tipo : 'ajuste',
          deltaCantidad: delta,
          deltaReservado: 0,
          referencia: body?.referencia || generarCodigo('MOV'),
          motivo: String(body?.motivo || 'Ajuste manual de inventario'),
        });
      },
      { requireWrite: true },
    );
  }

  @Roles('admin', 'encargado')
  @Post('recepciones')
  async registrarRecepcionMercaderia(@Req() req: any, @Body() body: any) {
    const tenant = TenantContext.require();
    const almacenId = Number(body?.almacen_id);
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!almacenId || items.length === 0) {
      throw new BadRequestException('Debe indicar almacen_id y al menos un item en la recepcion.');
    }

    return Db.tx(
      async (client) => {
        const doc = String(body?.numero_documento || generarCodigo('REC'));
        let totalCosto = 0;
        for (const it of items) {
          totalCosto += Number(it.cantidad || 0) * Number(it.costo_unitario || 0);
        }

        const rRes = await client.query(
          `
          INSERT INTO public.recepciones (tenant_id, almacen_id, proveedor_id, usuario_id, numero_documento, estado, observaciones, total_costo)
          VALUES ($1, $2, $3, $4, $5, 'completada', $6, $7)
          RETURNING *
          `,
          [
            tenant.tenantId,
            almacenId,
            body?.proveedor_id ? Number(body.proveedor_id) : null,
            Number(req.user.sub),
            doc,
            String(body?.observaciones || 'Recepcion de lote'),
            totalCosto,
          ],
        );
        const recepcion = rRes.rows[0];

        for (const it of items) {
          const qty = Math.abs(Number(it.cantidad));
          await client.query(
            `
            INSERT INTO public.recepcion_items (tenant_id, recepcion_id, variante_id, cantidad, costo_unitario)
            VALUES ($1, $2, $3, $4, $5)
            `,
            [tenant.tenantId, recepcion.id, Number(it.variante_id), qty, Number(it.costo_unitario || 0)],
          );

          await InventarioCore.mover(client, {
            tenantId: tenant.tenantId,
            almacenId,
            varianteId: Number(it.variante_id),
            usuarioId: Number(req.user.sub),
            tipo: 'recepcion',
            deltaCantidad: qty,
            deltaReservado: 0,
            referencia: doc,
            motivo: `Recepcion documento ${doc}`,
          });
        }

        return recepcion;
      },
      { requireWrite: true },
    );
  }

  @Roles('admin', 'encargado')
  @Post('transferencias')
  async transferirEntreAlmacenes(@Req() req: any, @Body() body: any) {
    const tenant = TenantContext.require();
    const origenId = Number(body?.almacen_origen_id);
    const destinoId = Number(body?.almacen_destino_id);
    const varianteId = Number(body?.variante_id);
    const cantidad = Math.abs(Number(body?.cantidad || 0));

    if (!origenId || !destinoId || origenId === destinoId || !varianteId || cantidad <= 0) {
      throw new BadRequestException('Datos de transferencia entre almacenes invalidos.');
    }

    return Db.tx(
      async (client) => {
        const ref = generarCodigo('TRF');
        const salida = await InventarioCore.mover(client, {
          tenantId: tenant.tenantId,
          almacenId: origenId,
          varianteId,
          usuarioId: Number(req.user.sub),
          tipo: 'transferencia',
          deltaCantidad: -cantidad,
          deltaReservado: 0,
          referencia: ref,
          motivo: `Salida transferencia hacia almacen ${destinoId}`,
        });
        const entrada = await InventarioCore.mover(client, {
          tenantId: tenant.tenantId,
          almacenId: destinoId,
          varianteId,
          usuarioId: Number(req.user.sub),
          tipo: 'transferencia',
          deltaCantidad: cantidad,
          deltaReservado: 0,
          referencia: ref,
          motivo: `Entrada transferencia desde almacen ${origenId}`,
        });
        return { referencia: ref, origen: salida, destino: entrada };
      },
      { requireWrite: true },
    );
  }

  @Roles('admin', 'encargado')
  @Patch('stock')
  async actualizarConfigStock(@Body() body: any) {
    const tenant = TenantContext.require();
    const rows = await Db.query(
      `
      UPDATE public.stock
         SET stock_minimo = COALESCE($4, stock_minimo),
             ubicacion = COALESCE($5, ubicacion),
             actualizado_en = NOW()
       WHERE tenant_id = $1 AND almacen_id = $2 AND variante_id = $3
       RETURNING *
      `,
      [
        tenant.tenantId,
        Number(body?.almacen_id),
        Number(body?.variante_id),
        body?.stock_minimo !== undefined ? Number(body.stock_minimo) : null,
        body?.ubicacion ?? null,
      ],
      { requireWrite: true },
    );
    return rows[0];
  }
}

@Module({
  controllers: [InventarioController],
})
export class InventarioModule {}
