# Proposal

## Why

`mxenv-panel-host`（0.14.0）落了会话式宿主与值安全 API 面，但今天它只有 API 没有面板：`mxenv gui` 打开的浏览器页落在 404，键总览、揭示、管理全部要靠 curl。同时宿主是**单项目视角**（会话绑定启动时的 cwd），"这台机器上托管了哪些项目、全局基线里有什么"没有入口。ux-architecture 74 行钉的常驻化触发器已由用户触发（2026-11-18：要一个**查看与管理全局+项目级已托管面的全局面板**，并作为远程管理方案）。场景④（远程机管理，OPEN-REGISTER 记录的真缺口）从此有了承载形态。

## What Changes

- **面板 UI（B2 落地）**：L3 宿主服务静态面板 bundle（`GET /{token}/` 校验 token-in-path 后发 HTML/JS，后续 API 走既有 Bearer + `x-mxenv-panel` 头）。UI = 范围侧栏（全局 / 各项目 / 各远程）+ 键表（names-only）+ 解锁窗口内逐键 reveal / set / delete + doctor 摘要。
- **项目注册表（新概念）**：`~/.mxenv/projects.json`（0600）登记已托管项目 `{name, path, addedAt, lastSeenAt}`；项目级 run/edit 首次成功组合即登记（幂等），`mxenv panel add/remove` 显式管理，`MXENV_NO_PROJECT_REGISTRY=1` 关闭。面板据此枚举"已经托管的"项目。
- **多范围读**：宿主 API 扩 `GET /scopes`（全局+项目清单）与按范围参数化的 `/keys?scope=global|project:<name>`（项目读在宿主进程内经 L1 以 `baseDir` 切换，不 spawn）。
- **写回（管理面）**：解锁窗口内 `POST /set|/delete`（本地文件 / dotenvx 重加密 / 全局基线 `~/.mxenv/.env`）；动作语义 = 编辑器既有白名单 set/delete，核心从 L2 editor 提取为 L1 能力（`edit-actions`）供 L2/L3 双消费，审计并轨 `via: 'host'`。远程 provider（Infisical/Doppler）写回**不在本 change**（= remote-source 真编辑，独立 change）。
- **常驻模式（additive）**：`mxenv gui install|uninstall` 生成 launchd（macOS）/ systemd --user（Linux）单元；常驻会话 TTL 无限、空闲仍默认锁定、unlock 窗口语义不变、`close` 仍可终。端口默认随机（runtime.json 发现），`--port` 可选固定（远程/自动化用）。
- **远程管理（契约先行）**：`~/.mxenv/remotes.json` 登记 `{name, host, port?, transport: 'ssh'}`；面板把远程范围经 SSH 隧道（`ssh -L`，零新密码学）指向**同一套宿主 API**。本 change 交付：远程登记 + 面板侧范围切换 + 隧道指令提示；云端 relay / mTLS 后置。

## Capabilities

### New Capabilities

- `global-panel`: 项目注册表与已托管面枚举、面板 UI 服务与认证、多范围读、解锁窗口内的写回管理、常驻生命周期（install/uninstall/单元生成）、远程范围登记与 SSH 隧道契约、值红线不变式。

### Modified Capabilities

- `panel-host`（additive）: 会话生命周期补常驻模式（TTL 无限可选）；API 面扩 scopes/set/delete 与静态 UI 服务；消费者边界从 reveal/unlock 扩到写端点。

## Impact

- **mxenv-core**（minor）: `projects.json`/`remotes.json` 读写能力（0600、幂等、MXENV_NO_PROJECT_REGISTRY）；`edit-actions` 提取（编辑器动作核心下沉）；审计 additive（写动作已有枚举，via 扩用 `'host'`）。
- **mxenv-cli**（minor）: `gui install|uninstall`；宿主 API/UI 扩展；panel-ui bundle（自有资产目录，构建期生成，不 import L2——产品包零依赖纪律不破）。
- **mxenv**（跟随）: `edit` 改为消费 L1 `edit-actions`（行为不变）；项目登记埋点。
- **运行时目录**: `~/.mxenv/projects.json`、`~/.mxenv/remotes.json`（均 0600）。
- **测试面**: 宿主 API 集成（临时 HOME + 假 token）扩 scopes/write；注册表幂等；单元文件生成快照；全门护航。
- **非目标**: 远程 provider 写回（remote-source editing，独立 change）；云 relay/mTLS；Windows 自启；移动端。
