import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '../common/api-key.guard';
import { RunsService } from '../runs/runs.service';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { RunWorkflowDto } from './dto/run-workflow.dto';
import { WorkflowsService } from './workflows.service';

@UseGuards(ApiKeyGuard)
@Controller('workflows')
export class WorkflowsController {
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly runs: RunsService,
  ) {}

  @Post()
  create(@Body() dto: CreateWorkflowDto) {
    return this.workflows.create(dto);
  }

  @Get()
  findAll() {
    return this.workflows.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.findOne(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.workflows.remove(id);
  }

  /** Submit a run of this workflow. Returns immediately; execution is async. */
  @Post(':id/runs')
  @HttpCode(202)
  run(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RunWorkflowDto) {
    return this.runs.start(id, dto);
  }

  @Get(':id/runs')
  listRuns(@Param('id', ParseUUIDPipe) id: string) {
    return this.runs.findAll(id);
  }
}
