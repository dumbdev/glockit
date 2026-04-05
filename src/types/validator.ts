import { BenchmarkConfig } from './contracts';

export class ConfigValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConfigValidationError';
    }
}

export class ConfigValidator {
    static validate(config: any): BenchmarkConfig {
        if (!config || typeof config !== 'object') {
            throw new ConfigValidationError('Configuration must be a valid object');
        }

        if (!config.endpoints || !Array.isArray(config.endpoints)) {
            throw new ConfigValidationError('Configuration must have an "endpoints" array');
        }

        if (config.endpoints.length === 0) {
            throw new ConfigValidationError('At least one endpoint is required');
        }

        // Validate global config
        if (config.global) {
            this.validateGlobalConfig(config.global);
        }

        // Validate endpoints
        const endpointNames = new Set<string>();
        for (let i = 0; i < config.endpoints.length; i++) {
            const endpoint = config.endpoints[i];
            this.validateEndpoint(endpoint, i);

            if (endpointNames.has(endpoint.name)) {
                throw new ConfigValidationError(`Duplicate endpoint name: "${endpoint.name}"`);
            }
            endpointNames.add(endpoint.name);
        }

        // Validate dependencies
        this.validateDependencies(config.endpoints, endpointNames);

        if (config.global?.scenarioMix) {
            this.validateScenarioMix(config.global.scenarioMix, endpointNames);
        }

        if (config.global?.transactionGroups) {
            this.validateTransactionGroups(config.global.transactionGroups, endpointNames);
        }

        // Validate auth dependencies
        for (const endpoint of config.endpoints) {
            if (endpoint.auth) {
                this.validateAuthDependency(endpoint.auth, `Endpoint "${endpoint.name}" auth`);
            }
        }

        return config as BenchmarkConfig;
    }

    private static validateAuthDependency(auth: any, prefix: string): void {
        if (!auth || typeof auth !== 'object') {
            throw new ConfigValidationError(`${prefix}: Must be an object`);
        }
        if (!auth.name || typeof auth.name !== 'string') {
            throw new ConfigValidationError(`${prefix}: Must have a "name" string`);
        }
        if (!auth.endpoints || !Array.isArray(auth.endpoints)) {
            throw new ConfigValidationError(`${prefix}: Must have an "endpoints" array`);
        }
        auth.endpoints.forEach((endpoint: any, index: number) => {
            this.validateEndpoint(endpoint, `${prefix} endpoint ${index + 1}`);
        });
    }

