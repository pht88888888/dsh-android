'use strict'

/**
 * cordis-argfix 预设插件
 *
 * 完整复刻 dsh-tool-cordis 的模型工具（cordis_define / cordis_run / cordis_stop /
 * cordis_undefine / cordis_inspect_list / cordis_inspect_query / cordis_inspect_self），
 * 直接调用宿主服务 dynamicCordisRunner 与 cordisInspect，**不注册任何进程级
 * inspect provider**（避免与已有 cordis preset 会话冲突，允许多会话并存）。
 *
 * 与原生 cordis_define 的关键差异：参数全部扁平化为字符串（idPrefix / pluginId /
 * name / purpose / codeClient / codeHost），规避部分模型把嵌套对象序列化成
 * JSON 字符串、导致 oneOf 校验失败的问题。
 */

module.exports = function apply(ctx) {
  const tools = ctx.get('tools')
  if (tools === undefined) return
  const runner = ctx.get('dynamicCordisRunner')
  if (runner === undefined) return
  const inspect = ctx.get('cordisInspect')
  if (inspect === undefined) return

  function requireAgent(exec) {
    if (exec.agent === undefined) throw new Error('Cordis dynamic tools require an Agent-backed session')
    return exec.agent
  }

  const JSON_OUTPUT = {
    schema: { type: 'object' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }

  // ── cordis_define（扁平参数版）─────────────────────────────────────────────
  tools.register({
    name: 'cordis_define',
    description: 'Define an immutable Cordis Package（宽容扁平版：所有参数都是普通字符串，内部自动组装为 cordis_define 需要的结构，直接调用宿主注册器）。提供 idPrefix 创建新插件，或提供 pluginId 向已有插件追加 Package（二选一）。codeClient / codeHost 是纯 JS 函数体字符串，至少提供一个，返回一个 Cordis Plugin；本工具不执行代码，成功后用返回的 pluginId/packageId 调用 cordis_run。',
    parameters: {
      type: 'object',
      properties: {
        idPrefix: { type: 'string', description: '创建新插件时的语义前缀：3-6 个小写英文字母（如 blue / theme）' },
        pluginId: { type: 'string', description: '向已有插件追加版本时填其稳定 ID（如 blue-2）；与 idPrefix 二选一' },
        name: { type: 'string', description: 'Package 显示名' },
        purpose: { type: 'string', description: '一句话用途说明' },
        codeClient: { type: 'string', description: '客户端 JS 函数体字符串（浏览器侧，如主题令牌覆盖）' },
        codeHost: { type: 'string', description: 'Host 侧 JS 函数体字符串（可选）' },
      },
      required: ['idPrefix', 'name', 'purpose'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pluginId: { type: 'string' },
          packageId: { type: 'string' },
          name: { type: 'string' },
          purpose: { type: 'string' },
          hasHostHalf: { type: 'boolean' },
          hasClientHalf: { type: 'boolean' },
        },
        required: ['pluginId', 'packageId', 'name', 'purpose', 'hasHostHalf', 'hasClientHalf'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Defined ${value.pluginId}/${value.packageId} (${value.name}); it is not running yet. Use cordis_run to activate this Package.`,
      }],
      presentationMeta: (_args, value) => ({ pluginId: value.pluginId, packageId: value.packageId }),
    },
    execute(args, exec) {
      if (!args.idPrefix && !args.pluginId) throw new Error('必须提供 idPrefix（新插件）或 pluginId（已有插件）之一')
      const plugin = args.pluginId
        ? { kind: 'existing', pluginId: String(args.pluginId) }
        : { kind: 'new', idPrefix: String(args.idPrefix) }
      const receipt = runner.define({
        sessionId: requireAgent(exec).id,
        plugin,
        name: args.name,
        purpose: args.purpose,
        code: {
          ...(args.codeHost === undefined ? {} : { host: String(args.codeHost) }),
          ...(args.codeClient === undefined ? {} : { client: String(args.codeClient) }),
        },
      })
      return Promise.resolve({
        pluginId: String(receipt.pluginId),
        packageId: String(receipt.packageId),
        name: receipt.name,
        purpose: receipt.purpose,
        hasHostHalf: receipt.hasHostHalf,
        hasClientHalf: receipt.hasClientHalf,
      })
    },
  })

  // ── cordis_run ─────────────────────────────────────────────────────────────
  tools.register({
    name: 'cordis_run',
    description: 'Activate one exact Package of a dynamic Plugin. mode:"run" for first activation, restart, or rollback; mode:"update" to switch to a different Package when current exists. An unauthorized Client Package returns awaiting-approval (the user must approve in the UI; do not retry or claim success); an authorized one returns starting and completes asynchronously. currentPackageId changes only after complete success. After a technical failure, read diagnostics with cordis_inspect_self, then retry update or roll back to current with run.',
    parameters: {
      type: 'object',
      properties: {
        pluginId: { type: 'string', description: 'Stable Plugin ID returned by cordis_define.' },
        packageId: { type: 'string', description: 'Exact immutable Package ID to activate.' },
        mode: { type: 'string', enum: ['run', 'update'], description: 'run for first activation/restart/rollback; update to switch versions.' },
      },
      required: ['pluginId', 'packageId', 'mode'],
      additionalProperties: false,
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const receipt = await runner.run(requireAgent(exec), String(args.pluginId), String(args.packageId), args.mode, exec.signal)
      if (!receipt.ok) throw new Error(receipt.message)
      return {
        status: receipt.status,
        pluginId: args.pluginId,
        packageId: args.packageId,
        pluginRunId: String(receipt.pluginRunId),
        mode: receipt.mode,
        ...(receipt.currentPackageId === undefined ? {} : { currentPackageId: String(receipt.currentPackageId) }),
        nextPackageId: String(receipt.nextPackageId),
      }
    },
  })

  // ── cordis_stop ────────────────────────────────────────────────────────────
  tools.register({
    name: 'cordis_stop',
    description: 'Stop the current Run of a dynamic Plugin and cancel unfinished approval or activation requests. Retain the Plugin, every immutable Package, grants, currentPackageId, and nextPackageId so it can later run or update directly. Stopping an already stopped Plugin succeeds idempotently.',
    parameters: {
      type: 'object',
      properties: { pluginId: { type: 'string', description: 'Stable dynamic Plugin ID to stop.' } },
      required: ['pluginId'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { pluginId: { type: 'string' } },
        required: ['pluginId'],
      },
      render: (_args, value) => [{ type: 'text', text: `Dynamic Plugin ${value.pluginId} is stopped; its definition and versions remain.` }],
    },
    async execute(args, exec) {
      const receipt = await runner.stop(requireAgent(exec), String(args.pluginId))
      if (!receipt.ok && receipt.reason !== 'not-running') throw new Error(receipt.message)
      return { pluginId: args.pluginId }
    },
  })

  // ── cordis_undefine ────────────────────────────────────────────────────────
  tools.register({
    name: 'cordis_undefine',
    description: 'Permanently remove a dynamic Plugin owned by the current Session. If it is running or awaiting approval, first stop it and cancel the request, then delete every Package, grant, and version pointer. After this returns, its pluginId, packageIds, @ reference, and Package business views are invalid. Do not call this Tool when versions must remain available for restart or rollback; use cordis_stop instead.',
    parameters: {
      type: 'object',
      properties: { pluginId: { type: 'string', description: 'Stable dynamic Plugin ID to remove permanently.' } },
      required: ['pluginId'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pluginId: { type: 'string' },
          wasRunning: { type: 'boolean' },
        },
        required: ['pluginId', 'wasRunning'],
      },
      render: (_args, value) => [{ type: 'text', text: `Removed dynamic Plugin ${value.pluginId} and all of its Packages.` }],
    },
    async execute(args, exec) {
      const receipt = await runner.undefine(requireAgent(exec), String(args.pluginId))
      if (!receipt.ok) throw new Error(receipt.message)
      return { pluginId: args.pluginId, wasRunning: receipt.wasRunning }
    },
  })

  // ── cordis_inspect_list / cordis_inspect_query ────────────────────────────
  tools.register({
    name: 'cordis_inspect_list',
    description: 'List every Cordis Inspect Provider currently known to the Host, including local Host Providers and the latest manifests synchronized from the Client. Each entry includes its platform, purpose, read-only methods, and input/output schemas. Call this Tool before creating or modifying a Package, then select the provider and method for cordis_inspect_query from its result.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: JSON_OUTPUT,
    execute() {
      return Promise.resolve({ providers: inspect.list() })
    },
  })

  tools.register({
    name: 'cordis_inspect_query',
    description: 'Run a read-only query explicitly declared by an Inspect Provider. platform, provider, and method must come from cordis_inspect_list, and input must satisfy that method schema. Host queries run locally; a Client query waits for the first valid page response. This Tool cannot invoke business Service methods or modify the runtime.',
    parameters: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['host', 'client'], description: 'Runtime platform that owns the Provider.' },
        provider: { type: 'string', description: 'Exact Provider ID returned by cordis_inspect_list.' },
        method: { type: 'string', description: 'Exact method name declared by the Provider manifest.' },
        input: { type: 'object', description: 'Optional query input object; it must satisfy the method input schema. Omit when there are no parameters.' },
      },
      required: ['platform', 'provider', 'method'],
      additionalProperties: false,
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const data = await inspect.query(args.platform, args.provider, args.method, args.input, requireAgent(exec), exec.signal)
      return { platform: args.platform, provider: args.provider, method: args.method, data }
    },
  })

  // ── cordis_inspect_self（简化版，不含 fiber 内部诊断）────────────────────
  function selfState(reference) {
    const status = reference.latestRun && reference.latestRun.status
    if (status === 'awaiting-approval') return 'awaiting-approval'
    if (status === 'client-pending' || status === 'starting-host') return 'client-pending'
    if (status === 'failed' || status === 'rejected' || status === 'cancelled') return 'failed'
    if (status === 'waiting') return 'waiting'
    if (status === 'running') return 'running'
    if (reference.activeRun !== undefined) return 'running'
    return reference.currentPackageId === undefined ? 'defined' : 'stopped'
  }

  function selfSummary(reference) {
    const latest = reference.latestRun
    return {
      pluginId: String(reference.pluginId),
      name: reference.name,
      packageCount: reference.packages && reference.packages.length > 0 ? reference.packages.length : 1,
      state: selfState(reference),
      ...(reference.currentPackageId === undefined ? {} : { currentPackageId: String(reference.currentPackageId) }),
      ...(reference.nextPackageId === undefined ? {} : { nextPackageId: String(reference.nextPackageId) }),
      ...(reference.activeRun === undefined ? {} : {
        activeRun: {
          pluginRunId: String(reference.activeRun.pluginRunId),
          packageId: String(reference.activeRun.packageId),
        },
      }),
      ...(latest && latest.status === 'awaiting-approval' ? {
        pendingApproval: { pluginRunId: String(latest.pluginRunId), packageId: String(latest.packageId), mode: latest.mode },
      } : {}),
    }
  }

  tools.register({
    name: 'cordis_inspect_self',
    description: 'Inspect dynamic Cordis objects owned by the current Session at increasing levels of detail. With no IDs, list only Plugin summaries. With pluginId alone, return version pointers, the latest Run, and every Package summary. Only pluginId plus packageId returns that immutable Package source and runtime status. packageId cannot be supplied alone. Query an exact Package before handling @pluginId, repairing an asynchronous failure, or defining an updated version.',
    parameters: {
      type: 'object',
      properties: {
        pluginId: { type: 'string', description: 'Stable Plugin ID; omit it to list every current Plugin.' },
        packageId: { type: 'string', description: 'Exact immutable Package ID; requires pluginId.' },
      },
      additionalProperties: false,
    },
    output: JSON_OUTPUT,
    execute(args, exec) {
      const agent = requireAgent(exec)
      if (args.packageId !== undefined && args.pluginId === undefined) throw new Error('cordis_inspect_self packageId requires pluginId')
      if (args.pluginId === undefined) {
        return Promise.resolve({ mode: 'plugins', plugins: runner.listPlugins(agent).map(selfSummary) })
      }
      const pluginId = String(args.pluginId)
      if (args.packageId === undefined) {
        const plugin = runner.inspectPlugin(agent, pluginId)
        return Promise.resolve({
          mode: 'plugin',
          ...selfSummary(plugin),
          packages: (plugin.packages || []).map((pkg) => ({
            ...pkg,
            packageId: String(pkg.packageId),
            isCurrent: pkg.packageId === plugin.currentPackageId,
            isNext: pkg.packageId === plugin.nextPackageId,
          })),
        })
      }
      const inspected = runner.inspectPackage(agent, pluginId, String(args.packageId))
      return Promise.resolve({
        mode: 'package',
        plugin: selfSummary(inspected),
        packageId: String(args.packageId),
        name: inspected.name,
        purpose: inspected.purpose,
        code: inspected.code,
        runtime: {
          state: selfState(inspected),
          host: {
            status: inspected.latestRun && inspected.latestRun.host ? inspected.latestRun.host.status : 'stopped',
            waitingFor: inspected.latestRun && inspected.latestRun.host ? [...(inspected.latestRun.host.waitingFor || [])] : [],
            ...(inspected.latestRun && inspected.latestRun.host && inspected.latestRun.host.error !== undefined ? { error: inspected.latestRun.host.error } : {}),
          },
          client: {
            status: inspected.latestRun && inspected.latestRun.client ? inspected.latestRun.client.status : 'stopped',
            waitingFor: inspected.latestRun && inspected.latestRun.client ? [...(inspected.latestRun.client.waitingFor || [])] : [],
            ...(inspected.latestRun && inspected.latestRun.client && inspected.latestRun.client.error !== undefined ? { error: inspected.latestRun.client.error } : {}),
          },
        },
      })
    },
  })
}

