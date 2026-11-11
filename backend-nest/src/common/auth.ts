import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { TenantContext } from './tenant-context';

export const ROLES_KEY = 'roles_permitidos';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export interface JwtUserPayload {
  sub: number;
  email: string;
  nombre: string;
  rol: 'admin' | 'encargado' | 'cajero' | 'proveedor' | 'cliente';
  sucursal_id: number | null;
  proveedor_id: number | null;
  tenant_id: string;
  tenant_slug: string;
}

export function getJwtSecret(): string {
  const secret = String(process.env.JWT_SECRET || '');
  if (secret.length < 32) {
    throw new Error('JWT_SECRET_REQUIRED: define un secreto de al menos 32 caracteres antes de iniciar la API.');
  }
  return secret;
}

export function signUserToken(payload: JwtUserPayload): string {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: (process.env.JWT_EXPIRES_IN || '12h') as any,
  });
}

export function verifyUserToken(token: string): JwtUserPayload {
  try {
    return jwt.verify(token, getJwtSecret()) as unknown as JwtUserPayload;
  } catch {
    throw new UnauthorizedException('TOKEN_INVALIDO: Sesion expirada o token JWT invalido.');
  }
}

export function extractOptionalUser(req: any): JwtUserPayload | null {
  const authHeader = String(req?.headers?.authorization || '');
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  const decoded = verifyUserToken(token);
  const currentTenant = TenantContext.get();
  if (
    currentTenant &&
    (decoded.tenant_id !== currentTenant.tenantId ||
      decoded.tenant_slug !== currentTenant.tenantSlug)
  ) {
    throw new ForbiddenException(
      'CROSS_TENANT_ACCESS_DENIED: El token pertenece a otra tienda y no puede utilizarse en este tenant.',
    );
  }
  return decoded;
}

@Injectable()
export class JwtTenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const authHeader = String(req.headers['authorization'] || '');
    if (!authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('AUTH_REQUIRED: Debe iniciar sesion para acceder a este recurso.');
    }

    const token = authHeader.slice(7).trim();
    const user = verifyUserToken(token);
    const tenant = TenantContext.require();

    if (user.tenant_id !== tenant.tenantId || user.tenant_slug !== tenant.tenantSlug) {
      throw new ForbiddenException(
        `CROSS_TENANT_ACCESS_DENIED: El usuario pertenece a la tienda '${user.tenant_slug}' y no tiene acceso a '${tenant.tenantSlug}'.`,
      );
    }

    // Verificar si el cliente envio un tenant_id malicioso en body o query
    const bodyTid = req.body?.tenant_id || req.body?.tenantId;
    const queryTid = req.query?.tenant_id || req.query?.tenantId;
    if ((bodyTid && String(bodyTid) !== tenant.tenantId) || (queryTid && String(queryTid) !== tenant.tenantId)) {
      throw new ForbiddenException('TENANT_TAMPERING_DETECTED: No se permite alterar el tenant_id desde el cliente.');
    }

    // Bloquear mutaciones cuando el Trial ha expirado (excepto solicitudes de suscripcion)
    const method = String(req.method || 'GET').toUpperCase();
    const path = String(req.url || '');
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const isSubscriptionRequest = path.includes('/suscripcion/cambio');
    if (isMutation && !isSubscriptionRequest && !tenant.writeAllowed) {
      throw new ForbiddenException(
        'DEMO_EXPIRED_READ_ONLY: El periodo Trial de 14 dias ha vencido. Las escrituras estan bloqueadas pero puedes consultar y exportar tus datos.',
      );
    }

    const handler = context.getHandler();
    const cls = context.getClass();
    const requiredRoles: string[] | undefined =
      Reflect.getMetadata(ROLES_KEY, handler) || Reflect.getMetadata(ROLES_KEY, cls);

    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(user.rol)) {
      throw new ForbiddenException(
        `ROLE_FORBIDDEN: Se requiere uno de los roles [${requiredRoles.join(', ')}]; rol actual: ${user.rol}.`,
      );
    }

    req.user = user;
    return true;
  }
}
