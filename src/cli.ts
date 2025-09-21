#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { Glockit } from './index';
import { BenchmarkConfig, ConfigValidator, ConfigValidationError } from './types';
import * as fs from 'fs';
import * as path from 'path';

const program = new Command();

program
  .name('glockit')
  .description('A tool to benchmark REST APIs with request chaining capabilities')
  .version('1.0.0');

program
  .command('run')
  .description('Run benchmark from configuration file')
  .option('-c, --config <file>', 'Configuration file path (JSON)', 'benchmark.json')
  .option('-o, --output <dir>', 'Output directory for results (only used with --save, defaults to current directory)')
  .option('--no-progress', 'Disable progress bar and use simple console output', false)
  .option('-d, --delay <ms>', 'Delay between requests in milliseconds', '0')
  .option('--save', 'Save results to files in the current directory', false)
  .action(async (options) => {
    try {
      console.log(chalk.blue('🔥 Glockit Starting...'));
      
      // Check if config file exists
      if (!fs.existsSync(options.config)) {
        console.error(chalk.red(`❌ Configuration file not found: ${options.config}`));
        console.log(chalk.yellow('💡 Create a benchmark.json file with your API endpoints configuration.'));
        process.exit(1);
      }

      // Load and validate configuration
      const configData = fs.readFileSync(options.config, 'utf8');
      let parsedConfig;
      try {
        parsedConfig = JSON.parse(configData);
      } catch (parseError) {
        console.error(chalk.red('❌ Invalid JSON in configuration file:'));
        console.error(chalk.red(parseError instanceof Error ? parseError.message : 'Unknown JSON parsing error'));
        process.exit(1);
      }
      
      let config: BenchmarkConfig;
      try {
        config = ConfigValidator.validate(parsedConfig);
      } catch (validationError) {
        if (validationError instanceof ConfigValidationError) {
          console.error(chalk.red('❌ Configuration validation failed:'));
          console.error(chalk.red(validationError.message));
          console.log(chalk.yellow('\n💡 Use "glockit example" to generate a valid configuration template.'));
        } else {
          console.error(chalk.red('❌ Unexpected validation error:'), validationError);
        }
        process.exit(1);
      }
      
      // Create output directory
      if (!fs.existsSync(options.output)) {
        fs.mkdirSync(options.output, { recursive: true });
      }

      console.log(chalk.green(`📋 Configuration loaded: ${config.endpoints.length} endpoints`));
      
      // Parse delay
      const delay = parseInt(options.delay, 10) || 0;
      if (delay > 0) {
        console.log(chalk.yellow(`⏳ Adding ${delay}ms delay between requests`));
      }

      // Run benchmark with progress tracking
      const bench = new Glockit(delay);
      const results = await bench.run(config, options.progress !== false);
      
      // Save results if --save flag is set
      if (options.save) {
        const outputDir = options.output || '.'; // Use current directory if no output specified
        
        // Ensure output directory exists if it's not the current directory
        if (outputDir !== '.' && !fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const jsonFile = path.join(outputDir, `benchmark-${timestamp}.json`);
        const csvFile = path.join(outputDir, `benchmark-${timestamp}.csv`);
        
        await bench.saveResults(results, jsonFile, csvFile);
        
        if (options.progress === false) {
          const outputPath = outputDir === '.' ? 'current directory' : outputDir;
          console.log(chalk.blue(`📊 Results saved to: ${path.join(outputPath, `benchmark-${timestamp}.{json,csv}`)}`));
        }
      } else if (options.progress === false) {
        console.log(chalk.yellow('ℹ️  Results not saved (use --save to save results)'));
      }
      
      if (options.progress === false) {
        console.log(chalk.green('✅ Benchmark completed!'));
      }
      
      // Print summary
      const summary = results.summary;
      console.log(chalk.green('\n📈 Benchmark Summary:'));
      console.log(chalk.blue(`   Total Requests: ${summary.totalRequests}`));
      console.log(chalk.green(`   Successful: ${summary.totalSuccessful}`));
      console.log(chalk.red(`   Failed: ${summary.totalFailed}`));
      console.log(chalk.blue(`   Total Duration: ${(summary.totalDuration / 1000).toFixed(2)}s`));
      console.log(chalk.blue(`   Requests/Second: ${summary.overallRequestsPerSecond.toFixed(2)}`));
      console.log(chalk.blue(`   Avg. Response Time: ${summary.averageResponseTime.toFixed(2)}ms`));
      
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        // This should already be handled above, but just in case
        console.error(chalk.red('❌ Configuration error:'), error.message);
      } else {
        console.error(chalk.red('❌ Error running benchmark:'));
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
        if (error instanceof Error && error.stack) {
          console.error(chalk.gray('Stack trace:'), error.stack);
        }
      }
      process.exit(1);
    }
  });

program
  .command('example')
  .description('Generate an example configuration file')
  .option('-o, --output <file>', 'Output file path', 'benchmark.json')
  .action((options) => {
    const exampleConfig: BenchmarkConfig = {
      name: "Example API Benchmark",
      global: {
        maxRequests: 100,
        concurrent: 10,
        timeout: 5000
      },
      endpoints: [
        {
          name: "Login",
          url: "https://api.example.com/auth/login",
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: {
            "username": "testuser",
            "password": "testpass"
          },
          variables: [
            {
              name: "authToken",
              path: "token",
              from: "response"
            }
          ]
        },
        {
          name: "Get User Profile",
          url: "https://api.example.com/user/profile",
          method: "GET",
          headers: {
            "Authorization": "Bearer {{authToken}}"
          },
          dependencies: ["Login"]
        }
      ]
    };
    
    fs.writeFileSync(options.output, JSON.stringify(exampleConfig, null, 2));
    console.log(chalk.green(`✅ Example configuration saved to: ${options.output}`));
  });

// Add help command
program.parse();

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}