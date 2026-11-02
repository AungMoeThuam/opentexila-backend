import { QueryInteger } from './query-integer.decorator';

export class PaginationQueryDto {
  @QueryInteger(10000)
  page: number = 1;

  @QueryInteger(100)
  limit: number = 20;
}
