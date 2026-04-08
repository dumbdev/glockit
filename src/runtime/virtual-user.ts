import { VirtualUserConfig } from '../types';

export interface VirtualUserSession {
  id: string;
  variables: Map<string, any>;
  cookies: Map<string, string>;
}

export function resolveVirtualUserConfig(config?: VirtualUserConfig): Required<VirtualUserConfig> {
  return {
    sessionScope: config?.sessionScope === true,
    persistCookies: config?.persistCookies === true
  };
}

export function createVirtualUserSession(id: string, baseVariables: Map<string, any>): VirtualUserSession {
  return {
    id,
    variables: new Map(baseVariables),
    cookies: new Map<string, string>()
  };
}

export function getCookieHeader(
  session: VirtualUserSession | undefined,
  virtualUsersConfig?: VirtualUserConfig
): string | undefined {
  if (!session || !virtualUsersConfig?.persistCookies || session.cookies.size === 0) {
    return undefined;
  }

  const cookiePairs: string[] = [];
  for (const [name, value] of session.cookies) {
    cookiePairs.push(`${name}=${value}`);
  }

  return cookiePairs.join('; ');
}

export function captureSetCookies(
  headers: any,
  session: VirtualUserSession | undefined,
  virtualUsersConfig?: VirtualUserConfig
): void {
  if (!session || !virtualUsersConfig?.persistCookies) {
    return;
  }

  const rawSetCookie = headers?.['set-cookie'];
  if (!rawSetCookie) {
    return;
  }

  const values = Array.isArray(rawSetCookie) ? rawSetCookie : [rawSetCookie];
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const firstPart = value.split(';')[0]?.trim();
    if (!firstPart) {
      continue;
    }

    const eqIndex = firstPart.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }

    const cookieName = firstPart.slice(0, eqIndex).trim();
    const cookieValue = firstPart.slice(eqIndex + 1).trim();
    if (cookieName) {
      session.cookies.set(cookieName, cookieValue);
    }
  }
}
