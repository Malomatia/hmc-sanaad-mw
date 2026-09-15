import { Injectable } from '@nestjs/common';

import { DemoRequestDto } from '../../interface/dto/demo.request.dto';
import { DemoRepository } from '../../domain/demo.repository';

@Injectable()
export class DemoDummyRepository implements DemoRepository {

  async getInfo(): Promise<Record<string, unknown>[]> {
    return [
      {
        employeeId: '1',
        name: 'Dheeraj',
        department: 'ADM',
      },
      {
        employeeId: '2',
        name: 'ElSerag',
        department: 'ADM',
      },
    ];
  }

  async createInfo(dto: DemoRequestDto): Promise<Record<string, unknown>> {
    return {
      message: 'Demo employee information received successfully',
      employee: {
        name: dto.name,
        email: dto.email,
        department: dto.department,
      },
    };
  }
}