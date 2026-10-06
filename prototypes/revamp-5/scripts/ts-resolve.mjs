// For running .ts tests directly with Node: the app's files import each other
// without the ".ts" (Metro and TypeScript add it); Node needs it said. Use:
//   /opt/node24/bin/node --import ./scripts/ts-resolve.mjs <test file>
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    const relative = /^\\.{1,2}\\//.test(specifier);
    const bare = !/\\.[a-z]+$/i.test(specifier);
    if (error && error.code === "ERR_MODULE_NOT_FOUND" && relative && bare) return next(specifier + ".ts", context);
    throw error;
  }
}
`),
);
