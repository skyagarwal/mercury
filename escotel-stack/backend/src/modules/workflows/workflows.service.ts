import { Inject, Injectable } from '@nestjs/common';
import { REDIS_CLIENT } from '../redis.module.js';
import { SaveWorkflowDto, WorkflowDto, WorkflowSummaryDto } from './dto.js';

const KEY = (id: string) => `workflows:${id}`;
const INDEX = 'workflows:index';

@Injectable()
export class WorkflowsService {
	constructor(@Inject(REDIS_CLIENT) private readonly redis: any) {}

	async list(): Promise<WorkflowSummaryDto[]> {
		const members = await this.redis.zrevrange(INDEX, 0, -1, 'WITHSCORES');
		const results: WorkflowSummaryDto[] = [];
		for (let i = 0; i < members.length; i += 2) {
			const id = members[i];
			const updatedAt = new Date(Number(members[i + 1])).toISOString();
			const raw = await this.redis.get(KEY(id));
			if (!raw) continue;
			try {
				const parsed = JSON.parse(raw);
				results.push({ id, title: parsed.title, description: parsed.description, tags: parsed.tags, updatedAt });
			} catch {}
		}
		return results;
	}

	async get(id: string): Promise<WorkflowDto | null> {
		const raw = await this.redis.get(KEY(id));
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		const score = await this.redis.zscore(INDEX, id);
		return {
			id,
			title: parsed.title,
			description: parsed.description,
			tags: parsed.tags,
			schema: parsed.schema,
			updatedAt: new Date(Number(score || Date.now())).toISOString(),
		};
	}

	async save(dto: SaveWorkflowDto): Promise<WorkflowDto> {
		const now = Date.now();
		const data = { title: dto.title, description: dto.description, tags: dto.tags, schema: dto.schema };
		await this.redis.multi().set(KEY(dto.id), JSON.stringify(data)).zadd(INDEX, now, dto.id).exec();
		return { id: dto.id, ...data, updatedAt: new Date(now).toISOString() } as WorkflowDto;
	}

	async remove(id: string): Promise<{ deleted: boolean }>{
		const res = await this.redis.multi().del(KEY(id)).zrem(INDEX, id).exec();
		const deleted = Boolean((res?.[0]?.[1] as number) || 0);
		return { deleted };
	}
}

