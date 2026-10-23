// 本机补丁的宿主契约（DSH 0.2.1-rc.2）：调度器先 list 再复用/创建专属会话，
// 并在每次唤醒前做会话局部的 DeepSeek Flash 绑定；缺任何一项都失败关闭、不派发。
// 上游测试里的假宿主只有 create/prompt —— 这里只给测试补齐这些能力，不放松线上逻辑。
export const modelSelection = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }

export function localHost(controller) {
  const sessions = []
  const cwdOf = (id) => sessions.find((s) => s.sessionId === id)?.cwd
  return {
    sessionController: {
      ...controller,
      async list() { return { items: sessions.map((s) => ({ ...s })) } },
      async create(request) {
        await controller.create?.(request)
        sessions.push({ sessionId: request.sessionId, cwd: request.cwd })
        return { sessionId: request.sessionId }
      },
      async resolveAgent(id) { return { agent: { id, status: 'idle', session: { header: { cwd: cwdOf(id) } } } } },
      agents: { async selectForNextRequest() {}, serializeImageAdmission: (agent, fn) => fn() },
    },
    llm: {
      async listProviders() { return [{ id: modelSelection.provider }] },
      async listModels() { return [{ id: modelSelection.model }] },
      async resolveCallConfig(wanted) { return { ...wanted } },
    },
  }
}
