#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { BarbariansBench } from './index';
import { BenchmarkConfig, ConfigValidator, ConfigValidationError } from './types';
import * as fs from 'fs';
import * as path from 'path';

const program = new Command();

program
  .name('barbarians-bench')
  .description('A tool to benchmark REST APIs with request chaining capabilities')
  .version('1.0.0');

program
  .command('run')
  .description('Run benchmark from configuration file')
  .option('-c, --config <file>', 'Configuration file path (JSON)', 'benchmark.json')
  .option('-o, --output <dir>', 'Output directory for results', 'results')
  .action(async (options) => {
    try {
      console.log(chalk.blue('🔥 Barbarians-Bench Starting...'));
      
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
          console.log(chalk.yellow('\n💡 Use "barbarians-bench example" to generate a valid configuration template.'));
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
      
      // Run benchmark
      const bench = new BarbariansBench();
      const results = await bench.run(config);
      
      // Save results
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const jsonFile = path.join(options.output, `benchmark-${timestamp}.json`);
      const csvFile = path.join(options.output, `benchmark-${timestamp}.csv`);
      
      await bench.saveResults(results, jsonFile, csvFile);
      
      console.log(chalk.green('✅ Benchmark completed!'));
      console.log(chalk.blue(`📊 Results saved to:`));
      console.log(chalk.blue(`   JSON: ${jsonFile}`));
      console.log(chalk.blue(`   CSV:  ${csvFile}`));
      
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