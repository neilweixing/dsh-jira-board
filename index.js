/**
 * dsh-jira-board — Host half.
 *
 * Immutable to Jira: the Host is the only side that holds the account secret
 * and the only side that talks to the Jira REST API. The browser half asks for
 * a board through one authenticated Connection RPC channel, so no token ever
 * reaches the page and no cross-origin request leaves the browser.
 *
 * Account storage
 * ---------------
 * The whole account — base URL, auth mode, user name, and secret — is one
 * `grant` record in the credentials seam (`dsh-jira-board/account`). The seam
 * keeps it in the owner-only credential file, and its payload is opaque to
 * every other plugin, which is exactly the "owner-defined" shape a
 * self-hosted service account needs. Nothing is written into the profile's
 * `cordis.patch.yml`, and the secret never appears in plugin configuration.
 *
 * Jira version target
 * -------------------
 * Jira Server 7.x (`/rest/api/2`). Jira 7.10 has no personal access tokens, so
 * the practical modes are HTTP Basic (user name plus password) and a bearer
 * token supplied by a fronting proxy or add-on; both are offered.
 */

import { Buffer } from 'node:buffer'

/** Loader identity. */
export const name = 'dsh-jira-board'

/** Connection channel served by this plugin. */
const CHANNEL = '/dsh-jira-board'

/** Credentials record address: `<scope>/<id>`, both lowercase hyphenated. */
const CREDENTIAL_KEY = 'dsh-jira-board/account'

/** Fields the board asks Jira for; anything else would be dropped on the wire. */
const ISSUE_FIELDS = 'summary,status,priority,issuetype,project,updated,duedate'

/** Default board query: the human's own unfinished work, highest priority first. */
const DEFAULT_JQL = 'assignee = currentUser() AND resolution = Unresolved ORDER BY priority DESC, updated DESC'

/** Default page size; the board states the total beside it. */
const DEFAULT_MAX_RESULTS = 50

/** Hard ceiling for one board read, whatever the configuration says. */
const MAX_RESULTS_LIMIT = 200

/** Deadline for one Jira request, in milliseconds. */
const REQUEST_TIMEOUT_MS = 20000

/** Accepted authentication modes. */
const AUTH_TYPES = new Set(['basic', 'bearer'])

/**
 * One rejected operation, carrying the code the browser half switches on.
 */
