import { Controller, Get, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
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

  @Get('health')
  async verificarHealth() {
    return this._checkHealth();
  }

  private async _checkHealth() {
    const tenant = TenantContext.get();
    const pool = getPool();
    // Consulta con el mismo patron que el resto del codigo: conexion breve +
    // SET LOCAL ROLE app_readonly (usa solo permisos otorgados por las migraciones,
    // sin depender de grants directos del rol de conexion).
    const client = await pool.connect();
    let version = 10;
    let factoryGeneration: string | null = null;
    try {
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
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      await client.query('RESET ROLE').catch(() => undefined);
      client.release();
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
