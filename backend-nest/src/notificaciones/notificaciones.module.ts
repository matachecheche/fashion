import { Controller, Get, Module, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { Db } from '../common/db';
import { JwtTenantGuard } from '../common/auth';
import { TenantContext } from '../common/tenant-context';

@Controller('notificaciones')
@UseGuards(JwtTenantGuard)
export class NotificacionesController {
  @Get()
  async listarNotificaciones(@Req() req: any) {
    const tenant = TenantContext.require();
    const esStaff = ['admin', 'encargado', 'cajero'].includes(req.user.rol);
    return Db.query(
      `
      SELECT *
        FROM public.notificaciones
       WHERE tenant_id = $1
         AND (usuario_id = $2 OR ($3::boolean = TRUE AND usuario_id IS NULL))
       ORDER BY id DESC
       LIMIT 50
      `,
      [tenant.tenantId, Number(req.user.sub), esStaff],
    );
  }

  @Patch(':id/leer')
  async marcarLeida(@Param('id') id: string, @Req() req: any) {
    const tenant = TenantContext.require();
    const rows = await Db.query(
      `
      UPDATE public.notificaciones
         SET leida = TRUE
       WHERE tenant_id = $1 AND id = $2
         AND (usuario_id = $3 OR usuario_id IS NULL)
       RETURNING *
      `,
      [tenant.tenantId, Number(id), Number(req.user.sub)],
    );
    return rows[0] || { ok: true };
  }

  @Patch('leer-todas')
  async marcarTodasLeidas(@Req() req: any) {
    const tenant = TenantContext.require();
    await Db.query(
      `
      UPDATE public.notificaciones
         SET leida = TRUE
       WHERE tenant_id = $1
         AND (usuario_id = $2 OR usuario_id IS NULL)
         AND leida = FALSE
      `,
      [tenant.tenantId, Number(req.user.sub)],
    );
    return { ok: true };
  }
}

@Module({
  controllers: [NotificacionesController],
})
export class NotificacionesModule {}
