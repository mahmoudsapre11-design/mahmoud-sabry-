import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';
import { toHttpException } from './errors';

/** Global filter: every error leaves the API in the same JSON shape. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest();
    if (res.headersSent) return;

    try {
      const http: HttpException = toHttpException(exception, `${req.method} ${req.url}`);
      const status = http.getStatus();
      const body = http.getResponse();
      const message = typeof body === 'string' ? body : ((body as any).message ?? body);

      if (status >= 500) this.logger.error(`${req.method} ${req.url} -> ${status}`);
      res.status(status).json({
        statusCode: status,
        message,
        path: req.url,
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(500).json({ statusCode: 500, message: 'Unexpected server error' });
    }
  }
}