    private static validateGlobalConfig(global: any): void {
        if (typeof global !== 'object') {
            throw new ConfigValidationError('Global config must be an object');
        }

        if (global.maxRequests !== undefined && (!Number.isInteger(global.maxRequests) || global.maxRequests <= 0)) {
            throw new ConfigValidationError('Global maxRequests must be a positive integer');
        }

        if (global.duration !== undefined && (!Number.isInteger(global.duration) || global.duration <= 0)) {
            throw new ConfigValidationError('Global duration must be a positive integer (milliseconds)');
        }

        if (global.throttle !== undefined && (!Number.isInteger(global.throttle) || global.throttle < 0)) {
            throw new ConfigValidationError('Global throttle must be a non-negative integer (milliseconds)');
        }

        if (global.concurrent !== undefined && (!Number.isInteger(global.concurrent) || global.concurrent <= 0)) {
            throw new ConfigValidationError('Global concurrent must be a positive integer');
        }

        if (global.timeout !== undefined && (!Number.isInteger(global.timeout) || global.timeout <= 0)) {
            throw new ConfigValidationError('Global timeout must be a positive integer (milliseconds)');
        }

        if (global.executor !== undefined && global.executor !== 'concurrency' && global.executor !== 'arrival-rate') {
            throw new ConfigValidationError('Global executor must be either "concurrency" or "arrival-rate"');
        }

        if (global.arrivalRate !== undefined && (typeof global.arrivalRate !== 'number' || global.arrivalRate <= 0)) {
            throw new ConfigValidationError('Global arrivalRate must be a positive number (requests/second)');
        }

        if (global.loadShape !== undefined) {
            this.validateLoadShape(global.loadShape, 'Global loadShape');
        }

        if (global.dataFeeder !== undefined) {
            if (!global.dataFeeder || typeof global.dataFeeder !== 'object') {
                throw new ConfigValidationError('Global dataFeeder must be an object');
            }

            if (!global.dataFeeder.path || typeof global.dataFeeder.path !== 'string') {
                throw new ConfigValidationError('Global dataFeeder.path must be a non-empty string');
            }

            if (!global.dataFeeder.format || !['json', 'csv'].includes(global.dataFeeder.format)) {
                throw new ConfigValidationError('Global dataFeeder.format must be either "json" or "csv"');
            }

            if (global.dataFeeder.strategy !== undefined && !['sequential', 'random'].includes(global.dataFeeder.strategy)) {
                throw new ConfigValidationError('Global dataFeeder.strategy must be either "sequential" or "random"');
            }
        }

        if (global.phases !== undefined) {
            if (!Array.isArray(global.phases) || global.phases.length === 0) {
                throw new ConfigValidationError('Global phases must be a non-empty array when provided');
            }

            for (let i = 0; i < global.phases.length; i++) {
                const phase = global.phases[i];
                const prefix = `Global phase ${i + 1}`;

                if (!phase || typeof phase !== 'object') {
                    throw new ConfigValidationError(`${prefix} must be an object`);
                }

                if (!phase.name || typeof phase.name !== 'string') {
                    throw new ConfigValidationError(`${prefix} must have a non-empty "name" string`);
                }

                if (!Number.isInteger(phase.duration) || phase.duration <= 0) {
                    throw new ConfigValidationError(`${prefix} duration must be a positive integer (milliseconds)`);
                }

                if (phase.concurrent !== undefined && (!Number.isInteger(phase.concurrent) || phase.concurrent <= 0)) {
                    throw new ConfigValidationError(`${prefix} concurrent must be a positive integer`);
                }

                if (phase.throttle !== undefined && (!Number.isInteger(phase.throttle) || phase.throttle < 0)) {
                    throw new ConfigValidationError(`${prefix} throttle must be a non-negative integer (milliseconds)`);
                }

                if (phase.requestDelay !== undefined && (!Number.isInteger(phase.requestDelay) || phase.requestDelay < 0)) {
                    throw new ConfigValidationError(`${prefix} requestDelay must be a non-negative integer (milliseconds)`);
                }

                if (phase.arrivalRate !== undefined && (typeof phase.arrivalRate !== 'number' || phase.arrivalRate <= 0)) {
                    throw new ConfigValidationError(`${prefix} arrivalRate must be a positive number (requests/second)`);
                }

                if (phase.loadShape !== undefined) {
                    this.validateLoadShape(phase.loadShape, `${prefix} loadShape`);
                }
            }
        }

        if (global.slo !== undefined) {
            if (!global.slo || typeof global.slo !== 'object') {
                throw new ConfigValidationError('Global slo must be an object');
            }

            if (global.slo.maxErrorRate !== undefined && (typeof global.slo.maxErrorRate !== 'number' || global.slo.maxErrorRate < 0 || global.slo.maxErrorRate > 1)) {
                throw new ConfigValidationError('Global slo.maxErrorRate must be a number between 0 and 1');
            }

            if (global.slo.maxAvgResponseTimeMs !== undefined && (typeof global.slo.maxAvgResponseTimeMs !== 'number' || global.slo.maxAvgResponseTimeMs < 0)) {
                throw new ConfigValidationError('Global slo.maxAvgResponseTimeMs must be a non-negative number');
            }

            if (global.slo.p95Ms !== undefined && (typeof global.slo.p95Ms !== 'number' || global.slo.p95Ms < 0)) {
                throw new ConfigValidationError('Global slo.p95Ms must be a non-negative number');
            }

            if (global.slo.p99Ms !== undefined && (typeof global.slo.p99Ms !== 'number' || global.slo.p99Ms < 0)) {
                throw new ConfigValidationError('Global slo.p99Ms must be a non-negative number');
            }

            if (global.slo.minRequestsPerSecond !== undefined && (typeof global.slo.minRequestsPerSecond !== 'number' || global.slo.minRequestsPerSecond < 0)) {
                throw new ConfigValidationError('Global slo.minRequestsPerSecond must be a non-negative number');
            }
        }

        if (global.coordinatedOmission !== undefined) {
            if (!global.coordinatedOmission || typeof global.coordinatedOmission !== 'object') {
                throw new ConfigValidationError('Global coordinatedOmission must be an object');
            }

            if (typeof global.coordinatedOmission.enabled !== 'boolean') {
                throw new ConfigValidationError('Global coordinatedOmission.enabled must be a boolean');
            }

            if (
                global.coordinatedOmission.expectedIntervalMs !== undefined &&
                (!Number.isFinite(global.coordinatedOmission.expectedIntervalMs) || global.coordinatedOmission.expectedIntervalMs <= 0)
            ) {
                throw new ConfigValidationError('Global coordinatedOmission.expectedIntervalMs must be a positive number');
            }
        }

        if (global.scenarioMix !== undefined) {
            const scenarioMix = global.scenarioMix;
            if (!scenarioMix || typeof scenarioMix !== 'object') {
                throw new ConfigValidationError('Global scenarioMix must be an object');
            }

            if (typeof scenarioMix.enabled !== 'boolean') {
                throw new ConfigValidationError('Global scenarioMix.enabled must be a boolean');
            }

            if (scenarioMix.strategy !== undefined && scenarioMix.strategy !== 'weighted-random') {
                throw new ConfigValidationError('Global scenarioMix.strategy must be "weighted-random"');
            }

            if (!Array.isArray(scenarioMix.scenarios) || scenarioMix.scenarios.length === 0) {
                throw new ConfigValidationError('Global scenarioMix.scenarios must be a non-empty array');
            }

            for (let i = 0; i < scenarioMix.scenarios.length; i++) {
                const scenario = scenarioMix.scenarios[i];
                const prefix = `Global scenarioMix scenario ${i + 1}`;

                if (!scenario || typeof scenario !== 'object') {
                    throw new ConfigValidationError(`${prefix} must be an object`);
                }

                if (!scenario.name || typeof scenario.name !== 'string') {
                    throw new ConfigValidationError(`${prefix} must have a non-empty "name" string`);
                }

                if (scenario.weight !== undefined && (!Number.isFinite(scenario.weight) || scenario.weight <= 0)) {
                    throw new ConfigValidationError(`${prefix} weight must be a positive number`);
                }

                if (!Array.isArray(scenario.flow) || scenario.flow.length === 0) {
                    throw new ConfigValidationError(`${prefix} flow must be a non-empty array of endpoint names`);
                }

                if (!scenario.flow.every((step: any) => typeof step === 'string' && step.trim().length > 0)) {
                    throw new ConfigValidationError(`${prefix} flow entries must be non-empty strings`);
                }
            }
        }

        if (global.virtualUsers !== undefined) {
            const vu = global.virtualUsers;
            if (!vu || typeof vu !== 'object') {
                throw new ConfigValidationError('Global virtualUsers must be an object');
            }

            if (vu.sessionScope !== undefined && typeof vu.sessionScope !== 'boolean') {
                throw new ConfigValidationError('Global virtualUsers.sessionScope must be a boolean');
            }

            if (vu.persistCookies !== undefined && typeof vu.persistCookies !== 'boolean') {
                throw new ConfigValidationError('Global virtualUsers.persistCookies must be a boolean');
            }
        }

        if (global.transactionGroups !== undefined) {
            if (!Array.isArray(global.transactionGroups) || global.transactionGroups.length === 0) {
                throw new ConfigValidationError('Global transactionGroups must be a non-empty array when provided');
            }

            for (let i = 0; i < global.transactionGroups.length; i++) {
                const group = global.transactionGroups[i];
                const prefix = `Global transactionGroups[${i}]`;

                if (!group || typeof group !== 'object') {
                    throw new ConfigValidationError(`${prefix} must be an object`);
                }

                if (!group.name || typeof group.name !== 'string') {
                    throw new ConfigValidationError(`${prefix}.name must be a non-empty string`);
                }

                if (!Array.isArray(group.endpoints) || group.endpoints.length === 0) {
                    throw new ConfigValidationError(`${prefix}.endpoints must be a non-empty array of endpoint names`);
                }

                if (!group.endpoints.every((value: any) => typeof value === 'string' && value.trim().length > 0)) {
                    throw new ConfigValidationError(`${prefix}.endpoints must contain non-empty string values`);
                }
            }
        }

        if (global.diagnostics !== undefined) {
            const diagnostics = global.diagnostics;
            if (!diagnostics || typeof diagnostics !== 'object') {
                throw new ConfigValidationError('Global diagnostics must be an object');
            }

            if (typeof diagnostics.enabled !== 'boolean') {
                throw new ConfigValidationError('Global diagnostics.enabled must be a boolean');
            }

            if (diagnostics.sampleSize !== undefined && (!Number.isInteger(diagnostics.sampleSize) || diagnostics.sampleSize <= 0)) {
                throw new ConfigValidationError('Global diagnostics.sampleSize must be a positive integer');
            }

            if (diagnostics.maskKeys !== undefined) {
                if (!Array.isArray(diagnostics.maskKeys) || !diagnostics.maskKeys.every((entry: any) => typeof entry === 'string' && entry.trim().length > 0)) {
                    throw new ConfigValidationError('Global diagnostics.maskKeys must be an array of non-empty strings');
                }
            }

            if (diagnostics.maxBodyLength !== undefined && (!Number.isInteger(diagnostics.maxBodyLength) || diagnostics.maxBodyLength <= 0)) {
                throw new ConfigValidationError('Global diagnostics.maxBodyLength must be a positive integer');
            }

            if (diagnostics.includeHeaders !== undefined && typeof diagnostics.includeHeaders !== 'boolean') {
                throw new ConfigValidationError('Global diagnostics.includeHeaders must be a boolean');
            }
        }

        if (global.observability !== undefined) {
            if (!global.observability || typeof global.observability !== 'object') {
                throw new ConfigValidationError('Global observability must be an object');
            }

            if (global.observability.prometheus !== undefined) {
                const prometheus = global.observability.prometheus;
                if (!prometheus || typeof prometheus !== 'object') {
                    throw new ConfigValidationError('Global observability.prometheus must be an object');
                }

                if (typeof prometheus.enabled !== 'boolean') {
                    throw new ConfigValidationError('Global observability.prometheus.enabled must be a boolean');
                }

                if (prometheus.host !== undefined && typeof prometheus.host !== 'string') {
                    throw new ConfigValidationError('Global observability.prometheus.host must be a string');
                }

                if (prometheus.port !== undefined && (!Number.isInteger(prometheus.port) || prometheus.port < 0 || prometheus.port > 65535)) {
                    throw new ConfigValidationError('Global observability.prometheus.port must be an integer between 0 and 65535');
                }

                if (prometheus.path !== undefined && (typeof prometheus.path !== 'string' || prometheus.path.trim() === '')) {
                    throw new ConfigValidationError('Global observability.prometheus.path must be a non-empty string');
                }

                if (prometheus.keepAlive !== undefined && typeof prometheus.keepAlive !== 'boolean') {
                    throw new ConfigValidationError('Global observability.prometheus.keepAlive must be a boolean');
                }
            }

            if (global.observability.otel !== undefined) {
                const otel = global.observability.otel;
                if (!otel || typeof otel !== 'object') {
                    throw new ConfigValidationError('Global observability.otel must be an object');
                }

                if (typeof otel.enabled !== 'boolean') {
                    throw new ConfigValidationError('Global observability.otel.enabled must be a boolean');
                }

                if (otel.endpoint !== undefined && typeof otel.endpoint !== 'string') {
                    throw new ConfigValidationError('Global observability.otel.endpoint must be a string');
                }

                if (otel.headers !== undefined && (typeof otel.headers !== 'object' || Array.isArray(otel.headers))) {
                    throw new ConfigValidationError('Global observability.otel.headers must be an object');
                }

                if (otel.intervalMs !== undefined && (!Number.isInteger(otel.intervalMs) || otel.intervalMs <= 0)) {
                    throw new ConfigValidationError('Global observability.otel.intervalMs must be a positive integer');
                }

                if (otel.serviceName !== undefined && typeof otel.serviceName !== 'string') {
                    throw new ConfigValidationError('Global observability.otel.serviceName must be a string');
                }

                if (otel.attributes !== undefined && (typeof otel.attributes !== 'object' || Array.isArray(otel.attributes))) {
                    throw new ConfigValidationError('Global observability.otel.attributes must be an object');
                }

                if (otel.traces !== undefined) {
                    const traces = otel.traces;
                    if (!traces || typeof traces !== 'object') {
                        throw new ConfigValidationError('Global observability.otel.traces must be an object');
                    }

                    if (typeof traces.enabled !== 'boolean') {
                        throw new ConfigValidationError('Global observability.otel.traces.enabled must be a boolean');
                    }

                    if (traces.endpoint !== undefined && typeof traces.endpoint !== 'string') {
                        throw new ConfigValidationError('Global observability.otel.traces.endpoint must be a string');
                    }

                    if (traces.headers !== undefined && (typeof traces.headers !== 'object' || Array.isArray(traces.headers))) {
                        throw new ConfigValidationError('Global observability.otel.traces.headers must be an object');
                    }

                    if (traces.serviceName !== undefined && typeof traces.serviceName !== 'string') {
                        throw new ConfigValidationError('Global observability.otel.traces.serviceName must be a string');
                    }

                    if (traces.attributes !== undefined && (typeof traces.attributes !== 'object' || Array.isArray(traces.attributes))) {
                        throw new ConfigValidationError('Global observability.otel.traces.attributes must be an object');
                    }

                    if (traces.samplingRatio !== undefined && (typeof traces.samplingRatio !== 'number' || traces.samplingRatio < 0 || traces.samplingRatio > 1)) {
                        throw new ConfigValidationError('Global observability.otel.traces.samplingRatio must be a number between 0 and 1');
                    }
                }
            }
        }

        if (global.reporters !== undefined) {
            if (!Array.isArray(global.reporters) || global.reporters.length === 0) {
                throw new ConfigValidationError('Global reporters must be a non-empty array when provided');
            }

            for (let i = 0; i < global.reporters.length; i++) {
                const reporter = global.reporters[i];
                const prefix = `Global reporters[${i}]`;

                if (!reporter || typeof reporter !== 'object') {
                    throw new ConfigValidationError(`${prefix} must be an object`);
                }

                if (typeof reporter.type !== 'string' || reporter.type.trim() === '') {
                    throw new ConfigValidationError(`${prefix}.type must be a non-empty string`);
                }

                if (reporter.path !== undefined && (typeof reporter.path !== 'string' || reporter.path.trim() === '')) {
                    throw new ConfigValidationError(`${prefix}.path must be a non-empty string when provided`);
                }

                if (reporter.options !== undefined && (typeof reporter.options !== 'object' || Array.isArray(reporter.options))) {
                    throw new ConfigValidationError(`${prefix}.options must be an object when provided`);
                }
            }
        }

        if (global.distributed !== undefined) {
            const distributed = global.distributed;
            if (!distributed || typeof distributed !== 'object') {
                throw new ConfigValidationError('Global distributed must be an object');
            }

            if (typeof distributed.enabled !== 'boolean') {
                throw new ConfigValidationError('Global distributed.enabled must be a boolean');
            }

            if (distributed.role !== 'coordinator' && distributed.role !== 'worker') {
                throw new ConfigValidationError('Global distributed.role must be either "coordinator" or "worker"');
            }

            if (distributed.coordinatorUrl !== undefined && (typeof distributed.coordinatorUrl !== 'string' || distributed.coordinatorUrl.trim() === '')) {
                throw new ConfigValidationError('Global distributed.coordinatorUrl must be a non-empty string when provided');
            }

            if (distributed.workerId !== undefined && (typeof distributed.workerId !== 'string' || distributed.workerId.trim() === '')) {
                throw new ConfigValidationError('Global distributed.workerId must be a non-empty string when provided');
            }

            if (distributed.expectedWorkers !== undefined && (!Number.isInteger(distributed.expectedWorkers) || distributed.expectedWorkers <= 0)) {
                throw new ConfigValidationError('Global distributed.expectedWorkers must be a positive integer when provided');
            }

            if (distributed.host !== undefined && (typeof distributed.host !== 'string' || distributed.host.trim() === '')) {
                throw new ConfigValidationError('Global distributed.host must be a non-empty string when provided');
            }

            if (distributed.port !== undefined && (!Number.isInteger(distributed.port) || distributed.port < 0 || distributed.port > 65535)) {
                throw new ConfigValidationError('Global distributed.port must be an integer between 0 and 65535 when provided');
            }

            if (distributed.joinTimeoutMs !== undefined && (!Number.isInteger(distributed.joinTimeoutMs) || distributed.joinTimeoutMs <= 0)) {
                throw new ConfigValidationError('Global distributed.joinTimeoutMs must be a positive integer when provided');
            }

            if (distributed.resultTimeoutMs !== undefined && (!Number.isInteger(distributed.resultTimeoutMs) || distributed.resultTimeoutMs <= 0)) {
                throw new ConfigValidationError('Global distributed.resultTimeoutMs must be a positive integer when provided');
            }

            if (distributed.pollIntervalMs !== undefined && (!Number.isInteger(distributed.pollIntervalMs) || distributed.pollIntervalMs <= 0)) {
                throw new ConfigValidationError('Global distributed.pollIntervalMs must be a positive integer when provided');
            }

            if (distributed.heartbeatIntervalMs !== undefined && (!Number.isInteger(distributed.heartbeatIntervalMs) || distributed.heartbeatIntervalMs <= 0)) {
                throw new ConfigValidationError('Global distributed.heartbeatIntervalMs must be a positive integer when provided');
            }

            if (distributed.staleWorkerTimeoutMs !== undefined && (!Number.isInteger(distributed.staleWorkerTimeoutMs) || distributed.staleWorkerTimeoutMs <= 0)) {
                throw new ConfigValidationError('Global distributed.staleWorkerTimeoutMs must be a positive integer when provided');
            }

            if (distributed.authToken !== undefined && (typeof distributed.authToken !== 'string' || distributed.authToken.trim() === '')) {
                throw new ConfigValidationError('Global distributed.authToken must be a non-empty string when provided');
            }

            if (distributed.authHeaderName !== undefined && (typeof distributed.authHeaderName !== 'string' || distributed.authHeaderName.trim() === '')) {
                throw new ConfigValidationError('Global distributed.authHeaderName must be a non-empty string when provided');
            }

            if (distributed.resultSubmitRetries !== undefined && (!Number.isInteger(distributed.resultSubmitRetries) || distributed.resultSubmitRetries < 0)) {
                throw new ConfigValidationError('Global distributed.resultSubmitRetries must be a non-negative integer when provided');
            }

            if (distributed.resultSubmitBackoffMs !== undefined && (!Number.isInteger(distributed.resultSubmitBackoffMs) || distributed.resultSubmitBackoffMs <= 0)) {
                throw new ConfigValidationError('Global distributed.resultSubmitBackoffMs must be a positive integer when provided');
            }

            if (distributed.leaseBatchSize !== undefined && (!Number.isInteger(distributed.leaseBatchSize) || distributed.leaseBatchSize <= 0)) {
                throw new ConfigValidationError('Global distributed.leaseBatchSize must be a positive integer when provided');
            }

            if (
                distributed.maxInFlightLeasedEndpointsPerWorker !== undefined &&
                (!Number.isInteger(distributed.maxInFlightLeasedEndpointsPerWorker) || distributed.maxInFlightLeasedEndpointsPerWorker <= 0)
            ) {
                throw new ConfigValidationError('Global distributed.maxInFlightLeasedEndpointsPerWorker must be a positive integer when provided');
            }

            if (
                distributed.assignmentStrategy !== undefined &&
                distributed.assignmentStrategy !== 'round-robin' &&
                distributed.assignmentStrategy !== 'least-loaded'
            ) {
                throw new ConfigValidationError('Global distributed.assignmentStrategy must be either "round-robin" or "least-loaded" when provided');
            }

            if (distributed.partitionStrategy !== undefined && distributed.partitionStrategy !== 'round-robin') {
                throw new ConfigValidationError('Global distributed.partitionStrategy must be "round-robin" when provided');
            }

            if (distributed.enabled && distributed.role === 'worker' && !distributed.coordinatorUrl) {
                throw new ConfigValidationError('Global distributed.coordinatorUrl is required when distributed.role is "worker"');
            }

            if (distributed.enabled && distributed.role === 'coordinator' && distributed.expectedWorkers === undefined) {
                throw new ConfigValidationError('Global distributed.expectedWorkers is required when distributed.role is "coordinator"');
            }
        }
    }

