import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMaterialDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  title: string;
}
