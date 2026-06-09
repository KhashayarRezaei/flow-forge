import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RunStatus } from '../../common/status.enum';
import { Workflow } from './workflow.entity';
import { StepRun } from './step-run.entity';

@Entity('workflow_runs')
export class WorkflowRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  workflowId: string;

  @ManyToOne(() => Workflow, (workflow) => workflow.runs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflowId' })
  workflow: Workflow;

  @Index()
  @Column({ type: 'varchar', length: 32, default: RunStatus.PENDING })
  status: RunStatus;

  /** Caller-provided input for this run. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  input: Record<string, unknown>;

  /** Final assembled outputs of all completed steps (set when run finishes). */
  @Column({ type: 'jsonb', nullable: true })
  output: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  /**
   * Optional caller-supplied idempotency key. A unique partial index guarantees
   * one run per key, so retried submissions return the original run.
   */
  @Index({ unique: true, where: '"idempotencyKey" IS NOT NULL' })
  @Column({ type: 'varchar', length: 200, nullable: true })
  idempotencyKey: string | null;

  @OneToMany(() => StepRun, (step) => step.run, { cascade: true })
  steps: StepRun[];

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