    private static validateEndpoint(endpoint: any, index: number | string): void {
        const prefix = typeof index === 'number' ? `Endpoint ${index + 1}` : index;

        if (!endpoint || typeof endpoint !== 'object') {
            throw new ConfigValidationError(`${prefix}: Must be an object`);
        }

        if (!endpoint.name || typeof endpoint.name !== 'string' || endpoint.name.trim() === '') {
            throw new ConfigValidationError(`${prefix}: Must have a non-empty "name" string`);
        }

        if (!endpoint.url || typeof endpoint.url !== 'string') {
            throw new ConfigValidationError(`${prefix}: Must have a valid "url" string`);
        }

        // Accept absolute URLs and relative URLs starting with '/'
        const urlWithPlaceholders = endpoint.url.replace(/{{[^}]+}}/g, 'placeholder');
        const validTransports = ['http', 'websocket', 'grpc'];
        if (endpoint.transport !== undefined && !validTransports.includes(endpoint.transport)) {
            throw new ConfigValidationError(`${prefix}: transport must be one of: ${validTransports.join(', ')}`);
        }

        const transport = endpoint.transport || 'http';
        const isHttpAbsolute = /^https?:\/\//i.test(urlWithPlaceholders);
        const isWebSocketAbsolute = /^wss?:\/\//i.test(urlWithPlaceholders);
        const isAbsolute = isHttpAbsolute || isWebSocketAbsolute;
        const isRelative = /^\//.test(urlWithPlaceholders);

