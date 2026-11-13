import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Injectable,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { describeException, httpResponse } from '../commons/http-response.js';

@Catch()
@Injectable()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<{
      method?: string;
      path?: string;
      originalUrl?: string;
      requestId?: string;
      url?: string;
    }>();
    const response = context.getResponse<unknown>();
    const { statusCode, message, data } = describeException(exception);
    const adapter = this.adapterHost.httpAdapter;
    const requestPath = request.path ?? request.originalUrl ?? request.url;
    const path = requestPath?.split('?', 1)[0];

    if (statusCode >= 500) {
      this.logger.error({
        error:
          exception instanceof Error
            ? {
                name: exception.name,
                message: exception.message,
                stack: exception.stack,
              }
            : String(exception),
        method: request.method,
        path,
        requestId: request.requestId,
      });
    }

    if (adapter.isHeadersSent(response)) return;

    adapter.reply(
      response,
      httpResponse(statusCode, message, data, {
        path,
        requestId: request.requestId,
        timestamp: new Date().toISOString(),
      }),
      statusCode,
    );
  }
}
