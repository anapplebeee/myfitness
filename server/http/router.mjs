/**
 * 极简路由器：精确方法 + 路径模板（`{id}` 占位）。
 *
 * 不引第三方框架：依赖越少，审计面越小；这个服务只需要 20 条路由。
 */
export function createRouter() {
  /** @type {{ method: string, parts: string[], handler: Function }[]} */
  const routes = [];

  function add(method, pattern, handler) {
    routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
  }

  /**
   * @param {string} method
   * @param {string} pathname
   * @returns {{ handler: Function, params: Record<string, string> } | null}
   */
  function match(method, pathname) {
    const segments = pathname.split('/').filter(Boolean);
    for (const route of routes) {
      if (route.method !== method) continue;
      if (route.parts.length !== segments.length) continue;
      /** @type {Record<string, string>} */
      const params = {};
      let ok = true;
      for (let i = 0; i < route.parts.length; i += 1) {
        const part = route.parts[i];
        if (part.startsWith('{') && part.endsWith('}')) {
          params[part.slice(1, -1)] = decodeURIComponent(segments[i]);
        } else if (part !== segments[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  }

  return {
    add,
    get: (pattern, handler) => add('GET', pattern, handler),
    post: (pattern, handler) => add('POST', pattern, handler),
    put: (pattern, handler) => add('PUT', pattern, handler),
    delete: (pattern, handler) => add('DELETE', pattern, handler),
    match,
    /** 用于 Allow 响应头。 */
    methodsFor(pathname) {
      const segments = pathname.split('/').filter(Boolean);
      return [
        ...new Set(
          routes
            .filter((route) => route.parts.length === segments.length)
            .filter((route) =>
              route.parts.every(
                (part, i) => part === segments[i] || (part.startsWith('{') && part.endsWith('}')),
              ),
            )
            .map((route) => route.method),
        ),
      ];
    },
  };
}
