import { Transform } from 'class-transformer';
import { IsIn, IsString, Length, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { QueryInteger } from '../../common/dto/query-integer.decorator';
import {
  ANNOUNCEMENT_CATEGORIES,
  type AnnouncementCategory,
} from '../../database/entities';

export const ANNOUNCEMENT_SORTS = ['newest', 'oldest', 'most_liked'] as const;
export type AnnouncementSort = (typeof ANNOUNCEMENT_SORTS)[number];

export class ClassAnnouncementsParamsDto {
  @QueryInteger(4294967295)
  classId!: number;
}

export class AnnouncementParamsDto {
  @QueryInteger(4294967295)
  announcementId!: number;
}

// Filters for GET /classes/:classId/announcements. Paging comes from the base class.
export class ListAnnouncementsQueryDto extends PaginationQueryDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'search must be 1 to 100 characters.' })
  @Length(1, 100, { message: 'search must be 1 to 100 characters.' })
  search?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(ANNOUNCEMENT_CATEGORIES, {
    message: 'category must be general, class_change, reminder or exam.',
  })
  category?: AnnouncementCategory;

  @IsIn(ANNOUNCEMENT_SORTS, {
    message: 'sort must be newest, oldest or most_liked.',
  })
  sort: AnnouncementSort = 'newest';
}
