import { Glockit } from './index';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';

async function testAdvancedFeatures() {
    console.log(chalk.blue('🚀 Testing Advanced Features...'));
    const bench = new Glockit({ delay: 0, progress: false });
    const mock = new MockAdapter((bench as any).axiosInstance);

    // 1. Test Environment Variable Substitution
    process.env.TEST_API_KEY = 'secret-123';
    mock.onGet('http://api.example.com/test-env').reply((config) => {
        if (config.headers?.['Authorization'] === 'Bearer secret-123') {
            return [200, { success: true }];
        }
        return [401, { success: false }];
    });

    const envConfig = {
        endpoints: [{
            name: 'Env Var Test',
            url: 'http://api.example.com/test-env',
            method: 'GET' as const,
            headers: { 'Authorization': 'Bearer {{$env.TEST_API_KEY}}' },
            maxRequests: 1
        }]
    };
    
    console.log('--- Testing Environment Variables ---');
    const envResult = await bench.run(envConfig as any);
    if (envResult.summary.totalSuccessful === 1) {
        console.log(chalk.green('✅ Environment variable substitution passed'));
    } else {
        console.error(chalk.red('❌ Environment variable substitution failed'));
    }

    // 2. Test Pre/Post Request Hooks
    mock.onPost('http://api.example.com/hooks').reply((config) => {
        const body = JSON.parse(config.data);
        if (body.modifiedByHook && config.headers && config.headers['X-Hook-Header'] === 'Modified') {
            return [200, { original: body, status: 'ok' }];
        }
        return [400, { error: 'Hook didn\'t work' }];
    });

    const hookConfig = {
        endpoints: [{
            name: 'Hooks Test',
            url: 'http://api.example.com/hooks',
            method: 'POST' as const,
            body: { foo: 'bar' },
            beforeRequest: "request.body.modifiedByHook = true; request.headers['X-Hook-Header'] = 'Modified';",
            afterRequest: "response.data.intercepted = true; variables['hook_worked'] = true;",
            maxRequests: 1
        }]
    };

    console.log('--- Testing Pre/Post Request Hooks ---');
    const hookResult = await bench.run(hookConfig as any);
    const lastRequest = hookResult.results[0].requestResults[0];
    if (lastRequest.success && lastRequest.data.intercepted === true && (bench as any).variables.get('hook_worked')) {
        console.log(chalk.green('✅ Pre/Post Request hooks passed'));
    } else {
        console.error(chalk.red('❌ Pre/Post Request hooks failed'));
        console.log('Result data:', lastRequest.data);
    }

    // 3. Test Summary Mode (Memory Efficiency)
    mock.onGet('http://api.example.com/summary').reply(200, { data: 'some-large-data' });
    const summaryConfig = {
        global: {
            summaryOnly: true,
            maxRequests: 5
        },
        endpoints: [{
            name: 'Summary Test',
            url: 'http://api.example.com/summary',
            method: 'GET' as const
        }]
    };

    console.log('--- Testing Summary Mode ---');
    const summaryResult = await bench.run(summaryConfig as any);
    const endpointResult = summaryResult.results[0];
    if (endpointResult.requestResults.length === 0 && endpointResult.successfulRequests === 5) {
        console.log(chalk.green('✅ Summary mode passed (requestResults is empty, stats are correct)'));
    } else {
        console.error(chalk.red('❌ Summary mode failed'));
        console.log('Request results count:', endpointResult.requestResults.length);
        console.log('Successful requests:', endpointResult.successfulRequests);
    }

    console.log(chalk.blue('\n🏁 All Advanced Feature Tests Completed!'));
}

testAdvancedFeatures().catch(console.error);
