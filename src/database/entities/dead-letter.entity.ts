import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Dead-letter record. When a step job exhausts all retry attempts, the engine
 * writes the terminal failure here for inspection / manual replay, mirroring a
 * Kafka dead-letter topic.
 */
@Entity('dead_letters')
export class DeadLetter {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  runId: string;

  @Column({ type: 'varchar', length: 200 })
  stepId: string;

  @Column({ type: 'varchar', length: 64 })
  jobId: string;

  @Column({ type: 'int' })
  attemptsMade: number;

  @Column({ type: 'jsonb' })
  payload: unknown;

  @Column({ type: 'text' })
  error: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
