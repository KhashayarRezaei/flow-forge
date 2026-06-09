import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AppConfig } from '../config/configuration';

/**
 * Single shared API key (header `x-api-key` or `Authorization: Bearer <key>`).
 * Intentionally the only auth in this build — no users, no multi-tenancy.
 * Read-only endpoints (the HTML trace viewer assets) are not guarded.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const expected = this.config.get('apiKey', { infer: true });
    const provided =
      (req.headers['x-api-key'] as string | undefined) ??
      extractBearer(req.headers['authorization']);

    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Invalid or missing API key');
    }
    return true;
  }
}

function extractBearer(header?: string): string | undefined {
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : undefined;
}
