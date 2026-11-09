import { Transform } from 'class-transformer';
import { IsString, Length, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { QueryInteger } from '../../common/dto/query-integer.decorator';
import { CodeField, TextField } from './fields';

export class CreateCourseDto {
  @CodeField('code', 30)
  code!: string;

  @TextField('name', 150)
  name!: string;
}

export class UpdateCourseDto {
  @CodeField('code', 30, false)
  code?: string;

  @TextField('name', 150, false)
  name?: string;
}

export class CourseParamsDto {
  @QueryInteger(4294967295)
  courseId!: number;
}

// Shared by the course and lecturer selector lists.
export class OptionsQueryDto extends PaginationQueryDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'q must be 1 to 100 characters.' })
  @Length(1, 100, { message: 'q must be 1 to 100 characters.' })
  q?: string;
}
