import { BenchmarkResult } from '../../types';

export function buildHtmlReportTemplate(results: BenchmarkResult): string {
  const { summary, results: endpointResults, timestamp } = results;
  const date = new Date(timestamp).toLocaleString();
  const endpointRowsJson = JSON.stringify(endpointResults);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Glockit Benchmark Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 1200px; margin: 0 auto; padding: 20px; background-color: #f8f9fa; }
        .header { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); margin-bottom: 20px; border-left: 5px solid #007bff; }
        h1 { margin-top: 0; color: #007bff; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .card { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); text-align: center; }
        .card .value { font-size: 24px; font-weight: bold; color: #007bff; display: block; }
        .card .label { font-size: 14px; color: #6c757d; text-transform: uppercase; letter-spacing: 1px; }
        .card.success .value { color: #28a745; }
        .card.failure .value { color: #dc3545; }
        table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
        th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #eee; }
        th { background-color: #f1f3f5; font-weight: 600; color: #495057; }
        tr:last-child td { border-bottom: none; }
        tr:hover { background-color: #f8f9fa; }
        .success { color: #28a745; font-weight: 600; }
        .failure { color: #dc3545; font-weight: 600; }
        .url-cell { font-family: monospace; font-size: 13px; color: #666; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .footer { margin-top: 40px; text-align: center; color: #6c757d; font-size: 14px; }
        .controls { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; margin: 16px 0; }
        .control-input, .control-select { padding: 10px 12px; border: 1px solid #d0d7de; border-radius: 6px; background: #fff; }
        .control-checkbox { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; color: #495057; }
        .results-meta { margin: 10px 0 16px; color: #6c757d; font-size: 14px; }
        .viz-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 18px 0; }
        .viz-card { background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); padding: 14px; }
        .viz-card h3 { margin: 0 0 8px; font-size: 15px; color: #495057; }
        .viz-canvas { width: 100%; height: 220px; border: 1px solid #e9ecef; border-radius: 6px; }
        .drilldown { background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); padding: 16px; margin-top: 16px; }
        .drilldown h3 { margin-top: 0; color: #0b7285; }
        .drilldown .meta { color: #6c757d; font-size: 13px; margin-bottom: 8px; }
        .drilldown .error-list { color: #c92a2a; font-family: monospace; white-space: pre-wrap; }
        .drilldown .phase-row { font-size: 13px; margin: 4px 0; color: #495057; }
        tbody tr.is-active { background-color: #e7f5ff; }
        @media (max-width: 900px) {
          .viz-grid { grid-template-columns: 1fr; }
          .controls { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🚀 Glockit Benchmark Report</h1>
        <p>Generated on <strong>${date}</strong></p>
    </div>

    <div class="summary-grid">
        <div class="card">
            <span class="label">Total Requests</span>
            <span class="value">${summary.totalRequests}</span>
        </div>
        <div class="card success">
            <span class="label">Successful</span>
            <span class="value">${summary.totalSuccessful}</span>
        </div>
        <div class="card failure">
            <span class="label">Failed</span>
            <span class="value">${summary.totalFailed}</span>
        </div>
        <div class="card">
            <span class="label">Avg. Response Time</span>
            <span class="value">${summary.averageResponseTime.toFixed(2)}ms</span>
        </div>
        <div class="card">
          <span class="label">P95</span>
          <span class="value">${summary.responseTimePercentiles.p95.toFixed(2)}ms</span>
        </div>
        <div class="card">
          <span class="label">P99</span>
          <span class="value">${summary.responseTimePercentiles.p99.toFixed(2)}ms</span>
        </div>
        <div class="card">
            <span class="label">Overall RPS</span>
            <span class="value">${summary.overallRequestsPerSecond.toFixed(2)}</span>
        </div>
    </div>

    <h2>Detailed Results</h2>
    <div class="controls">
      <input id="endpoint-search" class="control-input" type="text" placeholder="Filter by endpoint name or URL" />
      <select id="sort-by" class="control-select">
        <option value="name-asc">Sort: Name (A-Z)</option>
        <option value="avg-desc">Sort: Avg Time (High-Low)</option>
        <option value="p95-desc">Sort: P95 (High-Low)</option>
        <option value="rps-desc">Sort: RPS (High-Low)</option>
      </select>
      <label class="control-checkbox"><input id="failed-only" type="checkbox" /> Show failures only</label>
    </div>
    <div class="viz-grid">
      <div class="viz-card">
        <h3>Latency (Avg ms)</h3>
        <canvas id="latency-chart" class="viz-canvas" width="560" height="220"></canvas>
      </div>
      <div class="viz-card">
        <h3>Throughput (RPS)</h3>
        <canvas id="rps-chart" class="viz-canvas" width="560" height="220"></canvas>
      </div>
    </div>
    <div id="results-meta" class="results-meta"></div>
    <table>
        <thead>
            <tr>
                <th>Endpoint</th>
                <th>URL</th>
                <th>Total</th>
                <th>Success</th>
                <th>Failure</th>
                <th>Avg Time</th>
                <th>P95</th>
                <th>P99</th>
                <th>Min</th>
                <th>Max</th>
                <th>RPS</th>
            </tr>
        </thead>
        <tbody id="endpoint-rows"></tbody>
    </table>

    <div id="endpoint-drilldown" class="drilldown">
      <h3>Endpoint Drilldown</h3>
      <div id="endpoint-drilldown-content" class="meta">Select an endpoint row to inspect details.</div>
    </div>

    <div class="footer">
      Generated by Glockit v1.0.9 - Lightweight API Benchmarking Tool
    </div>
    <script>
      const endpointRows = ${endpointRowsJson};
      const searchInput = document.getElementById('endpoint-search');
      const failedOnlyCheckbox = document.getElementById('failed-only');
      const sortBySelect = document.getElementById('sort-by');
      const endpointRowsBody = document.getElementById('endpoint-rows');
      const resultsMeta = document.getElementById('results-meta');
      const latencyChart = document.getElementById('latency-chart');
      const rpsChart = document.getElementById('rps-chart');
      const drilldownContent = document.getElementById('endpoint-drilldown-content');
      let selectedEndpointName = null;

      const encodeHtml = (value) => {
        return String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\"/g, '&quot;')
          .replace(/'/g, '&#39;');
      };

      const drawBars = (canvasElement, rows, valueSelector, color, formatter) => {
        if (!canvasElement || typeof canvasElement.getContext !== 'function') {
          return;
        }

        const ctx = canvasElement.getContext('2d');
        if (!ctx) {
          return;
        }

        const width = canvasElement.width;
        const height = canvasElement.height;
        ctx.clearRect(0, 0, width, height);

        const topRows = rows.slice(0, 8);
        if (topRows.length === 0) {
          ctx.fillStyle = '#6c757d';
          ctx.font = '12px sans-serif';
          ctx.fillText('No data', 12, 20);
          return;
        }

        const maxValue = Math.max(...topRows.map((row) => valueSelector(row)), 1);
        const left = 120;
        const right = 12;
        const top = 12;
        const barHeight = 18;
        const spacing = 8;

        topRows.forEach((row, index) => {
          const value = valueSelector(row);
          const y = top + index * (barHeight + spacing);
          const available = width - left - right;
          const barWidth = available * (value / maxValue);

          ctx.fillStyle = '#495057';
          ctx.font = '11px sans-serif';
          ctx.fillText((row.name || '').slice(0, 20), 8, y + 13);

          ctx.fillStyle = '#e9ecef';
          ctx.fillRect(left, y, available, barHeight);
          ctx.fillStyle = color;
          ctx.fillRect(left, y, barWidth, barHeight);

          ctx.fillStyle = '#212529';
          ctx.fillText(formatter(value), left + Math.min(barWidth + 6, available - 40), y + 13);
        });
      };

      const renderDrilldown = (endpointName, rows) => {
        const target = rows.find((entry) => entry.name === endpointName) || endpointRows.find((entry) => entry.name === endpointName);
        if (!target) {
          drilldownContent.innerHTML = '<div class="meta">Select an endpoint row to inspect details.</div>';
          return;
        }

        const phaseRows = Array.isArray(target.phaseResults) && target.phaseResults.length > 0
          ? target.phaseResults.map((phase) => {
              return '<div class="phase-row">'
                + encodeHtml(phase.name) + ': '
                + 'total=' + phase.totalRequests + ', success=' + phase.successfulRequests + ', failed=' + phase.failedRequests
                + ', rps=' + Number(phase.requestsPerSecond || 0).toFixed(2)
                + '</div>';
            }).join('')
          : '<div class="meta">No phase breakdown available.</div>';

        const errors = Array.isArray(target.errors) && target.errors.length > 0
          ? '<div class="error-list">' + target.errors.slice(0, 5).map((errorText) => encodeHtml(errorText)).join('\n') + '</div>'
          : '<div class="meta">No errors captured for this endpoint.</div>';

        drilldownContent.innerHTML = ''
          + '<div class="meta"><strong>' + encodeHtml(target.method) + '</strong> ' + encodeHtml(target.url) + '</div>'
          + '<div class="meta">Requests: ' + target.totalRequests + ' | Success: ' + target.successfulRequests + ' | Failed: ' + target.failedRequests + '</div>'
          + '<div class="meta">Avg: ' + Number(target.averageResponseTime || 0).toFixed(2) + 'ms | P95: ' + Number(target.responseTimePercentiles?.p95 || 0).toFixed(2) + 'ms | P99: ' + Number(target.responseTimePercentiles?.p99 || 0).toFixed(2) + 'ms</div>'
          + '<h4>Phase Results</h4>'
          + phaseRows
          + '<h4>Recent Errors</h4>'
          + errors;
      };

      const render = () => {
        const searchText = (searchInput.value || '').toLowerCase().trim();
        const failedOnly = failedOnlyCheckbox.checked;
        const sortBy = sortBySelect.value;

        const filtered = endpointRows
          .filter((row) => {
            if (failedOnly && row.failedRequests <= 0) {
              return false;
            }
            if (!searchText) {
              return true;
            }
            return (row.name || '').toLowerCase().includes(searchText) || (row.method + ' ' + row.url).toLowerCase().includes(searchText);
          })
          .sort((a, b) => {
            switch (sortBy) {
              case 'avg-desc':
                return b.averageResponseTime - a.averageResponseTime;
              case 'p95-desc':
                return b.responseTimePercentiles.p95 - a.responseTimePercentiles.p95;
              case 'rps-desc':
                return b.requestsPerSecond - a.requestsPerSecond;
              default:
                return (a.name || '').localeCompare(b.name || '');
            }
          });

        endpointRowsBody.innerHTML = filtered.map((row, index) => {
          const failureClass = row.failedRequests > 0 ? 'failure' : '';
          const activeClass = selectedEndpointName === row.name ? ' is-active' : '';
          return '<tr class="' + activeClass.trim() + '" data-endpoint-index="' + index + '">'
            + '<td>' + row.name + '</td>'
            + '<td class="url-cell">' + row.method + ' ' + row.url + '</td>'
            + '<td>' + row.totalRequests + '</td>'
            + '<td class="success">' + row.successfulRequests + '</td>'
            + '<td class="' + failureClass + '">' + row.failedRequests + '</td>'
            + '<td>' + row.averageResponseTime.toFixed(2) + 'ms</td>'
            + '<td>' + row.responseTimePercentiles.p95.toFixed(2) + 'ms</td>'
            + '<td>' + row.responseTimePercentiles.p99.toFixed(2) + 'ms</td>'
            + '<td>' + row.minResponseTime.toFixed(0) + 'ms</td>'
            + '<td>' + row.maxResponseTime.toFixed(0) + 'ms</td>'
            + '<td>' + row.requestsPerSecond.toFixed(2) + '</td>'
            + '</tr>';
        }).join('');

        resultsMeta.textContent = 'Showing ' + filtered.length + ' of ' + endpointRows.length + ' endpoint rows';

        drawBars(latencyChart, filtered, (row) => Number(row.averageResponseTime || 0), '#228be6', (value) => value.toFixed(1) + 'ms');
        drawBars(rpsChart, filtered, (row) => Number(row.requestsPerSecond || 0), '#2f9e44', (value) => value.toFixed(1));

        endpointRowsBody.querySelectorAll('tr[data-endpoint-index]').forEach((rowElement) => {
          rowElement.addEventListener('click', () => {
            const idx = Number(rowElement.getAttribute('data-endpoint-index'));
            if (Number.isFinite(idx) && filtered[idx]) {
              selectedEndpointName = filtered[idx].name;
            }
            renderDrilldown(selectedEndpointName, filtered);
            render();
          });
        });

        if (!selectedEndpointName && filtered.length > 0) {
          selectedEndpointName = filtered[0].name;
        }
        renderDrilldown(selectedEndpointName, filtered);
      };

      searchInput.addEventListener('input', render);
      failedOnlyCheckbox.addEventListener('change', render);
      sortBySelect.addEventListener('change', render);
      render();
    </script>
</body>
</html>
  `;
}
