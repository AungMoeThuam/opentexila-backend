import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { QueryInteger } from '../../common/dto/query-integer.decorator';

export class CommentParamsDto {
  @QueryInteger(4294967295)
  commentId!: number;
}

// Paging for GET /announcements/:announcementId/comments.
export class ListCommentsQueryDto extends PaginationQueryDto {}

// Body of POST /announcements/:announcementId/comments. The author comes from
// the signed-in user, so it is not a field here.
export class CreateCommentDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'body must be 1 to 1000 characters.' })
  @Length(1, 1000, { message: 'body must be 1 to 1000 characters.' })
  body!: string;
}
