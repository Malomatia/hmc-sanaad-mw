import { DemoRequestDto } from '../interface/dto/demo.request.dto';

export interface DemoRepository {
  getInfo(): Promise<Record<string, unknown>>;

  createInfo(dto: DemoRequestDto): Promise<Record<string, unknown>>;
}

export const DEMO_REPOSITORY = Symbol('DEMO_REPOSITORY');