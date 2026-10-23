import path from 'node:path'

/** Resolve only Whale application data; never change the process or OS home.
 * Configuration and installed runtime discovery keep their independent paths.
 * An explicit relative/blank override is rejected before any data is touched.
 */
export function dataHome(env = process.env) {
  if (env.BILI_WHALE_DATA_HOME !== undefined) {
    const value = env.BILI_WHALE_DATA_HOME
    if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value)) {
      throw new Error('BILI_WHALE_DATA_HOME must be an absolute non-empty path')
    }
    return path.normalize(value)
  }
  return env.USERPROFILE || env.HOME || '.'
}
