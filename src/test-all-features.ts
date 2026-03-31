import { Glockit } from './index';
import { BenchmarkConfig } from './types';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';

async function runTests() {
  console.log('🧪 Starting Comprehensive Glockit Feature Test...');
  const mock = new MockAdapter(axios);

  // Setup Mock Responses
  // 1. Auth Endpoint
  mock.onPost('https://api.test.com/auth/login').reply(200, {
    token: 'test-auth-token-123',
    user: { id: 1, name: 'Test User' }
  }, { 'set-cookie': 'session=abc' });

  // 2. Data Endpoint (requires auth token and has variable extraction)
  mock.onGet('https://api.test.com/data').reply((config) => {
    if (config.headers?.Authorization === 'Bearer test-auth-token-123') {
      return [200, {
        items: [
          { id: 'item-1', status: 'active', value: 100 },
          { id: 'item-2', status: 'pending', value: 200 }
        ],
        meta: { total: 2 }
      }];
    }
    return [401, { error: 'Unauthorized' }];
  });

  // 3. Assertion Test Endpoint
  mock.onPost('https://api.test.com/assert').reply(200, {
    success: true,
    code: 200,
    message: 'Assertion passed'
  });

  // 4. Retry Test Endpoint (fails twice, then succeeds)
  let retryCount = 0;
  mock.onGet('https://api.test.com/retry').reply(() => {
    retryCount++;
    if (retryCount <= 2) {
      return [500, { error: 'Temporary Server Error' }];
    }
    return [200, { success: true }];
  });

  // 5. Response Check Endpoint
  mock.onGet('https://api.test.com/check').reply(200, {
    status: 'ok',
    data: { score: 85 }
  });

  // 6. Dynamic Variable Test Endpoint
  mock.onPost(/https:\/\/api\.test\.com\/dynamic\/.+/).reply((config: any) => {
    // console.log('DEBUG: mock dynamic called with data:', config.data);
    return [200, { received: typeof config.data === 'string' ? JSON.parse(config.data) : config.data }];
  });

  // Test Case 1: Constructor and Basic Run
  console.log('\n--- Test Case 1: Basic Run & Options ---');
  const glockit = new Glockit({ 
    progress: false, 
    delay: 10,
    headers: { 'X-Global-Header': 'Glockit' } 
  });

  // Interceptors test
  let requestIntercepted = false;
  glockit.addRequestInterceptor((config) => {
    requestIntercepted = true;
    return config;
  });

  const config: BenchmarkConfig = {
    name: 'Full Feature Test',
    global: {
      baseUrl: 'https://api.test.com',
      maxRequests: 1,
      concurrent: 1
    },
    endpoints: [
      {
        name: 'Auth',
        url: '/auth/login',
        method: 'POST',
        body: { email: 'test@test.com', password: 'password' },
        variables: [
          { name: 'token', path: 'token', from: 'response' },
          { name: 'session', path: 'session', from: 'cookies' }
        ]
      },
      {
        name: 'Get Data',
        url: '/data',
        method: 'GET',
        headers: { 'Authorization': 'Bearer {{token}}' },
        dependencies: ['Auth'],
        assertions: [
          { path: 'items.0.status', operator: 'equals', value: 'active' },
          { path: 'meta.total', operator: 'exists' }
        ],
        variables: [
          { name: 'firstItemId', path: 'items.0.id', from: 'response' }
        ]
      },
      {
        name: 'Assertions & Checks',
        url: '/check',
        method: 'GET',
        responseCheck: [
          { path: 'data.score', operator: 'equals', value: 85 }
        ],
        assertions: [
            { path: 'status', operator: 'contains', value: 'o' },
            { path: 'status', operator: 'matches', value: '^ok$' }
        ]
      },
      {
          name: 'Retry Test',
          url: '/retry',
          method: 'GET',
          retries: 2
      },
      {
          name: 'Dynamic Vars',
          url: '/dynamic/{{$uuid}}',
          method: 'POST',
          body: {
              word: '{{$randomWord}}',
              num: '{{$randomInt(1, 100)}}',
              pick: '{{$randomFrom(["a", "b", "c"])}}'
          }
      }
    ]
  };

  try {
    const result = await glockit.run(config);

    console.log('✅ Benchmark completed');
    console.log(`Total Requests: ${result.summary.totalRequests}`);
    console.log(`Successful: ${result.summary.totalSuccessful}`);
    console.log(`Failed: ${result.summary.totalFailed}`);

    // Verification
    const authResult = result.results.find(r => r.name === 'Auth');
    if (authResult?.successfulRequests === 1) console.log('✅ Auth endpoint passed');
    else console.error('❌ Auth endpoint failed');

    const dataResult = result.results.find(r => r.name === 'Get Data');
    if (dataResult?.successfulRequests === 1) console.log('✅ Data endpoint with dependencies and assertions passed');
    else console.error('❌ Data endpoint failed');

    const checkResult = result.results.find(r => r.name === 'Assertions & Checks');
    if (checkResult?.requestResults[0].responseCheckPassed) console.log('✅ Response check passed');
    else console.error('❌ Response check failed');

    const retryResult = result.results.find(r => r.name === 'Retry Test');
    if (retryResult?.successfulRequests === 1) console.log('✅ Retry mechanism worked');
    else console.error('❌ Retry mechanism failed');

    const dynamicResult = result.results.find(r => r.name === 'Dynamic Vars');
    if (dynamicResult?.successfulRequests === 1) {
        console.log('✅ Dynamic variables endpoint passed');
        const reqData = dynamicResult.requestResults[0].data.received;
        console.log(`   Sample Dynamic Data: ${JSON.stringify(reqData)}`);
    } else console.error('❌ Dynamic variables endpoint failed');

    if (requestIntercepted) console.log('✅ Request interceptor was called');
    else console.error('❌ Request interceptor NOT called');

    // Test Case 1.1: HTML Report Generation
    console.log('\n--- Test Case 1.1: HTML Report Generation ---');
    const jsonPath = './test-results.json';
    const csvPath = './test-results.csv';
    const htmlPath = './test-results.html';
    
    const fs = require('fs');
    await glockit.saveResults(result, jsonPath, csvPath, htmlPath);
    
    if (fs.existsSync(htmlPath)) {
        console.log('✅ HTML report generated successfully');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');
        if (htmlContent.includes('Glockit Benchmark Report') && htmlContent.includes('Auth')) {
            console.log('✅ HTML report content looks valid');
        } else {
            console.error('❌ HTML report content is invalid');
        }
        // Cleanup
        fs.unlinkSync(jsonPath);
        fs.unlinkSync(csvPath);
        fs.unlinkSync(htmlPath);
    } else {
        console.error('❌ HTML report NOT found');
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  }

  // Test Case 2: Auth Dependencies (Grouped)
  console.log('\n--- Test Case 2: Auth Dependencies (Grouped) ---');
  let authCallCount = 0;
  mock.onPost('https://api.test.com/auth/special').reply(() => {
      authCallCount++;
      return [200, { specialToken: 'secret-' + authCallCount }];
  });

  mock.onGet('https://api.test.com/secure-resource').reply((config) => {
      if (config.headers?.['X-Special']?.startsWith('secret-')) {
          return [200, { data: 'secure content' }];
      }
      return [403];
  });

  const authDepConfig: BenchmarkConfig = {
      endpoints: [
          {
              name: 'Resource A',
              url: 'https://api.test.com/secure-resource',
              method: 'GET',
              auth: {
                  name: 'GroupAlpha',
                  endpoints: [{
                      name: 'SpecialLogin',
                      url: 'https://api.test.com/auth/special',
                      method: 'POST',
                      variables: [{ name: 'sToken', path: 'specialToken', from: 'response' }]
                  }]
              },
              headers: { 'X-Special': '{{sToken}}' },
              maxRequests: 1
          },
          {
              name: 'Resource B',
              url: 'https://api.test.com/secure-resource',
              method: 'GET',
              auth: {
                  name: 'GroupAlpha', // Same group name
                  endpoints: [{
                      name: 'SpecialLogin',
                      url: 'https://api.test.com/auth/special',
                      method: 'POST',
                      variables: [{ name: 'sToken', path: 'specialToken', from: 'response' }]
                  }]
              },
              headers: { 'X-Special': '{{sToken}}' },
              maxRequests: 1
          }
      ]
  };

  const glockit2 = new Glockit({ progress: false });
  const result2 = await glockit2.run(authDepConfig);

  if (authCallCount === 1) console.log('✅ Auth dependency deduplication worked (called only once for group)');
  else console.error(`❌ Auth dependency deduplication failed (called ${authCallCount} times)`);

  if (result2.summary.totalSuccessful === 2) console.log('✅ Both resources using auth dependency succeeded');
  else console.error('❌ Auth dependency resource calls failed');

  // Test Case 3: Weights
  console.log('\n--- Test Case 3: Weighted Load Distribution ---');
  const weightConfig: BenchmarkConfig = {
      global: { maxRequests: 10 },
      endpoints: [
          { name: 'High Weight', url: 'https://api.test.com/check', method: 'GET', weight: 8 },
          { name: 'Low Weight', url: 'https://api.test.com/check', method: 'GET', weight: 2 }
      ]
  };
  const glockit3 = new Glockit({ progress: false });
  const result3 = await glockit3.run(weightConfig);

  const highWeightRes = result3.results.find(r => r.name === 'High Weight');
  const lowWeightRes = result3.results.find(r => r.name === 'Low Weight');

  console.log(`   High Weight Requests: ${highWeightRes?.totalRequests}`);
  console.log(`   Low Weight Requests: ${lowWeightRes?.totalRequests}`);

  if (highWeightRes && lowWeightRes && highWeightRes.totalRequests > lowWeightRes.totalRequests) {
      console.log('✅ Weight-based distribution worked');
  } else {
      console.error('❌ Weight-based distribution failed');
  }

  console.log('\n✨ All tests completed!');
}

runTests().catch(err => {
    console.error('Fatal Error:', err);
    process.exit(1);
});
