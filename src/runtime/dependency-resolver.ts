import { EndpointConfig } from '../types';

export function resolveEndpointDependencies(endpoints: EndpointConfig[]): EndpointConfig[] {
  const resolved: EndpointConfig[] = [];
  const remaining = [...endpoints];

  while (remaining.length > 0) {
    const before = remaining.length;

    for (let i = remaining.length - 1; i >= 0; i--) {
      const endpoint = remaining[i];
      const dependencies = endpoint.dependencies || [];

      const allDepsResolved = dependencies.every(dep =>
        resolved.some(r => r.name === dep)
      );

      if (allDepsResolved) {
        resolved.push(endpoint);
        remaining.splice(i, 1);
      }
    }

    // Prevent infinite loop if there are circular dependencies.
    if (remaining.length === before) {
      console.warn('⚠️  Possible circular dependencies detected. Processing remaining endpoints in order.');
      resolved.push(...remaining);
      break;
    }
  }

  return resolved;
}
