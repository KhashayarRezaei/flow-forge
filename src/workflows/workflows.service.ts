import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workflow } from '../database/entities/workflow.entity';
import { validateWorkflow, WorkflowValidationError } from '../engine/dag';
import { CreateWorkflowDto } from './dto/create-workflow.dto';

@Injectable()
export class WorkflowsService {
  constructor(@InjectRepository(Workflow) private readonly repo: Repository<Workflow>) {}

  async create(dto: CreateWorkflowDto): Promise<Workflow> {
    try {
      validateWorkflow(dto.definition);
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
    const workflow = this.repo.create({
      name: dto.name,
      description: dto.description ?? null,
      version: dto.definition.version ?? 1,
      definition: dto.definition,
    });
    return this.repo.save(workflow);
  }

  findAll(): Promise<Workflow[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Workflow> {
    const workflow = await this.repo.findOne({ where: { id } });
    if (!workflow) throw new NotFoundException(`Workflow ${id} not found`);
    return workflow;
  }

  async remove(id: string): Promise<void> {
    const res = await this.repo.delete(id);
    if (!res.affected) throw new NotFoundException(`Workflow ${id} not found`);
  }
}
