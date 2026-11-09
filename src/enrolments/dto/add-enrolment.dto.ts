import { IsInt, Max, Min } from 'class-validator';

export class AddEnrolmentDto {
  @IsInt({ message: 'Must be an integer between 1 and 4294967295.' })
  @Min(1, { message: 'Must be an integer between 1 and 4294967295.' })
  @Max(4294967295, { message: 'Must be an integer between 1 and 4294967295.' })
  student_id!: number;
}