        if (transport !== 'grpc') {
            if (!isAbsolute && !isRelative) {
                throw new ConfigValidationError(`${prefix}: URL "${endpoint.url}" must be absolute (http...) or relative (starting with /). Variables like {{var}} are allowed.`);
            }
            // Optionally, check absolute URLs with URL constructor
            if (isAbsolute) {
                try {
                    new URL(urlWithPlaceholders);
                } catch (e) {
                    throw new ConfigValidationError(`${prefix}: Absolute URL "${endpoint.url}" is not valid (variables like {{var}} are allowed)`);
                }
            }
        }

        const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
        if (!endpoint.method || !validMethods.includes(endpoint.method)) {
            throw new ConfigValidationError(`${prefix}: Method must be one of: ${validMethods.join(', ')}`);
        }

        if (transport === 'websocket' && !/^wss?:\/\//i.test(urlWithPlaceholders)) {
            throw new ConfigValidationError(`${prefix}: websocket transport requires an absolute ws:// or wss:// URL`);
        }

        if (transport === 'grpc') {
            if (!endpoint.grpc || typeof endpoint.grpc !== 'object') {
                throw new ConfigValidationError(`${prefix}: grpc config is required when transport is "grpc"`);
            }

            if (typeof endpoint.grpc.protoPath !== 'string' || endpoint.grpc.protoPath.trim() === '') {
                throw new ConfigValidationError(`${prefix}: grpc.protoPath must be a non-empty string`);
            }

            if (endpoint.grpc.package !== undefined && (typeof endpoint.grpc.package !== 'string' || endpoint.grpc.package.trim() === '')) {
                throw new ConfigValidationError(`${prefix}: grpc.package must be a non-empty string when provided`);
            }

            if (typeof endpoint.grpc.service !== 'string' || endpoint.grpc.service.trim() === '') {
                throw new ConfigValidationError(`${prefix}: grpc.service must be a non-empty string`);
            }

            if (typeof endpoint.grpc.method !== 'string' || endpoint.grpc.method.trim() === '') {
                throw new ConfigValidationError(`${prefix}: grpc.method must be a non-empty string`);
            }

            if (endpoint.grpc.metadata !== undefined && (typeof endpoint.grpc.metadata !== 'object' || Array.isArray(endpoint.grpc.metadata))) {
                throw new ConfigValidationError(`${prefix}: grpc.metadata must be an object when provided`);
            }

            if (endpoint.grpc.useTls !== undefined && typeof endpoint.grpc.useTls !== 'boolean') {
                throw new ConfigValidationError(`${prefix}: grpc.useTls must be a boolean when provided`);
            }
        }

