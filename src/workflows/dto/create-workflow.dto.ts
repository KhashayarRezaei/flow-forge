import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { WorkflowDefinition } from '../workflow.types';

export class CreateWorkflowDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  /**
   * The DAG definition. Structural validation (unique ids, known types, acyclic
   * graph, resolvable references) happens in the service via validateWorkflow().
   */
  @IsObject()
  definition: WorkflowDefinition;
}
