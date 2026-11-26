# dsh-jira-board

在 DeepSeek Harness 左侧栏加一个 **Jira 看板**入口，展示**当前 Jira 账号名下未完成的事项**，按优先级从高到低分组。

目标环境是**自建 Jira Server 7.x**（`/rest/api/2`）。

## 它怎么工作

```
左侧栏「Jira 看板」→ 主面板
        ↓ Connection RPC（已认证，同源）
     Host 半（唯一持有凭据、唯一访问 Jira 的一方）
        ↓ HTTP Basic / Bearer
     你的 Jira  →  /rest/api/2/myself、/rest/api/2/search
```

- **密码/令牌不出现在页面里**：页面只向 Host 要结果，凭据存在本机的 Harness 凭据文件中（`dsh-jira-board/account` 记录），也不写进 `cordis.patch.yml`。
- **不经过浏览器直连 Jira**：没有跨域、没有 CORS 配置、没有把 token 暴露给前端的问题。
- **保存前先验证**：点「保存并测试」会先调用 `/rest/api/2/myself`，验证通过才落盘。

## 使用

1. 打开左侧栏的 **Jira 看板**。
2. 首次进入会显示连接设置：填 **Jira 地址**（根地址，例如 `https://jira.example.com`）、认证方式、用户名与密码/令牌。
3. 点 **保存并测试**。
4. 看板按优先级分组，每组内是自适应网格的小卡片；点 **刷新** 按需重新读取。

每张卡片：

- **编号**（如 `ZGLT-125`）：点击复制，卡内短暂显示 ✓；剪贴板 API 不可用时自动回退到选区复制。
- **右上 ↗**：在新标签页打开该事项的 Jira 页面。卡片整体不是链接，避免「想复制却跳走」。
- **标题**：最多两行，超出显示省略号；完整标题仍在页面里，**鼠标悬浮**（且确实被截断时）弹出浮层显示全文。
- **状态与时间**：状态标签 + 相对更新时间（超过一个月回落为日期）。

密度参考：1200×700 的面板约可同时看到 40 张卡片，旧的单行列表约 13 条。

认证方式两种：

| 方式 | 适用 |
| --- | --- |
| 用户名与密码 | Jira Server 7.x 原生支持；建议用专门的只读服务账号 |
| Bearer 令牌 | 前面有反向代理或插件负责校验时使用 |

> Jira Server 7.10 没有 Personal Access Token，所以这里不提供 PAT 选项。若密码登录被禁用（例如接了 SSO），请用 Bearer 方式或申请服务账号。

## 默认查询

```
assignee = currentUser() AND resolution = Unresolved ORDER BY priority DESC, updated DESC
```

默认 50 条。两者都可以在 `cordis.patch.yml` 的 `dsh-jira-board` 行里改：

```yaml
- id: dsh-jira-board
  name: dsh-jira-board
  config:
    maxResults: 50
    jql: 'assignee = currentUser() AND resolution = Unresolved ORDER BY priority DESC'
```

`maxResults` 上限 200。

## 限制

- 只读：看板不回写 Jira。
- 只展示**分配给当前账号**的事项，不是整个项目的看板。
- 优先级分组跟随 Jira 返回的顺序，颜色由本插件指定，不使用 Jira 自带配色（那些颜色在深色主题下不可读）。
- 需要 Host 侧挂载凭据服务（`@deepseek-ai/dsh-credentials-local`，base 组合默认提供）。未挂载时会明确提示，而不是静默失败。
