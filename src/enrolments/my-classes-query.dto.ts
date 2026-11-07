import { IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { QueryInteger } from '../common/dto/query-integer.decorator';

export class MyClassesQueryDto extends PaginationQueryDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @QueryInteger(4294967295)
  courseId?: number;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/\S/, { message: 'term must be a non-empty string.' })
  @MaxLength(50)
  term?: string;
}
