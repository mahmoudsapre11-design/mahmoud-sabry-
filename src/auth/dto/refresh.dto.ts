import { IsString, MaxLength } from 'class-validator';

export class RefreshDto {
  @IsString()
  @MaxLength(2000)
  refreshToken: string;
}
