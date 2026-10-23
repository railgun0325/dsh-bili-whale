/** DSH 0.2.1-rc.2 local adapter. No call to selectModel/saveSelection: those
 * also change the global default. Fail closed if this Host surface changes. */
export function resolveWhaleModelSelection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请先配置 session.modelSelection；不回退到宿主默认模型')
  const { provider, model, reasoningEffort } = value
  if (!['deepseek-official', 'deepseek-account'].includes(provider) || model !== 'deepseek-flash') throw new Error('鲸鱼只允许已有 DeepSeek provider 的 deepseek-flash')
  if (!['off', 'low', 'high', 'max'].includes(reasoningEffort)) throw new Error('请明确配置 DeepSeek reasoningEffort')
  if (Object.keys(value).some((key) => !['provider', 'model', 'reasoningEffort'].includes(key))) throw new Error('模型配置只接受 provider/model/reasoningEffort，不接受凭据')
  return { provider, model, reasoningEffort }
}

export async function selectWhaleSessionModel(ctx, target, selection, { signal } = {}) {
  signal?.throwIfAborted()
  if (target?.id !== 'bili-whale') throw new Error('模型绑定仅允许专属 bili-whale 会话')
  const wanted = resolveWhaleModelSelection(selection)
  const controller = ctx.sessionController
  const agents = controller?.agents
  const llm = ctx.llm
  if (typeof controller?.resolveAgent !== 'function' || typeof agents?.selectForNextRequest !== 'function'
    || typeof agents?.serializeImageAdmission !== 'function' || typeof llm?.resolveCallConfig !== 'function'
    || typeof llm?.listProviders !== 'function' || typeof llm?.listModels !== 'function') {
    throw new Error('当前 Host 不支持严格会话局部模型绑定；未使用全局 selectModel 替代')
  }
  const providers = await llm.listProviders()
  signal?.throwIfAborted()
  if (!providers.some((provider) => provider.id === wanted.provider)) throw new Error('所选 DeepSeek provider 未配置')
  const models = await llm.listModels(wanted.provider)
  signal?.throwIfAborted()
  if (!models.some((model) => model.id === wanted.model)) throw new Error('所选 DeepSeek Flash 当前不可用')
  const found = await controller.resolveAgent(target.id)
  signal?.throwIfAborted()
  if (found?.error) throw found.error
  const agent = found?.agent
  if (!agent || agent.id !== target.id) throw new Error('无法取得指定鲸鱼会话')
  return agents.serializeImageAdmission(agent, async () => {
    signal?.throwIfAborted()
    const header = agent.session?.header
    if (header?.cwd !== target.cwd || header?.origin === 'subagent' || header?.parentSession) throw new Error('鲸鱼会话目录或身份不匹配')
    if (agent.status === 'running') throw new Error('鲸鱼会话正在运行；等待本轮结束后再绑定')
    const resolved = await llm.resolveCallConfig(wanted)
    signal?.throwIfAborted()
    if (resolved.provider !== wanted.provider || resolved.model !== wanted.model || resolved.reasoningEffort !== wanted.reasoningEffort) throw new Error('Host 返回的模型与指定 DeepSeek Flash 不一致')
    if (agent.status === 'running') throw new Error('鲸鱼会话已开始运行；未改变模型')
    // This Host method logs model/selection and updates only this Agent cache.
    // The normal controller.selectModel additionally saves the global default.
    await agents.selectForNextRequest(agent, wanted)
    return { sessionId: target.id, selected: { ...wanted } }
  })
}
