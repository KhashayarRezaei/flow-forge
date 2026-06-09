import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApprovalDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  decidedBy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
