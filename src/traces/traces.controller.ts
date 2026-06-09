import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../common/api-key.guard';
import { TracesService } from './traces.service';

@UseGuards(ApiKeyGuard)
@Controller('traces')
export class TracesController {
  constructor(private readonly traces: TracesService) {}

  /** Full execution tree for a run: header, ordered steps, dependency tree,
   * aggregate token/latency metrics, and dead-letters. */
  @Get(':id')
  getTrace(@Param('id', ParseUUIDPipe) id: string) {
    return this.traces.getTrace(id);
  }
}
