import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AppModule } from './app.module';
import { getPool } from './common/db';
import { ejecutarConciliacionPagos } from './pagos/pagos.module';
import { getJwtSecret } from './common/auth';

async function ejecutarBarridoTrials(): Promise<void> {
  let client: import('pg').PoolClient | null = null;
  try {
    client = await getPool().connect();
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_runtime');
    const result = await client.query('SELECT public.suspender_trials_vencidos() AS suspendidos');
    await client.query('COMMIT');
    const suspendidos = Number(result.rows[0]?.suspendidos || 0);
    if (suspendidos > 0) {
      console.log(`[FashionStore] Barrido diario: ${suspendidos} Trial vencidos pasaron a solo lectura.`);
    }
  } catch (err: any) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    console.warn('[FashionStore] No se pudo completar el barrido de Trials vencidos:', err?.code || err?.message || 'error');
  } finally {
    if (client) {
      await client.query('RESET ROLE').catch(() => undefined);
      client.release();
    }
  }
}

async function bootstrap() {
  getJwtSecret();
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
    rawBody: true,
  });

  app.setGlobalPrefix('api');

  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const express = app.getHttpAdapter().getInstance();
  express.set('trust proxy', isProduction ? 1 : false);
  // Express 5 defaults to the "simple" parser; keep the nested query behavior
  // used by existing filters and clients.
  express.set('query parser', 'extended');
  const defaultOrigins = isProduction
    ? ''
    : 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://localhost:8081,http://localhost:19006';
  const allowedOrigins = (process.env.CORS_ORIGINS ?? defaultOrigins)
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => Boolean(origin) && origin !== '*');

  const contentSecurityDirectives: Record<string, string[]> = {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    frameAncestors: ["'self'"],
    objectSrc: ["'none'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', ...allowedOrigins],
    fontSrc: ["'self'", 'data:', ...allowedOrigins],
    connectSrc: ["'self'", ...allowedOrigins],
  };
  if (isProduction) contentSecurityDirectives.upgradeInsecureRequests = [];
  app.use(helmet({
    contentSecurityPolicy: { directives: contentSecurityDirectives },
    crossOriginEmbedderPolicy: false,
    hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { statusCode: 429, error: 'RATE_LIMIT_LOGIN', message: 'Demasiados intentos de inicio de sesión. Espera 15 minutos.' },
  });
  const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { statusCode: 429, error: 'RATE_LIMIT_REGISTRATION', message: 'Se alcanzó el límite de registros desde esta conexión. Intenta más tarde.' },
  });
  app.use('/api/auth/login', loginLimiter);
  app.use(['/api/auth/registrar-tienda', '/api/tenants/registro'], registrationLimiter);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const isLocalDevelopment = !isProduction && (
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:') ||
        origin.startsWith('http://192.168.')
      );
      if (allowedOrigins.includes(origin) || isLocalDevelopment) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Tenant-Slug',
      'X-Tenant-Id',
      'X-Offline-Idempotency-Key',
      'Idempotency-Key',
      'X-Provider-Signature',
      'Stripe-Signature',
    ],
    exposedHeaders: ['Content-Disposition'],
  });

  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`[FashionStore NestJS] API SaaS multi-tenant escuchando en http://0.0.0.0:${port}/api`);

  const firstTrialSweep = setTimeout(() => void ejecutarBarridoTrials(), 5000);
  const dailyTrialSweep = setInterval(() => void ejecutarBarridoTrials(), 24 * 60 * 60 * 1000);
  const firstPaymentReconcile = setTimeout(() => void ejecutarConciliacionPagos(), 7000);
  const paymentReconcile = setInterval(() => void ejecutarConciliacionPagos(), 5 * 60 * 1000);
  firstTrialSweep.unref();
  dailyTrialSweep.unref();
  firstPaymentReconcile.unref();
  paymentReconcile.unref();
}

bootstrap().catch((err) => {
  console.error('[FashionStore NestJS] Error fatal al iniciar:', err);
  process.exit(1);
});
