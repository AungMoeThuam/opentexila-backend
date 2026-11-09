import { IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { QueryInteger } from '../../common/dto/query-integer.decorator';

export class ClassesQueryDto extends PaginationQueryDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @QueryInteger(4294967295)
  courseId?: number;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: 'term must be a non-empty string.' })
  @Matches(/\S/, { message: 'term must be a non-empty string.' })
  @MaxLength(50, { message: 'term must not exceed 50 characters.' })
  term?: string;
}
