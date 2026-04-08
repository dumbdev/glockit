import { LoadShapeConfig } from '../types';

export interface WeightedScenario {
  name: string;
  weight?: number;
  flow: string[];
}

export interface CoordinatedOmissionSettings {
  enabled: boolean;
  expectedIntervalMs?: number;
}

export function getEffectiveRequestDelayMs(
  configuredDelayMs: number,
  executor: 'concurrency' | 'arrival-rate',
  arrivalRate: number | undefined,
  workerCount: number
): number {
  if (executor !== 'arrival-rate' || !arrivalRate || arrivalRate <= 0) {
    return configuredDelayMs;
  }

  // Approximate per-worker pacing for a target aggregate arrival rate.
  const perWorkerDelay = Math.ceil((1000 * Math.max(workerCount, 1)) / arrivalRate);
  return Math.max(configuredDelayMs, perWorkerDelay);
}

export function applyLoadShape(
  baseArrivalRate: number | undefined,
  loadShape: LoadShapeConfig | undefined,
  elapsedMs: number
): number | undefined {
  if (!baseArrivalRate || baseArrivalRate <= 0 || !loadShape) {
    return baseArrivalRate;
  }

  if (loadShape.mode === 'step' && Array.isArray(loadShape.steps) && loadShape.steps.length > 0) {
    const sortedSteps = [...loadShape.steps].sort((a, b) => a.afterMs - b.afterMs);
    let rate = baseArrivalRate;
    for (const step of sortedSteps) {
      if (elapsedMs >= step.afterMs) {
        rate = step.rate;
      } else {
        break;
      }
    }
    return rate;
  }

  if (loadShape.mode === 'burst') {
    const interval = loadShape.burstIntervalMs;
    const duration = loadShape.burstDurationMs;
    const multiplier = loadShape.burstMultiplier;
    if (!interval || !duration || !multiplier) {
      return baseArrivalRate;
    }

    const cyclePos = elapsedMs % interval;
    return cyclePos < duration ? baseArrivalRate * multiplier : baseArrivalRate;
  }

  if (loadShape.mode === 'jitter') {
    const ratio = loadShape.jitterRatio ?? 0.1;
    const jitter = (Math.random() * 2 - 1) * ratio;
    return Math.max(0.0001, baseArrivalRate * (1 + jitter));
  }

  return baseArrivalRate;
}

export function selectWeightedScenario(scenarios: WeightedScenario[]): WeightedScenario {
  const normalized = scenarios.map(s => ({ ...s, _weight: s.weight && s.weight > 0 ? s.weight : 1 }));
  const totalWeight = normalized.reduce((sum, s) => sum + s._weight, 0);
  const threshold = Math.random() * totalWeight;
  let running = 0;

  for (const scenario of normalized) {
    running += scenario._weight;
    if (threshold <= running) {
      return scenario;
    }
  }

  return normalized[normalized.length - 1];
}

export function resolveCoordinatedOmissionSettings(
  globalConfig: any,
  arrivalRate?: number
): CoordinatedOmissionSettings {
  const coConfig = globalConfig?.coordinatedOmission;
  if (!coConfig?.enabled) {
    return { enabled: false };
  }

  if (coConfig.expectedIntervalMs !== undefined && coConfig.expectedIntervalMs > 0) {
    return { enabled: true, expectedIntervalMs: coConfig.expectedIntervalMs };
  }

  if (arrivalRate !== undefined && arrivalRate > 0) {
    return { enabled: true, expectedIntervalMs: 1000 / arrivalRate };
  }

  return { enabled: false };
}
