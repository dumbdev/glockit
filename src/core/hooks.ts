/**
 * Executes a hook script inside a sandboxed vm context.
 * Only supported on the Node.js platform.
 */
export function runHookInSandbox(
  script: string,
  context: Record<string, any>,
  hookName: 'beforeRequest' | 'afterRequest',
  endpointName: string,
  platformName: string
): void {
  if (platformName !== 'node') {
    throw new Error(`${hookName} is only supported on the node platform`);
  }

  const vm = require('node:vm') as typeof import('node:vm');
  const sandbox = {
    request: context.request,
    response: context.response,
    variables: context.variables,
    Math,
    Date,
    JSON,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp
  };

  const vmContext = vm.createContext(sandbox, {
    codeGeneration: {
      strings: false,
      wasm: false
    }
  });

  const compiled = new vm.Script(`"use strict";\n${script}`, {
    filename: `${endpointName}.${hookName}.hook.js`
  });

  compiled.runInContext(vmContext, { timeout: 1000 });
}
