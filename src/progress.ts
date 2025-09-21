import { EndpointConfig } from './types';

const PROGRESS_BAR_LENGTH = 30;

export class ProgressTracker {
  private endpointStats: Map<string, { current: number; total: number; status: string }> = new Map();
  private totalEndpoints: number = 0;
  private completedEndpoints: number = 0;
  private startTime: number = Date.now();
  private lastUpdate: number = 0;
  private updateInterval = 100; // Update at most every 100ms

  constructor() {
    // Initialize with empty progress
    this.render();
  }

  public initializeEndpoint(endpoint: EndpointConfig, totalRequests: number): void {
    this.endpointStats.set(endpoint.name, {
      current: 0,
      total: totalRequests,
      status: 'Waiting...'
    });
    this.totalEndpoints = this.endpointStats.size;
    this.render();
  }

  public updateEndpointProgress(endpointName: string, current: number, total: number, status: string): void {
    const now = Date.now();
    if (now - this.lastUpdate < this.updateInterval) return;
    
    const stats = this.endpointStats.get(endpointName);
    if (stats) {
      stats.current = current;
      stats.total = total;
      stats.status = status;
      this.render();
      this.lastUpdate = now;
    }
  }

  public updateRequestProgress(endpointName: string, current: number, total: number, status: string): void {
    this.updateEndpointProgress(endpointName, current, total, status);
  }

  public completeEndpoint(endpointName: string): void {
    const stats = this.endpointStats.get(endpointName);
    if (stats) {
      stats.status = 'Completed';
      stats.current = stats.total;
      this.completedEndpoints++;
      this.render();
    }
    this.stop();
  }

  private render(): void {
    // Clear the console
    console.clear();
    
    // Render overall progress
    const overallProgress = this.totalEndpoints > 0 
      ? (this.completedEndpoints / this.totalEndpoints) * 100 
      : 0;
    
    console.log(`\n${this.formatProgressBar(overallProgress, 100, 'Overall')}\n`);
    
    // Render each endpoint's progress
    this.endpointStats.forEach((stats, name) => {
      const progress = stats.total > 0 ? (stats.current / stats.total) * 100 : 0;
      console.log(`${this.formatProgressBar(progress, 100, name.padEnd(20).substring(0, 20))} ${stats.status}`);
    });
    
    console.log('\nPress Ctrl+C to stop the benchmark\n');
  }

  private formatProgressBar(progress: number, total: number, label: string): string {
    const percentage = Math.min(100, Math.max(0, (progress / total) * 100));
    const filledLength = Math.floor((PROGRESS_BAR_LENGTH * percentage) / 100);
    const bar = '█'.repeat(filledLength) + '░'.repeat(PROGRESS_BAR_LENGTH - filledLength);
    return `[${bar}] ${percentage.toFixed(1)}% ${label}`;
  }

  public log(message: string): void {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }

  public error(message: string): void {
    console.error(`[${new Date().toISOString()}] [ERROR] ${message}`);
  }

  public stop(): void {
    // Cleanup if needed
    console.clear();
    console.log('Benchmark completed!');
  }
}
