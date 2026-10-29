import { ApplicationStatus } from '@prisma/client';
import { IsIn } from 'class-validator';

export class ReviewDto {
  @IsIn([ApplicationStatus.ACCEPTED, ApplicationStatus.REJECTED])
  status: 'ACCEPTED' | 'REJECTED';
}