class JiraFailure extends Error {
  /**
   * @param code - stable failure code understood by the panel.
   * @param message - human-readable explanation shown in the panel.
   */
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/** Reject one caller-supplied field. */
function invalid(message) {
  return new JiraFailure('invalid-input', message)
}

/** The message of a thrown value; never includes a request body or secret. */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Validate and normalize the Jira base URL.
 * @param raw - address as the human typed it.
 * @returns the origin and path prefix without a trailing slash.
 */
function normalizeBaseUrl(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text === '') throw invalid('Jira 地址不能为空')
  let url
  try {
    url = new URL(text)
  } catch {
    throw invalid(`Jira 地址无效：${text}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid('Jira 地址必须以 http:// 或 https:// 开头')
  if (url.username !== '' || url.password !== '') throw invalid('Jira 地址里不能带账号或密码，请填在认证信息里')
  url.search = ''
  url.hash = ''
  return url.href.replace(/\/+$/u, '')
}

/** Read a bounded, trimmed string field. */
function readText(value, label, maxLength, required) {
  if (value === undefined || value === null) {
    if (required) throw invalid(`${label}不能为空`)
    return ''
  }
  if (typeof value !== 'string') throw invalid(`${label}必须是文本`)
  const text = value.trim()
  if (required && text === '') throw invalid(`${label}不能为空`)
  if (text.length > maxLength) throw invalid(`${label}过长（上限 ${String(maxLength)} 字符）`)
  return text
}

/**
 * Validate a full account as submitted by the settings form.
 * @param payload - untrusted RPC payload.
 * @returns the normalized account ready for storage.
 */
function normalizeAccount(payload) {
  const input = typeof payload === 'object' && payload !== null ? payload : {}
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const authType = typeof input.authType === 'string' ? input.authType : 'basic'
  if (!AUTH_TYPES.has(authType)) throw invalid(`不支持的认证方式：${authType}`)
  const username = readText(input.username, '用户名', 256, authType === 'basic')
  const token = readText(input.token, authType === 'basic' ? '密码或令牌' : '令牌', 8192, true)
  return { baseUrl, authType, username, token }
}

/**
 * Read the stored account, or nothing while it is absent or unreadable.
 * @param credentials - the credentials seam, when the composition mounts it.
 * @returns the stored account, or undefined.
 */
async function readAccount(credentials) {
  if (credentials === undefined) return undefined
  const record = await credentials.readRecord(CREDENTIAL_KEY)
  if (record === undefined || record.kind !== 'grant') return undefined
  const payload = record.payload
  if (typeof payload !== 'object' || payload === null) return undefined
  const { baseUrl, authType, username, token } = payload
  if (typeof baseUrl !== 'string' || typeof token !== 'string' || token === '') return undefined
  if (!AUTH_TYPES.has(authType)) return undefined
  return {
    baseUrl,
    authType,
    username: typeof username === 'string' ? username : '',
    token,
  }
}

/** Build the outbound Authorization header for one account. */
function authorizationHeader(account) {
  if (account.authType === 'bearer') return `Bearer ${account.token}`
  return `Basic ${Buffer.from(`${account.username}:${account.token}`, 'utf8').toString('base64')}`
}

/**
 * Call one Jira REST path, translating transport and HTTP failures into panel codes.
 * @param account - the account to authenticate as.
 * @param path - absolute REST path such as `/rest/api/2/myself`.
 * @param query - optional query parameters.
 * @returns the decoded JSON body.
 */
async function jiraRequest(account, path, query) {
  const url = new URL(`${account.baseUrl}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value))
  let response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: authorizationHeader(account) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'follow',
    })
  } catch (error) {
    const cause = describe(error)
    throw new JiraFailure(
      'network-error',
      `无法连接 Jira（${url.origin}）：${cause}。请确认地址、网络与证书是否可信。`,
    )
  }
  if (response.status === 401 || response.status === 403) {
    throw new JiraFailure('auth-failed', 'Jira 认证失败：请检查用户名与密码或令牌是否正确、该账号是否有浏览权限。')
  }
  if (response.status === 404) {
    throw new JiraFailure('jira-error', `Jira 未找到接口 ${path}：请确认地址指向 Jira 根路径（不是 /browse 等子路径）。`)
  }
  if (!response.ok) {
    let detail = ''
    try {
      detail = (await response.text()).slice(0, 300)
    } catch {
      detail = ''
    }
    throw new JiraFailure('jira-error', `Jira 返回 HTTP ${String(response.status)}${detail === '' ? '' : `：${detail}`}`)
  }
  try {
    return await response.json()
  } catch {
    throw new JiraFailure('jira-error', 'Jira 返回的内容不是 JSON：地址可能指向了登录页或反向代理页面。')
  }
}

/** Narrow one Jira status category color into a token-backed tone. */
function statusTone(colorName) {
  if (colorName === 'yellow') return 'progress'
  if (colorName === 'green') return 'done'
  if (colorName === 'blue-gray') return 'todo'
  return 'neutral'
}

/**
 * Assign a semantic tone to each priority so the panel never depends on
 * Jira's own palette (some of its colors are unreadable in a dark theme).
 *
 * Ranks follow the order the issues came back in, because the board query is
 * already ordered by priority. Sorting by priority id would only work inside
 * one Jira priority scheme: a server may hold several schemes side by side
 * (`Blocker/Critical/…` ids 1–5 next to `高/中/低` ids 10001+), and comparing
 * those ids across schemes orders them by accident, not by importance.
 * @param priorities - distinct priorities in first-seen order.
 * @returns priority id to tone.
 */
function priorityTones(priorities) {
  const tones = new Map()
  priorities.forEach((priority, index) => {
    tones.set(priority.id, ['danger', 'warn', 'info', 'neutral'][Math.min(index, 3)])
  })
  return tones
}

