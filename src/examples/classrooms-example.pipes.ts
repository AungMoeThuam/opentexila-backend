import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';

function positiveInteger(
  value: unknown,
  name: string,
  maximum: number,
  fallback?: number,
): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > maximum
  ) {
    throw new BadRequestException(
      `${name} must be an integer between 1 and ${maximum}.`,
    );
  }
  return Number(value);
}

// These sample routes retain their documented 400 errors.
export interface ClassroomParams {
  id: number;
}
export interface ClassroomPagination extends PaginationQueryDto {}

@Injectable()
export class ClassroomPaginationPipe implements PipeTransform<
  Record<string, unknown>,
  ClassroomPagination
> {
  transform(query: Record<string, unknown>): ClassroomPagination {
    return {
      page: positiveInteger(query.page, 'page', 10000, 1),
      limit: positiveInteger(query.limit, 'limit', 100, 20),
    };
  }
}

@Injectable()
export class ClassroomParamsPipe implements PipeTransform<
  Record<string, unknown>,
  ClassroomParams
> {
  transform(params: Record<string, unknown>): ClassroomParams {
    return { id: positiveInteger(params.id, 'id', 4294967295) };
  }
}
