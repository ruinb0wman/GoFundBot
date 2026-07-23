import { logger } from './logger.js';

export interface SourceScoreRecord {
  score: number;
  lastSuccess: number | null;
  lastFailure: number | null;
  consecutiveFailures: number;
  totalCalls: number;
}

export type SourceScores = Record<string, SourceScoreRecord>;

export interface ScorerConfig {
  initialScore: number;
  successIncrement: number;
  failureDecrement: number;
  consecutivePenalty: number;
  decayPerHour: number;
  maxScore: number;
  minScore: number;
}

const DEFAULT_CONFIG: ScorerConfig = {
  initialScore: 50,
  successIncrement: 10,
  failureDecrement: 15,
  consecutivePenalty: 5,
  decayPerHour: 2,
  maxScore: 100,
  minScore: 0,
};

export class DataSourceScorer {
  private scores = new Map<string, SourceScoreRecord>();
  private config: ScorerConfig;

  constructor(config?: Partial<ScorerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private key(source: string, operation: string): string {
    return `${source}:${operation}`;
  }

  private ensure(serviceKey: string): SourceScoreRecord {
    let record = this.scores.get(serviceKey);
    if (!record) {
      record = {
        score: this.config.initialScore,
        lastSuccess: null,
        lastFailure: null,
        consecutiveFailures: 0,
        totalCalls: 0,
      };
      this.scores.set(serviceKey, record);
    }
    return record;
  }

  recordSuccess(source: string, operation: string): void {
    const serviceKey = this.key(source, operation);
    const record = this.ensure(serviceKey);
    record.totalCalls++;
    record.consecutiveFailures = 0;
    record.lastSuccess = Date.now();
    record.score = Math.min(
      record.score + this.config.successIncrement,
      this.config.maxScore,
    );
  }

  recordFailure(source: string, operation: string): void {
    const serviceKey = this.key(source, operation);
    const record = this.ensure(serviceKey);
    record.totalCalls++;
    record.consecutiveFailures++;
    record.lastFailure = Date.now();

    let penalty = this.config.failureDecrement;
    if (record.consecutiveFailures > 1) {
      penalty += this.config.consecutivePenalty * (record.consecutiveFailures - 1);
    }

    record.score = Math.max(
      record.score - penalty,
      this.config.minScore,
    );
  }

  sortByScore<T extends { name: string }>(providers: T[], operation: string): T[] {
    const now = Date.now();

    for (const provider of providers) {
      const serviceKey = this.key(provider.name, operation);
      const record = this.scores.get(serviceKey);
      if (!record) continue;

      if (record.lastSuccess != null || record.lastFailure != null) {
        const lastEvent = Math.max(
          record.lastSuccess ?? 0,
          record.lastFailure ?? 0,
        );
        const elapsedHours = (now - lastEvent) / 3600_000;
        if (elapsedHours > 1) {
          const decay = Math.floor(elapsedHours) * this.config.decayPerHour;
          if (record.score > this.config.initialScore) {
            record.score = Math.max(
              record.score - decay,
              this.config.initialScore,
            );
          } else if (record.score < this.config.initialScore) {
            record.score = Math.min(
              record.score + decay,
              this.config.initialScore,
            );
          }
        }
      }
    }

    return [...providers].sort((a, b) => {
      const sa = this.scores.get(this.key(a.name, operation))?.score ?? this.config.initialScore;
      const sb = this.scores.get(this.key(b.name, operation))?.score ?? this.config.initialScore;
      if (sb !== sa) return sb - sa;
      return providers.indexOf(a) - providers.indexOf(b);
    });
  }

  getScores(): SourceScores {
    const result: SourceScores = {};
    for (const [serviceKey, record] of this.scores) {
      result[serviceKey] = { ...record };
    }
    return result;
  }

  setScores(scores: SourceScores): void {
    for (const [serviceKey, record] of Object.entries(scores)) {
      this.scores.set(serviceKey, { ...record });
    }
    logger.info('DataSourceScorer: scores restored from sync', { count: Object.keys(scores).length });
  }

  getStats(): { totalKeys: number; averageScore: number; topSources: Array<{ key: string; score: number }> } {
    const entries = Array.from(this.scores.entries());
    const avg = entries.length
      ? entries.reduce((sum, [, r]) => sum + r.score, 0) / entries.length
      : 0;
    const top = entries
      .sort(([, a], [, b]) => b.score - a.score)
      .slice(0, 10)
      .map(([key, r]) => ({ key, score: r.score }));
    return { totalKeys: entries.length, averageScore: Math.round(avg * 10) / 10, topSources: top };
  }

  reset(): void {
    this.scores.clear();
  }
}

export const dataSourceScorer = new DataSourceScorer();