        if (endpoint.websocket !== undefined) {
            if (!endpoint.websocket || typeof endpoint.websocket !== 'object' || Array.isArray(endpoint.websocket)) {
                throw new ConfigValidationError(`${prefix}: websocket must be an object when provided`);
            }

            if (endpoint.websocket.subprotocol !== undefined && (typeof endpoint.websocket.subprotocol !== 'string' || endpoint.websocket.subprotocol.trim() === '')) {
                throw new ConfigValidationError(`${prefix}: websocket.subprotocol must be a non-empty string when provided`);
            }

            if (endpoint.websocket.responseTimeoutMs !== undefined && (!Number.isInteger(endpoint.websocket.responseTimeoutMs) || endpoint.websocket.responseTimeoutMs <= 0)) {
                throw new ConfigValidationError(`${prefix}: websocket.responseTimeoutMs must be a positive integer when provided`);
            }
        }

        if (endpoint.headers && typeof endpoint.headers !== 'object') {
            throw new ConfigValidationError(`${prefix}: Headers must be an object`);
        }

        if (endpoint.maxRequests !== undefined && (!Number.isInteger(endpoint.maxRequests) || endpoint.maxRequests <= 0)) {
            throw new ConfigValidationError(`${prefix}: maxRequests must be a positive integer`);
        }

