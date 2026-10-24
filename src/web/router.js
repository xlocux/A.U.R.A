"use strict";

// Minimal declarative router. Route paths use `:name` segments:
//   `:id`, `:runId`, or any param ending in "Id" must be a positive integer and is passed as a Number;
//   every other param is URI-decoded and passed as a string.

function compileRoute(route) {
  const segments = route.path.split("/").filter(Boolean);
  return { ...route, segments };
}

function matchSegments(segments, pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== segments.length) return null;
  const params = {};
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const part = parts[index];
    if (!segment.startsWith(":")) {
      if (segment !== part) return null;
      continue;
    }
    const name = segment.slice(1);
    if (name === "id" || name.endsWith("Id")) {
      if (!/^\d+$/.test(part)) return null;
      params[name] = Number(part);
      continue;
    }
    try {
      params[name] = decodeURIComponent(part);
    } catch {
      return null;
    }
  }
  return params;
}

function createRouter(routeGroups) {
  const routes = routeGroups.flat().map(compileRoute);
  return async function dispatch(context) {
    const { request, url } = context;
    for (const route of routes) {
      if (route.method !== request.method) continue;
      const params = matchSegments(route.segments, url.pathname);
      if (!params) continue;
      await route.handler({ ...context, params });
      return true;
    }
    return false;
  };
}

module.exports = {
  createRouter,
  matchSegments
};
