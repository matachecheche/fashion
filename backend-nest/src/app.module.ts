import { Controller, Get, MiddlewareConsumer, Module, NestModule, RequestMethod, ServiceUnavailableException } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import * as path from 'path';
import { getPool, TenantResolutionMiddleware } from './common/db';
import { TenantContext } from './common/tenant-context';
import { AuthModule } from './auth/auth.module';
import { CatalogoModule } from './catalogo/catalogo.module';
import { MaestrosModule } from './maestros/maestros.module';
import { InventarioModule } from './inventario/inventario.module';
import { ReservasModule } from './reservas/reservas.module';
import { VentasModule } from './ventas/ventas.module';
import { PagosModule } from './pagos/pagos.module';
import { PosModule } from './pos/pos.module';
import { PropuestasModule } from './proveedores/propuestas.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { NotificacionesModule } from './notificaciones/notificaciones.module';
import { SuscripcionModule } from './suscripcion/suscripcion.module';
import { SyncModule } from './sync/sync.module';
import { IaModule } from './ia/ia.module';
import { ReportesModule } from './reportes/reportes.module';

@Controller()
export class HealthController {
  @Get('salud')
  async verificarSalud() {
    return this._checkHealth();
  }

  @Get('health/live')
  verificarLiveness() {
    // Liveness only proves that the NestJS process is alive. It deliberately
    // does not depend on PostgreSQL, so container probes can distinguish a
    // running API from a database/readiness failure.
    return {
      estado: 'ok',
      servicio: 'fashionstore-backend-nest',
      comprobacion: 'liveness',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('health')
  async verificarHealth() {
    return this._checkHealth();
  }

  private async _checkHealth() {
    const tenant = TenantContext.get();
    let client: import('pg').PoolClient | null = null;
    let version = 10;
    let factoryGeneration: string | null = null;
    try {
      // La readiness verifica la base real y los permisos de lectura que usa
      // la aplicación. Los errores se devuelven como 503 con un código seguro,
      // sin exponer DATABASE_URL, usuarios ni contraseñas.
      client = await getPool().connect();
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_readonly');
      const res = await client.query(
        `SELECT
           COALESCE(MAX(valor::int) FILTER (WHERE clave = 'esquema_version'), 10)::int AS version,
           MAX(valor) FILTER (WHERE clave = 'factory_generation') AS factory_generation
           FROM public.meta
          WHERE clave IN ('esquema_version', 'factory_generation')`,
      );
      version = Number(res.rows[0]?.version ?? 10);
      factoryGeneration = res.rows[0]?.factory_generation ?? null;
      await client.query('COMMIT');
    } catch (err: any) {
      if (client) await client.query('ROLLBACK').catch(() => undefined);
      const rawCode = String(err?.code || '');
      const diagnostic = /^[A-Z0-9_]{2,32}$/.test(rawCode)
        ? rawCode
        : (String(err?.message || '').includes('DATABASE_URL_REQUIRED') ? 'DATABASE_URL_REQUIRED' : String(err?.message || '').includes('DATABASE_SSL_REQUIRED') ? 'DATABASE_SSL_REQUIRED' : 'DATABASE_HEALTH_CHECK_FAILED');
      console.error(`[FashionStore] Health/readiness de PostgreSQL falló: ${diagnostic}`);
      throw new ServiceUnavailableException({
        statusCode: 503,
        estado: 'degradado',
        error: 'DATABASE_HEALTH_CHECK_FAILED',
        diagnostico: diagnostic,
        message: 'NestJS está activo, pero PostgreSQL no pasó la comprobación de disponibilidad. Revisa DATABASE_URL, TLS, el rol app_readonly y las migraciones.',
      });
    } finally {
      if (client) {
        await client.query('RESET ROLE').catch(() => undefined);
        client.release();
      }
    }
    return {
      estado: 'ok',
      servicio: 'fashionstore-backend-nest',
      schema_version: version,
      factory_generation: factoryGeneration,
      tenant_actual: tenant
        ? {
            id: tenant.tenantId,
            slug: tenant.tenantSlug,
            nombre: tenant.nombre,
            plan: tenant.plan,
            solo_lectura: !tenant.writeAllowed,
            demo_vence_en: tenant.demoVenceEn,
          }
        : null,
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: path.join(__dirname, '..', 'public'),
      serveRoot: '/',
      exclude: ['/api{/*splat}'],
    }),
    AuthModule,
    CatalogoModule,
    MaestrosModule,
    InventarioModule,
    ReservasModule,
    VentasModule,
    PagosModule,
    PosModule,
    PropuestasModule,
    UsuariosModule,
    NotificacionesModule,
    SuscripcionModule,
    SyncModule,
    IaModule,
    ReportesModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantResolutionMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
