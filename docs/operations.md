# 运维与恢复

## 文件位置

| 位置 | 内容 |
|---|---|
| 面板 `/app/data/panel.sqlite` | 管理员哈希、会话、节点、任务、审计 |
| 节点 `/etc/vaio-agent/config.json` | 面板地址和节点身份凭据，0600 |
| 节点 `/opt/vaio-agent` | Agent 程序及固定原脚本快照 |
| 节点 `/var/lib/vaio-agent/journal.json` | 执行记录，用于重启恢复与去重 |
| 节点 `/var/lib/vaio-agent/runtime.log` | 命令原始输出，可能含敏感信息，0600 |
| 节点 `/var/lib/vaio-agent/backups/{任务ID}` | 修改前数据库与配置文件、文件路径清单 |
| 节点 `/etc/vless-reality` | 原脚本数据库和协议配置 |

## 排错

面板：`docker compose logs --tail=100 panel caddy`。

节点 systemd：`systemctl status vaio-agent` 和 `journalctl -u vaio-agent -n 100`。

节点 OpenRC：`rc-service vaio-agent status`，日志在 `/var/lib/vaio-agent/agent.log`。

代理操作失败：在节点检查 `/var/lib/vaio-agent/runtime.log`。不要直接将包含凭据的完整日志公开上传。

Agent 网络失败最多退避至约 60 秒，恢复后自动重连。若注册成功但身份文件未成功保存，重新在面板生成安装脚本；旧注册令牌不会复用。

重新注册会撤销原节点身份、取消待执行任务并清除接管状态。运行中任务不允许重新注册。撤销节点身份无法中止已经在节点执行的任务。

## 恢复原则

自动回滚以恢复配置和服务为目标，不撤销系统包或二进制安装。报告“回滚未完全恢复”时，先停止 Agent，核对备份路径、目标实例以及共享服务，再人工恢复。

不要未经核对直接覆盖整个 `db.json`：备份之后的使用量、其他手动修改可能更晚。`manifest.json` 按顺序记录目标路径，数字文件为对应备份；原本不存在的文件没有备份。

当任务显示“待核对”，先检查节点当前端口/服务和本地 journal。系统不会重复执行有歧义的任务，也不能保证安装中断后无需人工恢复。

## 备份与保留

定期备份面板数据卷与各节点配置、备份目录。面板数据库使用 SQLite，在线备份请使用 SQLite backup API，或停止面板后复制数据库文件。

首版不自动删除操作审计、任务、节点 journal 和配置备份。根据节点规模自行制定保留策略，清理前备份；不要删除执行中任务的记录。runtime.log 达到 5 MiB 会在下次执行前截断。

## 更新与卸载

面板：备份数据后 `git pull --ff-only`、`docker compose build`、`docker compose up -d`。首版暂无数据库版本迁移框架，大版本升级应遵循后续发行说明。

Agent：完成当前任务后重新生成安装脚本并安装；重新确认接管。不要在任务执行过程中替换 Agent 文件。

只卸载 Agent 时先撤销节点身份，再停止并禁用 `vaio-agent` 服务，移除对应 unit 与 `/opt/vaio-agent`。保留 `/etc/vless-reality`，现有代理不随 Agent 卸载。确认不再需要恢复记录后再删除 `/etc/vaio-agent` 和 `/var/lib/vaio-agent`。

Agent 停止后，面板用户到期检查不再运行；原脚本的既有定时任务不受此操作影响。
