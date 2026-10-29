import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateProgramDto {
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  title: string;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description: string;

  @IsInt()
  @Min(1)
  @Max(100000)
  totalSeats: number;

  @IsInt()
  supervisorId: number;
}
