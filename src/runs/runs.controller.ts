import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '../common/api-key.guard';
import { ApprovalDecisionDto } from './dto/approval.dto';
import { RunsService } from './runs.service';

@UseGuards(ApiKeyGuard)
@Controller('runs')
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  @Get()
  findAll(@Query('workflowId') workflowId?: string) {
    return this.runs.findAll(workflowId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.runs.findOne(id);
  }

  /** Approve a paused human-approval gate; the run resumes. */
  @Post(':id/steps/:stepId/approve')
  @HttpCode(200)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stepId') stepId: string,
    @Body() dto: ApprovalDecisionDto,
  ) {
    return this.runs.approve(id, stepId, true, dto.decidedBy, dto.note);
  }

  /** Reject a paused human-approval gate; the gated branch is skipped. */
  @Post(':id/steps/:stepId/reject')
  @HttpCode(200)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stepId') stepId: string,
    @Body() dto: ApprovalDecisionDto,
  ) {
    return this.runs.approve(id, stepId, false, dto.decidedBy, dto.note);
  }
}