/**
 * Project one Jira issue onto the panel's view model.
 * @param issue - one entry of a Jira search result.
 * @param account - the account that produced it, for absolute links.
 * @param tones - priority id to semantic tone.
 * @returns the issue as the panel renders it.
 */
function toIssueView(issue, account, tones) {
  const fields = typeof issue.fields === 'object' && issue.fields !== null ? issue.fields : {}
  const rawPriority = fields.priority
  const priority = typeof rawPriority === 'object' && rawPriority !== null
    ? {
      id: String(rawPriority.id ?? ''),
      name: String(rawPriority.name ?? ''),
      tone: tones.get(String(rawPriority.id ?? '')) ?? 'neutral',
    }
    : null
  const status = typeof fields.status === 'object' && fields.status !== null
    ? {
      name: String(fields.status.name ?? ''),
      tone: statusTone(fields.status.statusCategory?.colorName),
    }
    : null
  const type = typeof fields.issuetype === 'object' && fields.issuetype !== null
    ? { name: String(fields.issuetype.name ?? '') }
    : null
  const project = typeof fields.project === 'object' && fields.project !== null
    ? { key: String(fields.project.key ?? ''), name: String(fields.project.name ?? '') }
    : null
  const key = String(issue.key ?? '')
  return {
    key,
    summary: typeof fields.summary === 'string' ? fields.summary : '',
    url: key === '' ? account.baseUrl : `${account.baseUrl}/browse/${key}`,
    priority,
    status,
    type,
    project,
    updated: typeof fields.updated === 'string' ? fields.updated : '',
    due: typeof fields.duedate === 'string' ? fields.duedate : '',
  }
}

/**
 * Group issues by priority in the order Jira returned them, so the board's
 * sections follow the query's own ordering instead of a second opinion.
 * @param issues - projected issues in Jira's order.
 * @returns one section per distinct priority, most important first.
 */
function groupByPriority(issues) {
  const sections = new Map()
  for (const issue of issues) {
    const id = issue.priority?.id ?? ''
    let section = sections.get(id)
    if (section === undefined) {
      section = { priority: issue.priority, issues: [] }
      sections.set(id, section)
    }
    section.issues.push(issue)
  }
  return [...sections.values()]
}

/**
 * Compose the account summary the panel may display: never the secret.
 * @param account - the stored account.
 * @param myself - the Jira user document, when it was read.
 * @returns displayable account facts.
 */
function accountSummary(account, myself) {
  const user = typeof myself === 'object' && myself !== null ? myself : {}
  return {
    baseUrl: account.baseUrl,
    authType: account.authType,
    username: account.username,
    displayName: typeof user.displayName === 'string' ? user.displayName : '',
    name: typeof user.name === 'string' ? user.name : '',
  }
}

/**
 * Build the plugin.
 * @param ctx - Host context of this plugin's fiber.
 * @param config - the row's configuration.
 */
