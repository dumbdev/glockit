import { BarbariansBench } from '../src';
import * as http from 'http';

// Simple mock server for demonstration
function createMockServer() {
    let userIdCounter = 1;
    const users = new Map();

    const server = http.createServer((req, res) => {
        const { method, url } = req;
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            res.setHeader('Content-Type', 'application/json');

            // Simulate authentication
            if (req.headers.authorization !== 'Bearer test-token-123') {
                res.statusCode = 401;
                return res.end(JSON.stringify({ error: 'Unauthorized' }));
            }

            // Handle different endpoints
            if (method === 'POST' && url === '/users') {
                const user = {
                    id: `user-${userIdCounter++}`,
                    ...JSON.parse(body)
                };
                users.set(user.id, user);

                // Set auth token in headers
                res.setHeader('X-Auth-Token', 'test-token-123');
                res.statusCode = 201;
                return res.end(JSON.stringify(user));
            }

            if (method === 'GET' && url?.startsWith('/users/')) {
                const userId = url.split('/')[2];
                const user = users.get(userId);

                if (!user) {
                    res.statusCode = 404;
                    return res.end(JSON.stringify({ error: 'User not found' }));
                }

                return res.end(JSON.stringify(user));
            }

            if (method === 'PUT' && url?.startsWith('/users/') && url.endsWith('/permissions')) {
                const userId = url.split('/')[2];
                const user = users.get(userId);

                if (!user) {
                    res.statusCode = 404;
                    return res.end(JSON.stringify({ error: 'User not found' }));
                }

                const { permissions } = JSON.parse(body);
                user.permissions = permissions;
                users.set(userId, user);

                return res.end(JSON.stringify({
                    success: true,
                    message: 'Permissions updated',
                    user
                }));
            }

            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Not found' }));
        });
    });

    return server;
}

// Example: Request Chaining with BarbariansBench
async function runChainingExample() {
    // Start mock server
    const server = createMockServer();
    await new Promise<void>((resolve) => {
      server.listen(3000, () => {
        console.log('Mock server running on http://localhost:3000');
        resolve();
      });
    });

    try {
        const benchmark = new BarbariansBench();

        // Configuration for the benchmark
        const config = {
            name: 'User API Flow with Chaining',
            endpoints: [
                // First request: Create a new user
                {
                    name: 'Create User',
                    url: 'http://localhost:3000/users',
                    method: 'POST' as const,  // Using 'as const' to ensure type safety
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: {
                        name: 'John Doe',
                        email: 'john.doe@example.com',
                        role: 'developer'
                    },
                    // Extract the user ID and auth token
                    variables: [
                        {
                            name: 'userId',
                            path: 'id',
                            from: 'response'
                        },
                        {
                            name: 'authToken',
                            path: 'X-Auth-Token',
                            from: 'headers'
                        }
                    ]
                },
                // Second request: Get user details using the extracted userId
                {
                    name: 'Get User',
                    url: 'http://localhost:3000/users/{{userId}}',
                    method: 'GET' as const,  // Using 'as const' to ensure type safety
                    headers: {
                        Authorization: 'Bearer {{authToken}}'
                    },
                    dependencies: ['Create User']
                },
                // Third request: Update user permissions
                {
                    name: 'Update Permissions',
                    url: 'http://localhost:3000/users/{{userId}}/permissions',
                    method: 'PUT' as const,  // Using 'as const' to ensure type safety
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer {{authToken}}'
                    },
                    body: {
                        permissions: ['read', 'write']
                    },
                    dependencies: ['Get User']
                }
            ],
            global: {
                maxRequests: 1,  // Run the flow once for demonstration
                concurrent: 1,   // Run requests sequentially
                timeout: 5000    // 5 second timeout per request
            }
        };

        console.log('🚀 Starting benchmark with request chaining...');
        const results = await benchmark.run(config);

        console.log('\n📊 Benchmark Results:');
        console.log(`Total duration: ${(results.summary.totalDuration / 1000).toFixed(2)}s`);
        console.log(`Total requests: ${results.summary.totalRequests}`);
        console.log(`Success rate: ${((results.summary.totalSuccessful / results.summary.totalRequests) * 100).toFixed(2)}%`);

        console.log('\n🔍 Endpoint Details:');
        results.results.forEach(result => {
            console.log(`\n${result.name} (${result.url}):`);
            console.log(`  Status: ${result.failedRequests > 0 ? '❌ Failed' : '✅ Succeeded'}`);
            console.log(`  Requests: ${result.totalRequests} (${result.successfulRequests} successful, ${result.failedRequests} failed)`);
            console.log(`  Avg. Response Time: ${result.averageResponseTime.toFixed(2)}ms`);
        });

        return results;
    } finally {
        // Clean up
        server.close();
    }
}

// Run the example
runChainingExample()
.then(() => console.log('\n✅ Example completed!'))
.catch(console.error);
