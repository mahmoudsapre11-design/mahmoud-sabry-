import { PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateSessionDto {
  @IsDateString()
  date: string; // e.g. 2026-12-01

  @Matches(TIME, { message: 'startTime must be in HH:mm format' })
  startTime: string;

  @IsOptional()
  @Matches(TIME, { message: 'endTime must be in HH:mm format' })
  endTime?: string;

  @IsString()
  @MaxLength(500)
  location: string; // place or online link
}

export class UpdateSessionDto extends PartialType(CreateSessionDto) {}
