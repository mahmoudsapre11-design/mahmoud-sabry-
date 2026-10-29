import { ApplicationStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class ApplicationsQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @IsOptional()
  @IsInt()
  programId?: number;
}
