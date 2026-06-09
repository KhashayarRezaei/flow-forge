import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class RunWorkflowDto {
  @IsOptional()
  @IsObject()
  input?: Record<string, unknown>;

  /**
   * Optional idempotency key. Submitting the same key twice returns the
   * original run instead of starting a new one.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string;
}
