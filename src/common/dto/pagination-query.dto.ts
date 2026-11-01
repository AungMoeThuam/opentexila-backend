import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Must be an integer between 1 and 10000.' })
  @Min(1, { message: 'Must be an integer between 1 and 10000.' })
  @Max(10000, { message: 'Must be an integer between 1 and 10000.' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Must be an integer between 1 and 100.' })
  @Min(1, { message: 'Must be an integer between 1 and 100.' })
  @Max(100, { message: 'Must be an integer between 1 and 100.' })
  limit: number = 20;
}
