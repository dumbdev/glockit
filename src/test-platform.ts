import { NodePlatform } from './node-platform';
import { BrowserPlatform } from './browser-platform';
import { Glockit } from './index';
import * as fs from 'fs';
import chalk from 'chalk';

async function testPlatforms() {
    console.log(chalk.blue('🚀 Testing Platform Abstraction Layer...'));

    // 1. Test NodePlatform
    console.log('\n--- Testing NodePlatform ---');
    const nodePlatform = new NodePlatform();
    
    // Test size calculation
    const obj = { foo: 'bar', baz: 123 };
    const size = nodePlatform.getObjectSizeKB(obj);
    if (size > 0) {
        console.log(chalk.green('✅ NodePlatform: getObjectSizeKB works'));
    } else {
        console.error(chalk.red('❌ NodePlatform: getObjectSizeKB failed'));
    }

    // Test env var
    process.env.PLATFORM_TEST = 'active';
    if (nodePlatform.getEnvVar('PLATFORM_TEST') === 'active') {
        console.log(chalk.green('✅ NodePlatform: getEnvVar works'));
    } else {
        console.error(chalk.red('❌ NodePlatform: getEnvVar failed'));
    }

    // Test file saving
    const testResults: any = { summary: { totalRequests: 10 }, results: [] };
    const jsonPath = 'test-results-node.json';
    const csvPath = 'test-results-node.csv';
    const htmlPath = 'test-results-node.html';
    
    try {
        await nodePlatform.saveResults(testResults, jsonPath, csvPath);
        await nodePlatform.saveHtmlReport('<html><body>Test</body></html>', htmlPath);
        
        if (fs.existsSync(jsonPath) && fs.existsSync(csvPath) && fs.existsSync(htmlPath)) {
            console.log(chalk.green('✅ NodePlatform: saveResults and saveHtmlReport work'));
            try {
                fs.unlinkSync(jsonPath);
                fs.unlinkSync(csvPath);
                fs.unlinkSync(htmlPath);
            } catch (e) {}
        } else {
            console.error(chalk.red('❌ NodePlatform: file saving failed (files not found)'));
        }
    } catch (err) {
        console.error(chalk.red('❌ NodePlatform: file saving error:'), err);
    }

    // 2. Test BrowserPlatform (Simulated environment)
    console.log('\n--- Testing BrowserPlatform (Simulated) ---');
    
    // Mocking browser globals
    (global as any).TextEncoder = class {
        encode(str: string) { return Buffer.from(str); }
    };
    (global as any).performance = {
        now: () => Date.now()
    };
    (global as any).Blob = class {
        constructor(content: any[], options: any) { (this as any).content = content; (this as any).options = options; }
    };
    (global as any).URL = class {
        constructor(url: string) { (this as any).href = url; }
        static createObjectURL() { return 'blob:url'; }
        static revokeObjectURL() {}
    };
    (global as any).document = {
        createElement: (tag: string) => ({
            click: () => {},
            href: '',
            download: ''
        })
    };

    const browserPlatform = new BrowserPlatform();
    
    // Test size calculation
    const bSize = browserPlatform.getObjectSizeKB(obj);
    if (bSize > 0) {
        console.log(chalk.green('✅ BrowserPlatform: getObjectSizeKB works (simulated)'));
    } else {
        console.error(chalk.red('❌ BrowserPlatform: getObjectSizeKB failed'));
    }

    // Test now()
    if (typeof browserPlatform.now() === 'number') {
        console.log(chalk.green('✅ BrowserPlatform: now() works'));
    } else {
        console.error(chalk.red('❌ BrowserPlatform: now() failed'));
    }

    // 3. Test Glockit with custom platform
    console.log('\n--- Testing Glockit with custom platform ---');
    let logCalled = false;
    const customPlatform: any = {
        name: 'custom',
        getObjectSizeKB: () => 1,
        saveResults: async () => {},
        log: () => { logCalled = true; },
        error: () => {},
        getEnvVar: () => 'custom-val',
        now: () => Date.now(),
        saveHtmlReport: async () => {}
    };

    const bench = new Glockit({ platform: customPlatform, progress: false });
    const MockAdapter = require('axios-mock-adapter');
    const mock = new MockAdapter((bench as any).axiosInstance);
    mock.onGet('https://example.com/test').reply(200, {});

    await bench.run({
        endpoints: [{
            name: 'Test',
            url: 'https://example.com/test',
            method: 'GET',
            maxRequests: 1
        }]
    }, false);

    if (logCalled) {
        console.log(chalk.green('✅ Glockit: uses custom platform for logging'));
    } else {
        console.error(chalk.red('❌ Glockit: custom platform logging not called'));
    }

    console.log(chalk.blue('\n🏁 Platform Abstraction Layer Tests Completed!'));
}

testPlatforms().catch(err => {
    console.error(chalk.red('Test crashed:'), err);
    process.exit(1);
});
