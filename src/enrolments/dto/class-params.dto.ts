import { QueryInteger } from '../../common/dto/query-integer.decorator';

export class ClassParamsDto {
  @QueryInteger(4294967295)
  classId!: number;
}

export class EnrolmentParamsDto extends ClassParamsDto {
  @QueryInteger(4294967295)
  studentId!: number;
}
