import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class DemoRequestDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  department!: string;
}