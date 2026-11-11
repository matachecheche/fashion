import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Db } from '../common/db';
import { JwtTenantGuard, Roles } from '../common/auth';
import { TenantContext } from '../common/tenant-context';

@Controller('suscripcion')
export class SuscripcionController {
  @Get('planes')
  async listarPlanes() {
    const planes = await Db.query('SELECT * FROM public.planes_suscripcion ORDER BY precio_mensual_bs ASC');
    return {
      modo_facturacion: 'sandbox',
      cobro_real_activo: false,
      aviso: 'Los planes SaaS operan en modo sandbox/solicitud comercial. No se realizan cobros automaticos a tarjetas.',
      planes: planes.map((p) => ({
        ...p,
        precio_mensual_bob: Number(p.precio_mensual_bs),
        precio_mensual_bs: Number(p.precio_mensual_bs),
      })),
    };
  }

  @Get('estado')
  async obtenerEstadoSuscripcion() {
    const tenant = TenantContext.require();
    return Db.tx(async (client) => {
      const tRes = await client.query(
        `
        SELECT t.*,
               pl.nombre AS plan_nombre,
               pl.precio_mensual_bs,
               pl.duracion_dias,
               GREATEST(0, CEIL(EXTRACT(EPOCH FROM (COALESCE(t.demo_vence_en, NOW()) - NOW())) / 86400.0))::int AS dias_restantes_trial
          FROM public.tenants t
          LEFT JOIN public.planes_suscripcion pl ON pl.codigo = t.plan
         WHERE t.id = $1
        `,
        [tenant.tenantId],
      );
      const uRes = await client.query(
        `SELECT COUNT(*)::int AS total FROM public.usuarios WHERE tenant_id = $1`,
        [tenant.tenantId],
      );
      const sRes = await client.query(
        `SELECT COUNT(*)::int AS total FROM public.sucursales WHERE tenant_id = $1`,
        [tenant.tenantId],
      );
      const pRes = await client.query(
        `SELECT COUNT(*)::int AS total FROM public.productos WHERE tenant_id = $1`,
        [tenant.tenantId],
      );
      const solRes = await client.query(
        `SELECT * FROM public.solicitudes_suscripcion WHERE tenant_id = $1 ORDER BY id DESC LIMIT 10`,
        [tenant.tenantId],
      );

      const t = tRes.rows[0];
      const demoVenceMs = t?.demo_vence_en ? new Date(t.demo_vence_en).getTime() : null;
      const trialExpirado =
        t?.estado !== 'activo' ||
        (['demo', 'trial'].includes(String(t?.plan)) && demoVenceMs !== null && demoVenceMs <= Date.now());

      const maxUsuarios = Number(t?.max_usuarios ?? 5);
      const maxSucursales = Number(t?.max_sucursales ?? 2);
      const maxProductos = Number(t?.max_productos ?? 500);
      const planActual = String(t?.plan || tenant.plan);
      const esTrial = ['demo', 'trial'].includes(planActual);

      const usoUsuarios = Number(uRes.rows[0]?.total ?? 0);
      const usoSucursales = Number(sRes.rows[0]?.total ?? 0);
      const usoProductos = Number(pRes.rows[0]?.total ?? 0);

      return {
        tenant_id: tenant.tenantId,
        tenant_slug: tenant.tenantSlug,
        tienda_nombre: tenant.nombre,
        plan_actual: planActual,
        plan_nombre: t?.plan_nombre || 'Trial gratuito de 14 días',
        precio_mensual_bob: Number(t?.precio_mensual_bs ?? 0),
        estado: trialExpirado ? 'solo_lectura' : t?.estado || 'activo',
        solo_lectura: Boolean(trialExpirado),
        modo_facturacion: 'sandbox',
        cobro_real_activo: false,
        demo_inicia_en: esTrial ? t?.demo_inicia_en : null,
        demo_vence_en: esTrial ? t?.demo_vence_en : null,
        dias_restantes: esTrial ? (trialExpirado ? 0 : Number(t?.dias_restantes_trial ?? 14)) : null,
        cuotas: {
          usuarios: {
            usado: usoUsuarios,
            maximo: maxUsuarios,
            disponible: Math.max(0, maxUsuarios - usoUsuarios),
            porcentaje: Math.min(100, Math.round((usoUsuarios / Math.max(1, maxUsuarios)) * 100)),
          },
          sucursales: {
            usado: usoSucursales,
            maximo: maxSucursales,
            disponible: Math.max(0, maxSucursales - usoSucursales),
            porcentaje: Math.min(100, Math.round((usoSucursales / Math.max(1, maxSucursales)) * 100)),
          },
          productos: {
            usado: usoProductos,
            maximo: maxProductos,
            disponible: maxProductos < 0 ? -1 : Math.max(0, maxProductos - usoProductos),
            porcentaje: maxProductos < 0 ? 0 : Math.min(100, Math.round((usoProductos / Math.max(1, maxProductos)) * 100)),
            ilimitado: maxProductos < 0,
          },
        },
        solicitudes_recientes: solRes.rows,
      };
    });
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin')
  @Post('cambio')
  async solicitarCambioPlan(@Req() req: any, @Body() body: any) {
    const tenant = TenantContext.require();
    const planSolicitado = String(body?.plan_solicitado || body?.plan || '').trim().toLowerCase();
    const aplicarSandboxInmediato = Boolean(body?.aplicar_sandbox ?? false);

    if (!['demo', 'trial', 'basico', 'profesional', 'empresarial'].includes(planSolicitado)) {
      throw new BadRequestException(
        'Plan solicitado inválido. Opciones válidas: trial, basico, profesional, empresarial.',
      );
    }

    return Db.tx(
      async (client) => {
        const plRes = await client.query(
          'SELECT * FROM public.planes_suscripcion WHERE codigo = $1 LIMIT 1',
          [planSolicitado],
        );
        const planInfo = plRes.rows[0];

        const estadoSolicitud = aplicarSandboxInmediato ? 'aprobada_sandbox' : 'pendiente_aprobacion';
        const ins = await client.query(
          `
          INSERT INTO public.solicitudes_suscripcion (
            tenant_id, usuario_id, plan_actual, plan_solicitado, estado, cobro_real, notas
          )
          VALUES ($1, $2, $3, $4, $5, FALSE, $6)
          RETURNING *
          `,
          [
            tenant.tenantId,
            Number(req.user.sub),
            tenant.plan,
            planSolicitado,
            estadoSolicitud,
            String(
              body?.notas ||
                'Solicitud registrada en entorno Sandbox (sin cargo real a tarjeta de credito).',
            ),
          ],
        );

        if (aplicarSandboxInmediato && planInfo) {
          await client.query(
            `
            UPDATE public.tenants
               SET plan = $2::varchar,
                   estado = 'activo',
                   max_usuarios = $3::int,
                   max_sucursales = $4::int,
                   max_productos = $5::int,
                   demo_vence_en = CASE
                     WHEN $2::varchar IN ('demo', 'trial') THEN NOW() + INTERVAL '14 days'
                     ELSE NOW() + INTERVAL '365 days'
                   END,
                   actualizado_en = NOW()
             WHERE id = $1
            `,
            [
              tenant.tenantId,
              planSolicitado,
              Number(planInfo.max_usuarios),
              Number(planInfo.max_sucursales),
              Number(planInfo.max_productos),
            ],
          );
          await client.query(
            `INSERT INTO public.suscripciones (
               tenant_id, plan_codigo, estado, inicio, vence_en, modo_cobro, metadata_json
             ) VALUES (
               $1, $2, 'activa', NOW(),
               CASE WHEN $2::varchar IN ('demo', 'trial') THEN NOW() + INTERVAL '14 days' ELSE NULL END,
               'prueba', '{"sandbox":true,"cobro_real":false}'::jsonb
             )
             ON CONFLICT (tenant_id) DO UPDATE SET
               plan_codigo = EXCLUDED.plan_codigo,
               estado = 'activa', inicio = NOW(), vence_en = EXCLUDED.vence_en,
               modo_cobro = 'prueba', metadata_json = EXCLUDED.metadata_json,
               actualizado_en = NOW()`,
            [tenant.tenantId, planSolicitado],
          );
        }

        return {
          solicitud: ins.rows[0],
          modo: 'sandbox_sin_cobro_real',
          cobro_real_ejecutado: false,
          plan_actualizado_en_sandbox: aplicarSandboxInmediato,
          mensaje: aplicarSandboxInmediato
            ? `Plan cambiado en modo SANDBOX a '${planSolicitado}' sin cobro real.`
            : `Solicitud de cambio a plan '${planSolicitado}' registrada en modo SANDBOX (sin cobro real).`,
        };
      },
      { requireWrite: false },
    );
  }
}

@Module({
  controllers: [SuscripcionController],
})
export class SuscripcionModule {}
