import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

const STATUS_HINTS: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]:
    'Permintaan tidak valid. Periksa data yang dikirim lalu coba lagi.',
  [HttpStatus.UNAUTHORIZED]:
    'Sesi login berakhir atau token tidak valid. Silakan login ulang.',
  [HttpStatus.FORBIDDEN]:
    'Anda tidak punya izin untuk melakukan aksi ini.',
  [HttpStatus.NOT_FOUND]:
    'Data yang diminta tidak ditemukan. Muat ulang halaman lalu coba lagi.',
  [HttpStatus.CONFLICT]:
    'Terjadi konflik data (misalnya email sudah terpakai).',
  [HttpStatus.UNPROCESSABLE_ENTITY]:
    'Data tidak dapat diproses. Periksa format field yang dikirim.',
  [HttpStatus.TOO_MANY_REQUESTS]:
    'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.',
  [HttpStatus.INTERNAL_SERVER_ERROR]:
    'Terjadi kesalahan di server. Coba lagi atau hubungi admin jika berulang.',
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = STATUS_HINTS[HttpStatus.INTERNAL_SERVER_ERROR] as string;
    let errors: string[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      const fallback =
        STATUS_HINTS[status] ?? `Permintaan gagal (HTTP ${status}).`;

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const body = exceptionResponse as Record<string, unknown>;

        if (Array.isArray(body.message)) {
          errors = (body.message as unknown[]).map((item) => String(item));
          message =
            errors.length === 1
              ? errors[0]
              : `Validasi gagal: ${errors.join('; ')}`;
        } else if (typeof body.message === 'string' && body.message.trim()) {
          message = body.message;
        } else {
          message = fallback;
        }
      } else {
        message = fallback;
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
      message = `Kesalahan server: ${exception.message}`;
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      errors,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
