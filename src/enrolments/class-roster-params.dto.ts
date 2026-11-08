import { QueryInteger } from '../common/dto/query-integer.decorator';

export class ClassRosterParamsDto {
  @QueryInteger(4294967295)
  classId!: number;
}
