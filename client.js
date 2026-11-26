/**
 * dsh-jira-board — browser half.
 *
 * One global panel: the sidebar row selects it, and the panel shows the
 * current Jira account's own unfinished issues grouped by priority.
 *
 * Why the browser never talks to Jira
 * -----------------------------------
 * The account secret lives in the Host's credential file, so the page asks the
 * Host over one authenticated Connection RPC channel (`/dsh-jira-board`).
 * That keeps the secret out of the page, out of `cordis.patch.yml`, and out of
 * reach of every other plugin, and it means this bundle declares no
 * cross-origin permissions.
 *
 * State
 * -----
 * All panel state is component-local. The board is not session data, so
 * nothing is written into a Session log, and the only durable fact — the
 * account — is owned by the Host.
 */

window.__ModuleLoader__.load({
  id: 'dsh-jira-board',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = React

    /** Connection channel served by the Host half. */
    const CHANNEL = '/dsh-jira-board'

    /** Sidebar row id; the same id addresses this panel. */
    const PANEL_ID = 'jira-board'

    /** Dictionary namespace owned by this bundle. */
    const NS = 'jiraBoard'

    /**
     * Copy for every locale this bundle ships. The Host's locale service keeps
     * the active language; the panel reads it through the `t` seat.
     */
    const DICTIONARIES = {
      en: {
        panel: 'Jira board',
        title: 'Jira board',
        subtitle: 'My unfinished issues, most important first.',
        refresh: 'Refresh',
        refreshing: 'Refreshing…',
        retry: 'Retry',
        settings: 'Connection',
        save: 'Save and test',
        saving: 'Testing…',
        clear: 'Forget connection',
        baseUrl: 'Jira URL',
        baseUrlHint: 'Root address of your self-hosted Jira, for example https://jira.example.com',
        authType: 'Authentication',
        authBasic: 'User name and password',
        authBearer: 'Bearer token',
        username: 'User name',
        token: 'Password or token',
        tokenHint: 'Stored in the Harness credential file on this machine; it never reaches the page.',
        configured: 'Connected',
        unconfigured: 'Not connected',
        empty: 'No unfinished issue is assigned to you.',
        emptyHint: 'The board reports what Jira returns for your account.',
        loading: 'Reading the board from Jira…',
        total: 'issues',
        updated: 'Updated',
        due: 'Due',
        openInJira: 'Open in Jira',
        copyKey: 'Copy issue key',
        copied: 'Copied',
        copyFailed: 'Copy failed',
        saved: 'Connection saved and verified.',
        cleared: 'Connection forgotten.',
        noPriority: 'No priority',
        account: 'Account',
      },
      zh: {
        panel: 'Jira 看板',
        title: 'Jira 看板',
        subtitle: '我的未完成事项，按优先级从高到低排列。',
        refresh: '刷新',
        refreshing: '刷新中…',
        retry: '重试',
        settings: '连接设置',
        save: '保存并测试',
        saving: '测试中…',
        clear: '清除连接',
        baseUrl: 'Jira 地址',
        baseUrlHint: '自建 Jira 的根地址，例如 https://jira.example.com',
        authType: '认证方式',
        authBasic: '用户名与密码',
        authBearer: 'Bearer 令牌',
        username: '用户名',
        token: '密码或令牌',
        tokenHint: '保存在本机的 Harness 凭据文件中，不会进入页面。',
        configured: '已连接',
        unconfigured: '未连接',
        empty: '当前没有分配给你的未完成事项。',
        emptyHint: '看板展示的是 Jira 按你的账号返回的结果。',
        loading: '正在从 Jira 读取看板…',
        total: '条',
        updated: '更新于',
        due: '截止',
        openInJira: '在 Jira 中打开',
        copyKey: '复制编号',
        copied: '已复制',
        copyFailed: '复制失败',
        saved: '连接已保存并验证通过。',
        cleared: '连接已清除。',
        noPriority: '无优先级',
        account: '账号',
      },
    }

    /** The CSS this bundle owns; injected once and removed with the plugin. */
    const STYLE_ID = 'dsh-jira-board-style'
    const CSS = `
.jb-page {
  --jb-inset: clamp(24px, 4vw, 48px);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  height: 100%;
  padding: calc(var(--dsh-frame-top-clearance, 0px) + 24px) var(--jb-inset) 0;
  color: var(--dsw-alias-label-primary);
}
.jb-head {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
  padding-bottom: 16px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.jb-headText { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
.jb-title { font-size: 18px; font-weight: 600; margin: 0; }
.jb-subtitle { font-size: 13px; color: var(--dsw-alias-label-secondary); margin: 0; }
.jb-headActions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.jb-button {
  display: inline-flex; align-items: center; gap: 6px;
  appearance: none; cursor: pointer;
  height: 32px; padding: 0 12px;
  border-radius: var(--dsw-radius-sm, 8px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-button-floating-fill, transparent);
  color: var(--dsw-alias-label-primary);
  font-size: 13px; font-family: inherit;
}
.jb-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.jb-button:focus-visible { outline: 2px solid var(--dsw-alias-border-selected); outline-offset: 1px; }
.jb-button:disabled { cursor: default; color: var(--dsw-alias-label-dimmed); }
.jb-button[data-variant='primary'] {
  background: var(--dsw-alias-button-primary-fill);
  border-color: transparent;
  color: var(--dsw-alias-label-primary-foreground);
}
.jb-button[data-variant='primary']:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.jb-body { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 32px; }
.jb-group { margin-bottom: 14px; }
/* Groups stay on screen while their cards scroll under them, so a long board
   always says which priority the visible cards belong to. The background is a
   gradient rather than a solid block so the fade covers the row it replaces. */
.jb-groupHead {
  position: sticky; top: 0; z-index: 2;
  display: flex; align-items: center; gap: 8px;
  margin: 0 0 6px;
  padding: 4px 0 5px;
  font-size: 11px; font-weight: 600; letter-spacing: .02em;
  color: var(--dsw-alias-label-secondary);
  background: linear-gradient(to bottom, var(--dsw-alias-bg-base) 72%, transparent);
}
/* A hairline filling the leftover width, the way the host's section rules do. */
.jb-groupHead::after {
  content: '';
  flex: 1;
  height: 0.5px;
  min-width: 12px;
  background: var(--dsw-alias-border-l2);
}
.jb-count { font-weight: 400; color: var(--dsw-alias-label-tertiary); }
/* Cards, not rows: at a typical panel width this fits four to five per line, so
   one screen shows roughly twice as many issues as a one-line-per-issue list. */
.jb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 7px;
  align-items: stretch;
}
.jb-card {
  display: flex; flex-direction: column; gap: 4px;
  min-width: 0;
  padding: 6px 8px 7px;
  border-radius: var(--dsw-radius-md, 12px);
  /* A 0.5px hairline frame, the host's frame treatment; the hover state swaps
     it for the elevation trio's own stroke so the shadow carries it. */
  border: 0.5px solid var(--dsw-alias-border-l4);
  background: var(--dsw-alias-card-fill);
  transition:
    transform var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease),
    box-shadow var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease),
    border-color var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease),
    background-color var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease);
}
/* The card is deliberately not a link: the key copies and the trailing control
   opens Jira, so a whole-card link would make every click ambiguous. */
@media (hover: hover) {
  .jb-card:hover {
    transform: translateY(-1px);
    border-color: transparent;
    box-shadow: var(--dsw-elevation-panel);
    background: var(--dsw-alias-card-fill-hover);
  }
}
@media (prefers-reduced-motion: reduce) {
  .jb-card { transition: none; }
  .jb-card:hover { transform: none; }
}
.jb-cardTop { display: flex; align-items: center; justify-content: space-between; gap: 4px; min-height: 18px; }
.jb-cardTop .jb-open { width: 22px; height: 22px; }
/* Two lines cover most summaries; the full text stays in the DOM and is shown
   in the hover card, so nothing is lost to the clamp. */
.jb-cardTitle {
  margin: 0;
  font-size: 12.5px; line-height: 1.35;
  color: var(--dsw-alias-label-primary);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.jb-cardMeta {
  display: flex; align-items: center; gap: 6px;
  min-height: 14px;
  font-size: 11px; line-height: 14px; color: var(--dsw-alias-label-tertiary);
  white-space: nowrap; overflow: hidden;
}
.jb-cardMeta .jb-chip { padding: 0 6px; line-height: 14px; }
/* Fixed so the body's scroll container cannot clip it, and pointer-transparent
   so it never steals the hover it belongs to. */
.jb-tip {
  position: fixed;
  z-index: 60;
  max-width: 360px;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-md, 12px);
  /* The host's floating-surface treatment carries its own 0.5px stroke. */
  border: 0;
  box-shadow: var(--dsw-elevation-prominent);
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-2));
  color: var(--dsw-alias-label-primary);
  font-size: 12px; line-height: 1.5;
  overflow-wrap: anywhere;
  pointer-events: none;
}
.jb-tipKey {
  display: block;
  font-family: var(--dsw-font-family-code, monospace);
  font-size: 11px; color: var(--dsw-alias-link);
  margin-bottom: 2px;
}
.jb-key {
  flex: none;
  display: inline-flex; align-items: center; gap: 4px;
  appearance: none; cursor: pointer;
  padding: 1px 5px;
  border: 1px solid transparent;
  border-radius: var(--dsw-radius-xs, 4px);
  background: none;
  font-family: var(--dsw-font-family-code, monospace);
  font-size: 12px; line-height: 1.5;
  color: var(--dsw-alias-link);
}
@media (hover: hover) {
  .jb-key:hover { background: var(--dsw-alias-interactive-bg-hover); border-color: var(--dsw-alias-border-l2); }
}
.jb-key:focus-visible { outline: 2px solid var(--dsw-alias-border-selected); outline-offset: 1px; }
.jb-key[data-state='copied'] { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-secondary); }
.jb-key[data-state='failed'] { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-secondary); }
.jb-keyMark { font-size: 11px; line-height: 1; }
.jb-open {
  flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px;
  border-radius: var(--dsw-radius-xs, 4px);
  border: 1px solid transparent;
  color: var(--dsw-alias-label-secondary);
}
@media (hover: hover) {
  .jb-open:hover {
    background: var(--dsw-alias-interactive-bg-hover);
    border-color: var(--dsw-alias-border-l2);
    color: var(--dsw-alias-label-primary);
  }
}
.jb-open:focus-visible { outline: 2px solid var(--dsw-alias-border-selected); outline-offset: 1px; }
/* Announce copy feedback without adding a visible line to every row. */
.jb-sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
}
/* Soft tinted pills instead of outlined ones: the fill derives from the chip's
   own colour, so one rule themes every tone and both palettes. The outline
   stays as the fallback for an engine without colour-mix. */
.jb-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 7px; border-radius: 999px;
  font-size: 11px; line-height: 15px; white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  background: color-mix(in srgb, currentColor 10%, transparent);
}
.jb-chip[data-tone='danger'] { color: var(--dsw-alias-state-error-primary); }
.jb-chip[data-tone='warn'] { color: var(--dsw-alias-state-warn-primary); }
.jb-chip[data-tone='progress'] { color: var(--dsw-alias-state-business-primary); }
.jb-chip[data-tone='done'] { color: var(--dsw-alias-state-success-primary); }
.jb-placeholder {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  min-height: 220px; padding: 32px;
  text-align: center;
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md, 12px);
  color: var(--dsw-alias-label-secondary);
}
.jb-placeholderTitle { font-size: 14px; color: var(--dsw-alias-label-primary); }
.jb-placeholderHint { font-size: 12px; color: var(--dsw-alias-label-tertiary); max-width: 46ch; }
.jb-error {
  display: flex; flex-direction: column; gap: 12px; align-items: flex-start;
  padding: 16px;
  border: 1px solid var(--dsw-alias-state-error-secondary);
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-bg-layer-1);
  font-size: 13px;
}
.jb-form { display: flex; flex-direction: column; gap: 16px; max-width: 560px; }
.jb-field { display: flex; flex-direction: column; gap: 6px; }
.jb-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.jb-input, .jb-select {
  height: 34px; box-sizing: border-box;
  padding: 0 10px;
  border-radius: var(--dsw-radius-sm, 8px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: 13px; font-family: inherit;
}
.jb-input:focus-visible, .jb-select:focus-visible { outline: 2px solid var(--dsw-alias-border-selected); outline-offset: -1px; }
.jb-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.jb-formActions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 4px; }
.jb-notice { font-size: 12px; color: var(--dsw-alias-state-success-primary); }
.jb-status {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--dsw-alias-label-tertiary);
}
.jb-status::before {
  content: '';
  width: 5px; height: 5px; border-radius: 50%;
  background: currentColor;
  opacity: .55;
}
.jb-status[data-configured='true']::before { opacity: 1; }
.jb-status[data-configured='true'] { color: var(--dsw-alias-state-success-primary); }
@media (pointer: coarse) {
  .jb-input, .jb-select { font-size: 16px; }
}
`

    /** Install the bundle stylesheet once per page while this plugin is mounted. */
    function installStyles() {
      if (document.getElementById(STYLE_ID) !== null) return () => {}
      const element = document.createElement('style')
      element.id = STYLE_ID
      element.setAttribute('data-plugin', 'dsh-jira-board')
      element.textContent = CSS
      document.head.append(element)
      return () => { element.remove() }
    }

    /** Report one failed call as a sentence the panel can show. */
    function failureText(reply) {
      const error = reply?.error
      if (typeof error?.message === 'string' && error.message !== '') return error.message
      return '与 Harness Host 通信失败。'
    }

    /**
     * Call one Host endpoint over this plugin's authenticated RPC channel.
     * @param {object} connection - the client `connection` service.
     * @param {string} endpoint - Host endpoint name.
     * @param {unknown} payload - request payload.
     * @param {AbortSignal} signal - cancellation for the in-flight call.
     */
    function call(connection, endpoint, payload, signal) {
      return connection.rpc.call(CHANNEL, endpoint, payload, signal)
    }

    /** Format one ISO timestamp for display, or an empty string. */
    function formatDate(iso, locale) {
      if (typeof iso !== 'string' || iso === '') return ''
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return ''
      return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
    }

    /**
     * Format one ISO timestamp as a compact relative age, because a card's meta
     * line is narrow and "3 days ago" carries more than an absolute date at the
     * same width. Anything older than a month falls back to the date: "412 days
     * ago" is both long and useless.
     * @param {string} iso - timestamp from Jira, including its numeric offset.
     * @param {string} locale - active locale id.
     * @param {(key: string) => string} t - the card's namespace translator.
     * @returns {string} display text, or an empty string for an unusable value.
     */
    function formatRelative(iso, locale, t) {
      if (typeof iso !== 'string' || iso === '') return ''
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return ''
      const minutes = Math.round((date.getTime() - Date.now()) / 60000)
      const magnitude = Math.abs(minutes)
      const dated = `${t('updated')} ${formatDate(iso, locale)}`
      if (magnitude > 60 * 24 * 30) return dated
      try {
        const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
        if (magnitude < 60) return `${t('updated')} ${relative.format(minutes, 'minute')}`
        if (magnitude < 60 * 24) return `${t('updated')} ${relative.format(Math.round(minutes / 60), 'hour')}`
        return `${t('updated')} ${relative.format(Math.round(minutes / (60 * 24)), 'day')}`
      } catch {
        // A locale the runtime cannot resolve keeps the plain date instead.
        return dated
      }
    }

    /**
     * Place one string on the clipboard.
     *
     * The async Clipboard API is preferred, but it rejects outside a secure
     * context or without permission; a desktop window and a loopback page both
     * satisfy it, a page served over plain HTTP to another host does not. The
     * selection fallback keeps the key copyable there instead of failing.
     * @param {string} text - exact text to copy.
     * @returns {Promise<boolean>} whether the copy succeeded.
     */
    async function copyText(text) {
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch {
        // Rejected: fall through to the selection path below.
      }
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.top = '-1000px'
        area.style.opacity = '0'
        document.body.append(area)
        area.select()
        const ok = typeof document.execCommand === 'function' && document.execCommand('copy')
        area.remove()
        return ok === true
      } catch {
        return false
      }
    }

    /** The external-link glyph the row's jump control draws. */
    function OpenInJiraIcon() {
      return h('svg', {
        viewBox: '0 0 16 16', width: 14, height: 14,
        'aria-hidden': true, focusable: 'false',
      },
        h('path', {
          d: 'M6.5 3.5h-3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3',
          fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round',
        }),
        h('path', {
          d: 'M9.5 2.5h4v4',
          fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5,
          'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        }),
        h('path', {
          d: 'M13.5 2.5 7.5 8.5',
          fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round',
        }),
      )
    }

    /**
     * One issue card: a key that copies, the summary clamped to two lines, its
     * metadata, and the control that opens the issue in Jira.
     *
     * The clamp is visual only — the full summary stays in the DOM for assistive
     * technology and for the copy path — and the hover card appears when the
     * rendered title actually overflows, so short titles get no redundant popup.
     */
    function IssueCard({ issue, t, locale, onTip }) {
      const updated = formatDate(issue.updated, locale)
      const due = formatDate(issue.due, locale)
      const [copyState, setCopyState] = useState('idle')
      const resetTimer = useRef(null)
      const titleRef = useRef(null)

      // A card can unmount (refresh, group change) while its confirmation timer
      // is pending; clearing on unmount keeps the timer from touching it.
      useEffect(() => () => {
        if (resetTimer.current !== null) clearTimeout(resetTimer.current)
      }, [])

      const copyKey = async () => {
        const ok = await copyText(issue.key)
        setCopyState(ok ? 'copied' : 'failed')
        if (resetTimer.current !== null) clearTimeout(resetTimer.current)
        resetTimer.current = setTimeout(() => { setCopyState('idle') }, 1600)
      }

      const feedback = copyState === 'copied' ? t('copied') : copyState === 'failed' ? t('copyFailed') : t('copyKey')

      /**
       * Ask the panel for the hover card, but only when the clamped title is
       * actually cut off.
       *
       * The panel renders it, not this card: the hovered card is translated by
       * a transform, and a transformed element becomes the containing block for
       * its `position: fixed` descendants. A popup rendered here would be
       * positioned against the card instead of the viewport, which is what put
       * it far from the pointer.
       */
      const showTip = (event) => {
        const node = titleRef.current
        if (node === null || node.scrollHeight <= node.clientHeight + 1) return
        const rect = event.currentTarget.getBoundingClientRect()
        const width = Math.min(360, window.innerWidth - 16)
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
        // Below the card by default; above it when the viewport has no room.
        const placeAbove = rect.bottom + 96 > window.innerHeight
        onTip({
          left,
          width,
          ...(placeAbove
            ? { bottom: window.innerHeight - rect.top + 6 }
            : { top: rect.bottom + 6 }),
          key: issue.key,
          summary: issue.summary,
        })
      }

      const hideTip = () => { onTip(null) }

      return h('div', { className: 'jb-card' },
        h('div', { className: 'jb-cardTop' },
          h('button', {
            className: 'jb-key',
            type: 'button',
            'data-state': copyState,
            title: feedback,
            'aria-label': `${t('copyKey')}: ${issue.key}`,
            onClick: copyKey,
          },
            h('span', {}, issue.key),
            copyState === 'idle'
              ? null
              : h('span', { className: 'jb-keyMark', 'aria-hidden': 'true' }, copyState === 'copied' ? '✓' : '!'),
          ),
          h('a', {
            className: 'jb-open',
            href: issue.url,
            target: '_blank',
            rel: 'noreferrer noopener',
            title: t('openInJira'),
            'aria-label': `${t('openInJira')}: ${issue.key}`,
          }, h(OpenInJiraIcon)),
        ),
        h('p', {
          className: 'jb-cardTitle',
          ref: titleRef,
          onMouseEnter: showTip,
          onMouseLeave: hideTip,
        }, issue.summary),
        h('div', { className: 'jb-cardMeta' },
          issue.status === null ? null : h('span', { className: 'jb-chip', 'data-tone': issue.status.tone }, issue.status.name),
          due === '' ? null : h('span', {}, `${t('due')} ${due}`),
          updated === '' ? null : h('span', {}, formatRelative(issue.updated, locale, t)),
        ),
        h('span', { className: 'jb-sr', role: 'status' }, copyState === 'idle' ? '' : feedback),
      )
    }

    /** The connection form: address, auth mode, and the secret. */
    function ConnectionForm({ t, status, onSaved, onCleared }) {
      const account = status?.account
      const [baseUrl, setBaseUrl] = useState(account?.baseUrl ?? '')
      const [authType, setAuthType] = useState(account?.authType ?? 'basic')
      const [username, setUsername] = useState(account?.username ?? '')
      const [token, setToken] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')

      // Keep the form in step with the Host's saved account without discarding
      // what the human is currently typing into the secret field.
      useEffect(() => {
        setBaseUrl(account?.baseUrl ?? '')
        setAuthType(account?.authType ?? 'basic')
        setUsername(account?.username ?? '')
      }, [account?.baseUrl, account?.authType, account?.username])

      const submit = async (event) => {
        event.preventDefault()
        if (busy) return
        setBusy(true)
        setError('')
        setNotice('')
        try {
          await onSaved({ baseUrl, authType, username, token })
          setToken('')
          setNotice(t('saved'))
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy(false)
        }
      }

      const clear = async () => {
        if (busy) return
        setBusy(true)
        setError('')
        setNotice('')
        try {
          await onCleared()
          setToken('')
          setNotice(t('cleared'))
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy(false)
        }
      }

      const field = (label, control, hint) => h('div', { className: 'jb-field' },
        h('label', { className: 'jb-label' }, label),
        control,
        hint === undefined ? null : h('span', { className: 'jb-hint' }, hint),
      )

      return h('form', { className: 'jb-form', onSubmit: submit },
        field(t('baseUrl'), h('input', {
          className: 'jb-input',
          type: 'text',
          value: baseUrl,
          placeholder: 'https://jira.example.com',
          spellCheck: false,
          autoComplete: 'off',
          onChange: (event) => { setBaseUrl(event.target.value) },
        }), t('baseUrlHint')),
        field(t('authType'), h('select', {
          className: 'jb-select',
          value: authType,
          onChange: (event) => { setAuthType(event.target.value) },
        },
          h('option', { value: 'basic' }, t('authBasic')),
          h('option', { value: 'bearer' }, t('authBearer')),
        )),
        authType === 'basic'
          ? field(t('username'), h('input', {
            className: 'jb-input',
            type: 'text',
            value: username,
            spellCheck: false,
            autoComplete: 'username',
            onChange: (event) => { setUsername(event.target.value) },
          }))
          : null,
        field(t('token'), h('input', {
          className: 'jb-input',
          type: 'password',
          value: token,
          autoComplete: 'current-password',
          onChange: (event) => { setToken(event.target.value) },
        }), t('tokenHint')),
        error === '' ? null : h('div', { className: 'jb-error', role: 'alert' }, error),
        notice === '' ? null : h('div', { className: 'jb-notice', role: 'status' }, notice),
        h('div', { className: 'jb-formActions' },
          h('button', { className: 'jb-button', type: 'submit', 'data-variant': 'primary', disabled: busy },
            busy ? t('saving') : t('save')),
          h('button', {
            className: 'jb-button',
            type: 'button',
            disabled: busy || account === undefined,
            onClick: clear,
          }, t('clear')),
        ),
      )
    }

    /** The board itself: header, refresh, groups, and every placeholder state. */
    function JiraBoardPanel(props) {
      const { connection, locale, t } = props
      // The outlet re-renders on every locale revision, so reading the active
      // id here keeps date formatting in step with the shell's language.
      const localeId = locale.getSnapshot().active
      const [status, setStatus] = useState(null)
      const [board, setBoard] = useState(null)
      const [loading, setLoading] = useState(true)
      const [refreshing, setRefreshing] = useState(false)
      const [error, setError] = useState('')
      const [showSettings, setShowSettings] = useState(false)
      // One popup for the whole board, held here so it is never a descendant of
      // a hovering card (whose transform would capture its fixed positioning).
      const [tip, setTip] = useState(null)
      const tipRef = useRef(null)

      /**
       * Make the popup land on the viewport coordinates it asked for.
       *
       * `position: fixed` resolves against the viewport only while no ancestor
       * forms a containing block for it; a transformed, filtered, or contained
       * ancestor silently rebases it, which is exactly how a popup ends up far
       * from its card. Rather than trust every ancestor, this measures the
       * rendered box once before paint and translates by the difference. A
       * popup already in place is left untouched.
       */
      useLayoutEffect(() => {
        const node = tipRef.current
        if (node === null || tip === null) return
        node.style.transform = 'none'
        const rect = node.getBoundingClientRect()
        const wantedTop = tip.top === undefined
          ? window.innerHeight - tip.bottom - rect.height
          : tip.top
        const dx = tip.left - rect.left
        const dy = wantedTop - rect.top
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
        node.style.transform = `translate(${String(dx)}px, ${String(dy)}px)`
      }, [tip])
      const inflight = useRef(null)

      /** Read the Host's connection state, then the board when it is configured. */
      const load = useCallback(async ({ manual } = {}) => {
        inflight.current?.abort()
        const controller = new AbortController()
        inflight.current = controller
        if (manual === true) setRefreshing(true)
        else setLoading(true)
        setError('')
        setTip(null)
        try {
          const statusReply = await call(connection, 'status', {}, controller.signal)
          if (controller.signal.aborted) return
          if (statusReply.ok !== true) throw new Error(failureText(statusReply))
          const nextStatus = statusReply.value
          setStatus(nextStatus)
          if (nextStatus.configured !== true) {
            setBoard(null)
            setShowSettings(true)
            return
          }
          const boardReply = await call(connection, 'board', {}, controller.signal)
          if (controller.signal.aborted) return
          if (boardReply.ok !== true) throw new Error(failureText(boardReply))
          setBoard(boardReply.value)
          setShowSettings(false)
        } catch (failure) {
          if (controller.signal.aborted) return
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          if (!controller.signal.aborted) {
            setLoading(false)
            setRefreshing(false)
          }
        }
      }, [connection])

      useEffect(() => {
        void load()
        return () => { inflight.current?.abort() }
      }, [load])

      const saveAccount = async (draft) => {
        const reply = await call(connection, 'save', draft)
        if (reply.ok !== true) throw new Error(failureText(reply))
        setStatus(reply.value)
        await load({ manual: true })
      }

      const clearAccount = async () => {
        const reply = await call(connection, 'clear', {})
        if (reply.ok !== true) throw new Error(failureText(reply))
        setStatus(reply.value)
        setBoard(null)
        setShowSettings(true)
      }

      const groups = board?.groups ?? []
      const configured = status?.configured === true

      const body = (() => {
        if (error !== '' && board === null) {
          return h('div', { className: 'jb-error', role: 'alert' },
            h('span', {}, error),
            h('button', { className: 'jb-button', type: 'button', onClick: () => { void load({ manual: true }) } }, t('retry')),
          )
        }
        if (loading) {
          return h('div', { className: 'jb-placeholder' }, h('span', { className: 'jb-placeholderTitle' }, t('loading')))
        }
        if (showSettings || !configured) {
          return h(ConnectionForm, { t, status, onSaved: saveAccount, onCleared: clearAccount })
        }
        if (groups.length === 0) {
          return h('div', { className: 'jb-placeholder' },
            h('span', { className: 'jb-placeholderTitle' }, t('empty')),
            h('span', { className: 'jb-placeholderHint' }, t('emptyHint')),
          )
        }
        return h('div', {},
          error === '' ? null : h('div', { className: 'jb-error', role: 'alert' }, error),
          groups.map(group => h('section', { className: 'jb-group', key: group.priority?.id ?? 'none' },
            h('h2', { className: 'jb-groupHead' },
              h('span', { className: 'jb-chip', 'data-tone': group.priority?.tone ?? 'neutral' },
                // A real server may return a priority whose name is empty; `||` keeps
                // that case on the localized label instead of an empty chip.
                group.priority?.name || t('noPriority')),
              h('span', { className: 'jb-count' }, String(group.issues.length)),
            ),
            h('div', { className: 'jb-grid' },
              group.issues.map(issue => h(IssueCard, { key: issue.key, issue, t, locale: localeId, onTip: setTip })),
            ),
          )),
        )
      })()

      return h('div', { className: 'jb-page' },
        h('header', { className: 'jb-head' },
          h('div', { className: 'jb-headText' },
            h('h1', { className: 'jb-title' }, t('title')),
            h('p', { className: 'jb-subtitle' }, t('subtitle')),
            h('span', { className: 'jb-status', 'data-configured': String(configured) },
              configured
                ? `${t('configured')}${board?.account?.displayName ? ` · ${board.account.displayName}` : ''}${board ? ` · ${String(board.total)} ${t('total')}` : ''}`
                : t('unconfigured'),
            ),
          ),
          h('div', { className: 'jb-headActions' },
            h('button', {
              className: 'jb-button',
              type: 'button',
              onClick: () => { void load({ manual: true }) },
              disabled: loading || refreshing || !configured,
            }, refreshing ? t('refreshing') : t('refresh')),
            configured && !showSettings
              ? h('button', { className: 'jb-button', type: 'button', onClick: () => { setShowSettings(true) } }, t('settings'))
              : null,
          ),
        ),
        h('div', { className: 'jb-body' }, body),
        tip === null ? null : h('div', {
          className: 'jb-tip',
          role: 'tooltip',
          ref: tipRef,
          style: {
            left: `${String(tip.left)}px`,
            width: `${String(tip.width)}px`,
            ...(tip.top === undefined ? {} : { top: `${String(tip.top)}px` }),
            ...(tip.bottom === undefined ? {} : { bottom: `${String(tip.bottom)}px` }),
          },
        },
          h('span', { className: 'jb-tipKey' }, tip.key),
          h('span', {}, tip.summary),
        ),
      )
    }

    /** Palette glyph for the sidebar row: a three-column board mark. */
    function JiraBoardIcon({ size }) {
      return h('svg', {
        viewBox: '0 0 36 36',
        width: size,
        height: size,
        'aria-hidden': true,
        style: { display: 'block' },
      },
        h('rect', { x: 5, y: 9, width: 7, height: 18, rx: 1.6, fill: 'currentColor', opacity: 0.45 }),
        h('rect', { x: 14.5, y: 9, width: 7, height: 13, rx: 1.6, fill: 'currentColor', opacity: 0.72 }),
        h('rect', { x: 24, y: 9, width: 7, height: 8, rx: 1.6, fill: 'currentColor' }),
      )
    }

    return {
      inject: ['slots', 'locale', 'connection'],
      apply(ctx) {
        ctx.effect(() => installStyles(), 'dsh-jira-board: stylesheet')
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'dsh-jira-board: dictionaries')
        const t = ctx.locale.bind(NS)

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({ connection: ctx.connection, locale: ctx.locale }),
        }, JiraBoardPanel))

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          locale: NS,
          label: () => t('panel'),
        }, JiraBoardIcon))
      },
    }
  },
})