export function apply(ctx, config) {
  const maxResults = clampMaxResults(config?.maxResults)
  const jql = typeof config?.jql === 'string' && config.jql.trim() !== '' ? config.jql.trim() : DEFAULT_JQL

  /** The credentials seam this composition mounts, if any. */
  const credentials = () => ctx.get('credentials')

  /** Report the current configuration state without revealing the secret. */
  const readStatus = async () => {
    const seam = credentials()
    if (seam === undefined) {
      return { ok: true, value: { configured: false, storageAvailable: false, jql, maxResults } }
    }
    const account = await readAccount(seam)
    if (account === undefined) {
      return { ok: true, value: { configured: false, storageAvailable: true, jql, maxResults } }
    }
    return {
      ok: true,
      value: { configured: true, storageAvailable: true, jql, maxResults, account: accountSummary(account) },
    }
  }

  /** Verify a candidate account against Jira and store it only when it works. */
  const saveAccount = async (payload) => {
    const seam = credentials()
    if (seam === undefined) {
      throw new JiraFailure('storage-unavailable', '当前组合未挂载凭据服务，无法保存 Jira 认证信息。')
    }
    const account = normalizeAccount(payload)
    const myself = await jiraRequest(account, '/rest/api/2/myself')
    await seam.modifyRecord(CREDENTIAL_KEY, async () => ({ kind: 'grant', payload: account }))
    return {
      ok: true,
      value: {
        configured: true,
        storageAvailable: true,
        jql,
        maxResults,
        account: accountSummary(account, myself),
      },
    }
  }

  /** Store nothing and let the next read report a blank account. */
  const clearAccount = async () => {
    const seam = credentials()
    if (seam === undefined) {
      throw new JiraFailure('storage-unavailable', '当前组合未挂载凭据服务，没有可清除的 Jira 认证信息。')
    }
    await seam.deleteRecord(CREDENTIAL_KEY)
    return { ok: true, value: { configured: false, storageAvailable: true, jql, maxResults } }
  }

  /** Read the current user's board from Jira. */
  const readBoard = async () => {
    const seam = credentials()
    if (seam === undefined) {
      throw new JiraFailure('not-configured', '还没有配置 Jira 连接：当前组合未挂载凭据服务。')
    }
    const account = await readAccount(seam)
    if (account === undefined) {
      throw new JiraFailure('not-configured', '还没有配置 Jira 连接：请先在面板里填写地址与认证信息。')
    }
    const myself = await jiraRequest(account, '/rest/api/2/myself')
    const search = await jiraRequest(account, '/rest/api/2/search', {
      jql,
      startAt: 0,
      maxResults,
      fields: ISSUE_FIELDS,
    })
    const rawIssues = Array.isArray(search.issues) ? search.issues : []
    // Distinct priorities in the order Jira returned them; that order already
    // carries the query's priority ranking, and it stays correct when a server
    // holds more than one priority scheme.
    const seen = new Map()
    for (const issue of rawIssues) {
      const id = String(issue.fields?.priority?.id ?? '')
      if (id !== '' && !seen.has(id)) {
        seen.set(id, { id, name: String(issue.fields?.priority?.name ?? '') })
      }
    }
    const tones = priorityTones([...seen.values()])
    const issues = rawIssues.map(issue => toIssueView(issue, account, tones))
    return {
      ok: true,
      value: {
        account: accountSummary(account, myself),
        jql,
        fetchedAt: new Date().toISOString(),
        total: typeof search.total === 'number' ? search.total : issues.length,
        returned: issues.length,
        groups: groupByPriority(issues),
      },
    }
  }

  /** Dispatch one endpoint, keeping the RPC result shape stable. */
  const handle = async (endpoint, payload) => {
    try {
      if (endpoint === 'status') return await readStatus()
      if (endpoint === 'save') return await saveAccount(payload)
      if (endpoint === 'clear') return await clearAccount()
      if (endpoint === 'board') return await readBoard()
      return { ok: false, error: { code: 'unknown-endpoint', message: `未知接口：${String(endpoint)}`, details: {} } }
    } catch (error) {
      if (error instanceof JiraFailure) {
        return { ok: false, error: { code: error.code, message: error.message, details: {} } }
      }
      ctx.logger?.warn?.(`dsh-jira-board: ${endpoint} failed`)
      ctx.logger?.warn?.(error)
      return { ok: false, error: { code: 'internal', message: `Jira 看板内部错误：${describe(error)}`, details: {} } }
    }
  }

  ctx.inject(['connection'], (inner) => {
    // `rpc.handle()` mounts its route on the context that READS `connection`
    // and registers the disposer there; that registration reads `webServer`,
    // so the reading context publishes it as one of its own properties.
    const owner = inner.extend({ webServer: inner.get('webServer') })
    owner.connection.rpc.handle(CHANNEL, (endpoint, payload) => handle(endpoint, payload))
  })
}

/**
 * Read the configured page size, clamped to the accepted range.
 * @param value - raw configuration value.
 * @returns the effective page size.
 */
function clampMaxResults(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_RESULTS
  return Math.min(MAX_RESULTS_LIMIT, Math.max(1, Math.trunc(value)))
}
