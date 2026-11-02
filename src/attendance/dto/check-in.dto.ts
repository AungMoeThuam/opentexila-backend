import { IsNumber, IsPositive, Max, Min } from 'class-validator';
import { TimestampInput } from './attendance-query.dto';

export class CheckInDto {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  accuracy_m!: number;

  @TimestampInput('utc')
  reading_timestamp!: Date;
}
