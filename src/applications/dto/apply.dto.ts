import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApplyDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
