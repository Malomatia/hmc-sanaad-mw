import { Inject, Injectable } from '@nestjs/common';
import {
  DEMO_REPOSITORY,
  DemoRepository,
} from '../domain/demo.repository';
import { DemoRequestDto } from '../interface/dto/demo.request.dto';

@Injectable()
export class DemoService {
  constructor(
    @Inject(DEMO_REPOSITORY)
    private readonly repo: DemoRepository,
  ) {}

  getInfo(): Promise<Record<string, unknown>> {
    return this.repo.getInfo();
  }

  createInfo(dto: DemoRequestDto): Promise<Record<string, unknown>> {
    return this.repo.createInfo(dto);
  }
}