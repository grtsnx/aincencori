import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { sendAlert } from '../commons/alert.js';
import { describeException, httpResponse } from '../commons/http-response.js';

@Catch()
@Injectable()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @Optional() private readonly config?: ConfigService,
  ) {}

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
    const described = describeException(exception);
    const { statusCode, data } = described;
    let { message } = described;
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
      // Tell the team (one message per kind of error every few minutes).
      sendAlert(
        this.config?.get<string>('ALERT_WEBHOOK_URL'),
        `Server error on ${request.method ?? ''} ${path ?? ''}`,
        exception instanceof Error ? exception.message : String(exception),
      );
    }

    // "Not available" errors can name an outside service or a setting.
    // Users get a plain message; the team gets the real one.
    if (statusCode === 503) {
      sendAlert(
        this.config?.get<string>('ALERT_WEBHOOK_URL'),
        `Not available: ${request.method ?? ''} ${path ?? ''}`,
        message,
      );
      message = 'This is not available right now. Please try again later.';
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
