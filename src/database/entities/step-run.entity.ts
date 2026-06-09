import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { StepStatus } from '../../common/status.enum';
import { StepType } from '../../workflows/workflow.types';
import { WorkflowRun } from './workflow-run.entity';

/**
 * One execution record per step per run. Captures everything needed to render a
 * trace: input, output, error, token usage, latency, attempts and timing.
 */
@Entity('step_runs')
@Unique('uq_step_run_run_step', ['runId', 'stepId'])
export class StepRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  runId: string;

  @ManyToOne(() => WorkflowRun, (run) => run.steps, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'runId' })
  run: WorkflowRun;

  /** The step key from the workflow definition. */
  @Column({ type: 'varchar', length: 200 })
  stepId: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  name: string | null;

  @Column({ type: 'varchar', length: 32 })
  type: StepType;

  @Column({ type: 'varchar', length: 32, default: StepStatus.PENDING })
  status: StepStatus;

  @Column({ type: 'jsonb', array: false, default: () => "'[]'" })
  dependsOn: string[];

  /** Resolved input handed to the executor (post-templating). */
  @Column({ type: 'jsonb', nullable: true })
  input: unknown;

  /** Executor output. */
  @Column({ type: 'jsonb', nullable: true })
  output: unknown;

  /** Structured error detail of the last failed attempt. */
  @Column({ type: 'jsonb', nullable: true })
  error: { message: string; retryable?: boolean; attempt?: number } | null;

  /** How many execution attempts have been made (incremented per try). */
  @Column({ type: 'int', default: 0 })
  attempt: number;

  @Column({ type: 'int', nullable: true })
  promptTokens: number | null;

  @Column({ type: 'int', nullable: true })
  completionTokens: number | null;

  @Column({ type: 'int', nullable: true })
  totalTokens: number | null;

  @Column({ type: 'int', nullable: true })
  latencyMs: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
