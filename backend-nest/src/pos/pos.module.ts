import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Db } from '../common/db';
import { JwtTenantGuard, Roles } from '../common/auth';
import { TenantContext } from '../common/tenant-context';
import { redondearMoneda } from '../common/util';

@Controller('pos')
@UseGuards(JwtTenantGuard)
@Roles('admin', 'encargado', 'cajero')
export class PosController {
  @Get('caja-activa')
  async obtenerCajaActiva(@Req() req: any, @Query('sucursal_id') sucursalId?: string) {
    const tenant = TenantContext.require();
    const sucId = Number(sucursalId || req.user.sucursal_id || 1);
    const rows = await Db.query(
      `
      SELECT c.*, s.nombre AS sucursal_nombre, u.nombre AS usuario_apertura_nombre
        FROM public.cajas c
        JOIN public.sucursales s ON s.tenant_id = c.tenant_id AND s.id = c.sucursal_id
        JOIN public.usuarios u ON u.tenant_id = c.tenant_id AND u.id = c.usuario_apertura_id
       WHERE c.tenant_id = $1 AND c.sucursal_id = $2 AND c.estado = 'abierta'
       ORDER BY c.id DESC
       LIMIT 1
      `,
      [tenant.tenantId, sucId],
    );
    return rows[0] || null;
  }

  @Get('cajas')
  async listarCajas() {
    const tenant = TenantContext.require();
    return Db.query(
      `
      SELECT c.*, s.nombre AS sucursal_nombre, u.nombre AS usuario_apertura_nombre
        FROM public.cajas c
        JOIN public.sucursales s ON s.tenant_id = c.tenant_id AND s.id = c.sucursal_id
        JOIN public.usuarios u ON u.tenant_id = c.tenant_id AND u.id = c.usuario_apertura_id
       WHERE c.tenant_id = $1
       ORDER BY c.id DESC
       LIMIT 50
      `,
      [tenant.tenantId],
    );
  }

  @Post('abrir')
  async abrirCaja(@Req() req: any, @Body() body: any) {
    const tenant = TenantContext.require();
    const sucursalId = Number(body?.sucursal_id || req.user.sucursal_id || 1);
    const montoInicial = Math.max(0, Number(body?.monto_inicial ?? 0));

    return Db.tx(
      async (client) => {
        const abierta = await client.query(
          `SELECT id FROM public.cajas WHERE tenant_id = $1 AND sucursal_id = $2 AND estado = 'abierta' LIMIT 1`,
          [tenant.tenantId, sucursalId],
        );
        if (abierta.rowCount > 0) {
          throw new BadRequestException('Ya existe una caja abierta en esta sucursal.');
        }

        const ins = await client.query(
          `
          INSERT INTO public.cajas (tenant_id, sucursal_id, usuario_apertura_id, estado, monto_inicial, observaciones)
          VALUES ($1, $2, $3, 'abierta', $4, $5)
          RETURNING *
          `,
          [
            tenant.tenantId,
            sucursalId,
            Number(req.user.sub),
            montoInicial,
            String(body?.observaciones || 'Apertura de caja POS'),
          ],
        );
        return ins.rows[0];
      },
      { requireWrite: true },
    );
  }

  @Post(':id/cerrar')
  async cerrarCaja(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    const tenant = TenantContext.require();
    return Db.tx(
      async (client) => {
        const cRes = await client.query(
          'SELECT * FROM public.cajas WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
          [tenant.tenantId, Number(id)],
        );
        if (cRes.rowCount === 0) throw new NotFoundException('Caja no encontrada.');
        const caja = cRes.rows[0];
        if (caja.estado === 'cerrada') {
          throw new BadRequestException('La caja ya se encuentra cerrada.');
        }

        const esperadoEfectivo = redondearMoneda(
          Number(caja.monto_inicial) + Number(caja.monto_ventas_efectivo),
        );
        const declarado =
          body?.monto_cierre_declarado !== undefined
            ? redondearMoneda(Number(body.monto_cierre_declarado))
            : esperadoEfectivo;
        const diferencia = redondearMoneda(declarado - esperadoEfectivo);

        const upd = await client.query(
          `
          UPDATE public.cajas
             SET estado = 'cerrada',
                 usuario_cierre_id = $3,
                 monto_cierre_declarado = $4,
                 diferencia_arqueo = $5,
                 observaciones = COALESCE($6, observaciones),
                 cerrada_en = NOW()
           WHERE tenant_id = $1 AND id = $2
           RETURNING *
          `,
          [
            tenant.tenantId,
            caja.id,
            Number(req.user.sub),
            declarado,
            diferencia,
            body?.observaciones ? String(body.observaciones) : null,
          ],
        );
        return {
          ...upd.rows[0],
          arqueo: {
            efectivo_esperado: esperadoEfectivo,
            efectivo_declarado: declarado,
            diferencia,
            ventas_digitales: Number(caja.monto_ventas_digital),
          },
        };
      },
      { requireWrite: true },
    );
  }
}

@Module({
  controllers: [PosController],
})
export class PosModule {}
