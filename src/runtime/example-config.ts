import { BenchmarkConfig } from '../types';

export function getExampleBenchmarkConfig(): BenchmarkConfig {
  return {
    name: 'E-Commerce API Benchmark',
    global: {
      baseUrl: 'https://api.example.com/v1',
      maxRequests: 100,
      concurrent: 10,
      executor: 'concurrency',
      loadShape: {
        mode: 'step',
        steps: [
          { afterMs: 0, rate: 10 },
          { afterMs: 30000, rate: 25 },
          { afterMs: 60000, rate: 50 }
        ]
      },
      timeout: 5000,
      requestDelay: 100,
      dataFeeder: {
        path: './sample/users.json',
        format: 'json',
        strategy: 'sequential'
      },
      virtualUsers: {
        sessionScope: true,
        persistCookies: true
      },
      transactionGroups: [
        {
          name: 'browse-journey',
          endpoints: ['Get User Profile', 'Search Items']
        }
      ],
      phases: [
        { name: 'warmup', duration: 15000, concurrent: 2 },
        { name: 'ramp', duration: 30000, concurrent: 5, arrivalRate: 20 },
        { name: 'steady', duration: 60000, concurrent: 10, arrivalRate: 50 }
      ],
      summaryOnly: false,
      slo: {
        maxErrorRate: 0.02,
        p95Ms: 500
      },
      coordinatedOmission: {
        enabled: false,
        expectedIntervalMs: 20
      },
      observability: {
        prometheus: {
          enabled: true,
          host: '127.0.0.1',
          port: 9464,
          path: '/metrics',
          keepAlive: false
        },
        otel: {
          enabled: false,
          endpoint: 'http://localhost:4318/v1/metrics',
          serviceName: 'glockit-benchmark',
          traces: {
            enabled: false,
            endpoint: 'http://localhost:4318/v1/traces',
            samplingRatio: 1
          }
        }
      },
      reporters: [
        { type: 'json', path: './benchmark-latest.json' },
        { type: 'junit', path: './benchmark-latest.xml' }
      ],
      headers: {
        'Content-Type': 'application/json',
        'X-Environment': '{{$env.NODE_ENV}}'
      }
    },
    endpoints: [
      {
        name: 'Get User Profile',
        url: '/user/profile/{{$uuid}}',
        method: 'GET',
        weight: 8,
        auth: {
          name: 'UserAuth',
          endpoints: [
            {
              name: 'Login',
              url: '/auth/login',
              method: 'POST',
              body: {
                username: 'testuser',
                password: 'testpassword'
              },
              variables: [
                {
                  name: 'authToken',
                  path: 'token',
                  from: 'response'
                }
              ]
            }
          ]
        },
        headers: {
          Authorization: 'Bearer {{authToken}}'
        },
        query: {
          fields: 'id,name,email',
          timestamp: '{{$randomInt(1000000, 2000000)}}'
        },
        responseCheck: [
          {
            path: 'id',
            operator: 'exists'
          }
        ],
        assertions: [
          {
            path: 'status',
            operator: 'equals',
            value: 200
          }
        ],
        retries: 2,
        beforeRequest: "request.headers['X-Request-ID'] = 'req-' + Math.random().toString(36).substr(2, 9);"
      },
      {
        name: 'Search Items',
        url: '/items/search',
        method: 'GET',
        weight: 2,
        query: {
          q: "{{$randomFrom('phone', 'laptop', 'tablet')}}",
          limit: 10
        },
        afterRequest: "if (response.status === 200) { console.log('Search successful'); }"
      }
    ]
  };
}
