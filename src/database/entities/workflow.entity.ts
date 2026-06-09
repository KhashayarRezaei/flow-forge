import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WorkflowDefinition } from '../../workflows/workflow.types';
import { WorkflowRun } from './workflow-run.entity';

@Entity('workflows')
export class Workflow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  /** The DAG definition (steps, edges, configs). */
  @Column({ type: 'jsonb' })
  definition: WorkflowDefinition;

  @OneToMany(() => WorkflowRun, (run) => run.workflow)
  runs: WorkflowRun[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
