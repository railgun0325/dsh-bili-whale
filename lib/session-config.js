import path from 'node:path'
import { resolveWhaleModelSelection } from './model-selection.js'

/** Resolve only an explicit ordinary Session target; never follow the active UI. */
export function resolveSessionConfig(config, defaults) {
  const value = config.session ?? {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('session 必须是对象')
  const id = value.id === undefined || value.id === '' ? defaults.id : value.id
  const cwd = value.cwd === undefined || value.cwd === '' ? defaults.cwd : value.cwd
  if (typeof id !== 'string' || !id.trim() || /[\\/\0]/.test(id)) throw new Error('session.id 必须是非空会话 ID，不能含路径分隔符')
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || cwd.includes('\0')) throw new Error('session.cwd 必须是绝对目录路径')
  const selection = value.modelSelection ?? defaults.modelSelection
  return { id: id.trim(), cwd: path.resolve(cwd), ...(selection === undefined ? {} : { modelSelection: resolveWhaleModelSelection(selection) }) }
}