        if (endpoint.throttle !== undefined && (!Number.isInteger(endpoint.throttle) || endpoint.throttle < 0)) {
            throw new ConfigValidationError(`${prefix}: throttle must be a non-negative integer (milliseconds)`);
        }

        if (endpoint.query && typeof endpoint.query !== 'object') {
            throw new ConfigValidationError(`${prefix}: Query must be an object`);
        }

        if (endpoint.weight !== undefined && (!Number.isFinite(endpoint.weight) || endpoint.weight <= 0)) {
            throw new ConfigValidationError(`${prefix}: weight must be a positive number`);
        }

        if (endpoint.retries !== undefined && (!Number.isInteger(endpoint.retries) || endpoint.retries < 0)) {
            throw new ConfigValidationError(`${prefix}: retries must be a non-negative integer`);
        }

        if (endpoint.beforeRequest !== undefined && typeof endpoint.beforeRequest !== 'string') {
            throw new ConfigValidationError(`${prefix}: beforeRequest must be a string`);
        }

        if (endpoint.afterRequest !== undefined && typeof endpoint.afterRequest !== 'string') {
            throw new ConfigValidationError(`${prefix}: afterRequest must be a string`);
        }

        if (endpoint.assertions) {
            if (!Array.isArray(endpoint.assertions)) {
                throw new ConfigValidationError(`${prefix}: assertions must be an array`);
            }
            endpoint.assertions.forEach((assertion: any, aIndex: number) => {
                this.validateAssertion(assertion, `${prefix}, assertion ${aIndex + 1}`);
            });
        }

