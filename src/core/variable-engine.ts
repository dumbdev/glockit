import { AssertionConfig } from '../types';
import type { Platform } from '../types';

/**
 * Gets a value from an object using a dot-separated path.
 */
export function getValueByPath(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Sanitizes a variable value for logging, masking sensitive data.
 */
export function sanitizeForLogging(value: any, variableName: string): string {
  if (typeof value !== 'string') {
    return '[non-string value]';
  }

  const sensitivePatterns = [
    /token/i, /auth/i, /key/i, /secret/i, /password/i,
    /credential/i, /bearer/i, /jwt/i, /session/i
  ];

  if (sensitivePatterns.some(pattern => pattern.test(variableName))) {
    return '********';
  }

  const maxLength = 100;
  if (value.length > maxLength) {
    return `${value.substring(0, maxLength)}... [truncated ${value.length - maxLength} chars]`;
  }

  return value;
}

/**
 * Replaces placeholders in text with variable values and dynamic functions.
 * Supports: {{variableName}}, {{$uuid}}, {{$randomInt}}, {{$randomFrom}}, {{$randomWord}}, {{$env.X}}
 */
export function replaceVariables(
  text: string,
  variables: Map<string, any>,
  platform?: Pick<Platform, 'getEnvVar'>
): string {
  if (!text) return text;

  let result = text;

  // Replace environment variables
  if (platform) {
    result = result.replace(/{{(\$env\.(.*?))}}/g, (_, __, envVarName) => {
      return platform.getEnvVar(envVarName) || `{{$env.${envVarName}}}`;
    });
  }

  // Replace custom variables
  for (const [key, value] of variables) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
  }

  // {{$uuid}} or {{$randomUUID()}}
  result = result.replace(/{{(\$uuid|\$randomUUID\(\))}}/g, () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  });

  // {{$randomInt(min, max)}}
  result = result.replace(/{{(\$randomInt\(\s*(\d+)\s*,\s*(\d+)\s*\))}}/g, (_, __, min, max) => {
    const minVal = parseInt(min, 10);
    const maxVal = parseInt(max, 10);
    return Math.floor(Math.random() * (maxVal - minVal + 1) + minVal).toString();
  });

  // {{$randomFrom(['a', 'b'])}}
  result = result.replace(/{{(\$randomFrom\(\s*\[(.*?)\]\s*\))}}/g, (_, __, itemsStr) => {
    const items = itemsStr.split(',').map((s: string) => s.trim().replace(/^['"]|['"]$/g, ''));
    if (items.length === 0) return '';
    return items[Math.floor(Math.random() * items.length)];
  });

  // {{$randomWord}}
  result = result.replace(/{{(\$randomWord)}}/g, () => {
    const words = ['apple', 'banana', 'cherry', 'date', 'elderberry', 'fig', 'grape', 'honeydew'];
    return words[Math.floor(Math.random() * words.length)];
  });

  return result;
}

/**
 * Recursively replaces variables in an object, array, or string.
 */
export function replaceVariablesInObject(
  obj: any,
  variables: Map<string, any>,
  platform?: Pick<Platform, 'getEnvVar'>
): any {
  if (!obj) return obj;
  if (typeof obj === 'string') return replaceVariables(obj, variables, platform);
  if (Array.isArray(obj)) return obj.map(item => replaceVariablesInObject(item, variables, platform));
  if (typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = replaceVariablesInObject(value, variables, platform);
    }
    return result;
  }
  return obj;
}

/**
 * Extracts variables from response data, headers, or cookies and stores them in the variable scope.
 */
export function extractVariables(
  extractions: any[],
  responseData: any,
  headers: any,
  variableScope: Map<string, any>
): Record<string, any> {
  const extractedResults: Record<string, any> = {};

  for (const extraction of extractions) {
    try {
      let value;
      if (extraction.from === 'response') {
        value = getValueByPath(responseData, extraction.path);
      } else if (extraction.from === 'headers') {
        value = headers[extraction.path] || headers[extraction.path.toLowerCase()];
      } else if (extraction.from === 'cookies') {
        const cookieHeader = headers['set-cookie'];
        if (Array.isArray(cookieHeader)) {
          const cookie = cookieHeader.find((c: string) => c.startsWith(`${extraction.path}=`));
          if (cookie) {
            value = cookie.split(';')[0].split('=')[1];
          }
        } else if (typeof cookieHeader === 'string') {
          const cookie = cookieHeader.split(',').find((c: string) => c.trim().startsWith(`${extraction.path}=`));
          if (cookie) {
            value = cookie.trim().split(';')[0].split('=')[1];
          }
        }
      }

      if (value !== undefined) {
        variableScope.set(extraction.name, value);
        extractedResults[extraction.name] = value;
        const sanitizedValue = sanitizeForLogging(value, extraction.name);
        console.log(`📝 Extracted variable: ${extraction.name} = ${sanitizedValue}`);
      }
    } catch (error) {
      console.warn(`⚠️  Failed to extract variable ${extraction.name}: ${error}`);
    }
  }

  return extractedResults;
}

/**
 * Checks assertions against response data and headers.
 */
export function checkAssertions(
  assertions: AssertionConfig[],
  data: any,
  headers: any
): { success: boolean; message: string }[] {
  return assertions.map(assertion => {
    const safeHeaders = headers || {};
    const actualValue = getValueByPath(data, assertion.path)
      ?? safeHeaders[assertion.path]
      ?? safeHeaders[assertion.path.toLowerCase()];
    let success = false;
    let message = '';

    switch (assertion.operator) {
      case 'equals':
        success = actualValue === assertion.value;
        message = `Expected ${assertion.path} to equal ${assertion.value}, but got ${actualValue}`;
        break;
      case 'contains':
        success = String(actualValue).includes(String(assertion.value));
        message = `Expected ${assertion.path} to contain ${assertion.value}, but got ${actualValue}`;
        break;
      case 'exists':
        success = actualValue !== undefined && actualValue !== null;
        message = `Expected ${assertion.path} to exist, but it was ${actualValue}`;
        break;
      case 'matches':
        success = new RegExp(assertion.value).test(String(actualValue));
        message = `Expected ${assertion.path} to match ${assertion.value}, but got ${actualValue}`;
        break;
    }

    return { success, message: success ? 'Passed' : message };
  });
}

/**
 * Sleeps for the specified number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
