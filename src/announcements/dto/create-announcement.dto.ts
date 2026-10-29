import { IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAnnouncementDto {
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  title: string;

  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  content: string;

  // Omit for a public announcement (admin only). Supervisors must provide their programId.
  @IsOptional()
  @IsInt()
  programId?: number;
}