        if (endpoint.responseCheck) {
            if (!Array.isArray(endpoint.responseCheck)) {
                throw new ConfigValidationError(`${prefix}: responseCheck must be an array`);
            }
            endpoint.responseCheck.forEach((check: any, cIndex: number) => {
                this.validateResponseCheck(check, `${prefix}, responseCheck ${cIndex + 1}`);
            });
        }

        if (endpoint.variables) {
            if (!Array.isArray(endpoint.variables)) {
                throw new ConfigValidationError(`${prefix}: variables must be an array`);
            }
            endpoint.variables.forEach((variable: any, vIndex: number) => {
                this.validateVariableExtraction(variable, `${prefix}, variable ${vIndex + 1}`);
            });
        }

        if (endpoint.dependencies) {
            if (!Array.isArray(endpoint.dependencies)) {
                throw new ConfigValidationError(`${prefix}: dependencies must be an array`);
            }
            if (!endpoint.dependencies.every((dep: any) => typeof dep === 'string')) {
                throw new ConfigValidationError(`${prefix}: all dependencies must be strings`);
            }
        }
    }

    private static validateAssertion(assertion: any, prefix: string): void {
        if (!assertion || typeof assertion !== 'object') {
            throw new ConfigValidationError(`${prefix}: Must be an object`);
        }

        if (!assertion.path || typeof assertion.path !== 'string') {
            throw new ConfigValidationError(`${prefix}: Must have a "path" string`);
        }

        const validOperators = ['equals', 'contains', 'exists', 'matches'];
        if (!assertion.operator || !validOperators.includes(assertion.operator)) {
            throw new ConfigValidationError(`${prefix}: operator must be one of: ${validOperators.join(', ')}`);
        }
    }

    private static validateResponseCheck(check: any, prefix: string): void {
        if (!check || typeof check !== 'object') {
            throw new ConfigValidationError(`${prefix}: Must be an object`);
        }

        if (!check.path || typeof check.path !== 'string') {
            throw new ConfigValidationError(`${prefix}: Must have a "path" string`);
        }

        const validOperators = ['equals', 'contains', 'exists', 'matches'];
        if (!check.operator || !validOperators.includes(check.operator)) {
            throw new ConfigValidationError(`${prefix}: operator must be one of: ${validOperators.join(', ')}`);
        }
    }

    private static validateVariableExtraction(variable: any, prefix: string): void {
        if (!variable || typeof variable !== 'object') {
            throw new ConfigValidationError(`${prefix}: Must be an object`);
        }

        if (!variable.name || typeof variable.name !== 'string' || variable.name.trim() === '') {
            throw new ConfigValidationError(`${prefix}: Must have a non-empty "name" string`);
        }

        if (!variable.path || typeof variable.path !== 'string' || variable.path.trim() === '') {
            throw new ConfigValidationError(`${prefix}: Must have a non-empty "path" string`);
        }

        if (!variable.from || !['response', 'headers', 'cookies'].includes(variable.from)) {
            throw new ConfigValidationError(`${prefix}: "from" must be one of "response", "headers", or "cookies"`);
        }
    }

    private static validateDependencies(endpoints: any[], endpointNames: Set<string>): void {
        for (const endpoint of endpoints) {
            if (endpoint.dependencies) {
                for (const dep of endpoint.dependencies) {
                    if (!endpointNames.has(dep)) {
                        throw new ConfigValidationError(`Endpoint "${endpoint.name}" depends on "${dep}" which doesn't exist`);
                    }
                    if (dep === endpoint.name) {
                        throw new ConfigValidationError(`Endpoint "${endpoint.name}" cannot depend on itself`);
                    }
                }
            }
        }
    }

    private static validateScenarioMix(scenarioMix: any, endpointNames: Set<string>): void {
        if (!scenarioMix?.enabled) {
            return;
        }

        for (const scenario of scenarioMix.scenarios || []) {
            for (const endpointName of scenario.flow || []) {
                if (!endpointNames.has(endpointName)) {
                    throw new ConfigValidationError(`Scenario "${scenario.name}" references unknown endpoint "${endpointName}"`);
                }
            }
        }
    }

    private static validateTransactionGroups(transactionGroups: any[], endpointNames: Set<string>): void {
        for (const group of transactionGroups) {
            for (const endpointName of group.endpoints || []) {
                if (!endpointNames.has(endpointName)) {
                    throw new ConfigValidationError(`Transaction group "${group.name}" references unknown endpoint "${endpointName}"`);
                }
            }
        }
    }

    private static validateLoadShape(loadShape: any, prefix: string): void {
        if (!loadShape || typeof loadShape !== 'object') {
            throw new ConfigValidationError(`${prefix} must be an object`);
        }

        if (!['step', 'burst', 'jitter'].includes(loadShape.mode)) {
            throw new ConfigValidationError(`${prefix}.mode must be one of: step, burst, jitter`);
        }

        if (loadShape.mode === 'step') {
            if (!Array.isArray(loadShape.steps) || loadShape.steps.length === 0) {
                throw new ConfigValidationError(`${prefix}.steps must be a non-empty array when mode=step`);
            }

            for (let i = 0; i < loadShape.steps.length; i++) {
                const step = loadShape.steps[i];
                if (!step || typeof step !== 'object') {
                    throw new ConfigValidationError(`${prefix}.steps[${i}] must be an object`);
                }

                if (!Number.isFinite(step.afterMs) || step.afterMs < 0) {
                    throw new ConfigValidationError(`${prefix}.steps[${i}].afterMs must be a non-negative number`);
                }

                if (!Number.isFinite(step.rate) || step.rate <= 0) {
                    throw new ConfigValidationError(`${prefix}.steps[${i}].rate must be a positive number`);
                }
            }
        }

        if (loadShape.mode === 'burst') {
            if (!Number.isFinite(loadShape.burstIntervalMs) || loadShape.burstIntervalMs <= 0) {
                throw new ConfigValidationError(`${prefix}.burstIntervalMs must be a positive number when mode=burst`);
            }

            if (!Number.isFinite(loadShape.burstDurationMs) || loadShape.burstDurationMs <= 0) {
                throw new ConfigValidationError(`${prefix}.burstDurationMs must be a positive number when mode=burst`);
            }

            if (!Number.isFinite(loadShape.burstMultiplier) || loadShape.burstMultiplier <= 0) {
                throw new ConfigValidationError(`${prefix}.burstMultiplier must be a positive number when mode=burst`);
            }
        }

        if (loadShape.mode === 'jitter') {
            const ratio = loadShape.jitterRatio ?? 0.1;
            if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
                throw new ConfigValidationError(`${prefix}.jitterRatio must be a number between 0 and 1 when mode=jitter`);
            }
        }
    }
}
