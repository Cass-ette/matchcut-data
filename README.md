# Matchcut Data

[Matchcut](https://github.com/Cass-ette/matchcut) 的独立资料库，维护选手身份、战队别名、队标、选手照片、地图图标、LoL 英雄图片与素材出处。

v0.4.0 新增 OpenDota 的 501 项 Dota 装备 ID / 名称 / Valve 图标目录，以及示例单局的 40 张主装备、中立物品与附魔图标。应用仅按实际比赛缓存额外图标，背包数据与主栏分开保留。运行 `npm run sync:dota-items` 更新目录与现有内置图标；首次按指定原始比赛补齐图标可用 `npm run sync:dota-items -- --snapshot ../matchcut/data/fixtures/9035078952.json`。图标外观以获取时间为准。

LoL Data Dragon 装备目录按比赛补丁独立存放，避免用当前版本替换历史装备。v0.5.1 补充 16.18.1 中文目录及暂停局、正常局使用的辅助装和升级鞋等图标，并补齐 14.6.1 样例终局出装。应用通过 Games of Legends 终局页面核对实际出装；本资料库只维护装备目录与素材。同步脚本支持新版终局快照，仅过滤已知的位置任务 ID，保留历史辅助装、鞋子、饰品和真眼。同步示例：`npm run sync:lol-items -- 14.6.1 ../matchcut/data/cache/lol/inventories/LOLTMNT02_76144.json`，然后执行 `npm run manifest` 与 `npm run export -- ../matchcut`。

当前收录 **17 支战队的本地队标、173 名选手的照片（LoL 163、CS 10）、10 张 CS 地图徽标**，另含可搜索的上游队标目录快照。LoL 有 164 份独立身份档案，GAM 的 tiphat 暂缺照片：Riot / LPL 来源均为默认剪影，已标记缺图并排除占位图片。照片队服不代表历史比赛当时的所属战队。

v0.3.0 补充 2026 德玛西亚杯全球邀请赛（DCGI）12 支已出场队伍的 60 名选手，以及 Riot 公布的 2026 S 赛 19 支参赛队赛前最近阵容的 95 名选手，另收录 9 名核实过的本赛季选手。**赛事最终报名表和完整替补名单尚未核实**；赛前出场阵容不能当作正式报名名单。数据截至 2026-10-09，S 赛参赛队来源为 [Riot 官方赛事指南](https://lolesports.com/en-US/news/worlds-2026-primer)。

选手是独立档案，以稳定个人 ID 关联照片；赛事名单、战队和带日期的出场证据单独记录。转会不会创建新的选手或让照片失效。Riot / LPL ID 与 Oracle’s Elixir ID 的映射经过姓名、阵容、日期等交叉核对，不按昵称直接绑定；例如 LOS 的打野 Curse 不会误配成曾用名 Curse 的中国上单。

v0.2.0 新增 Riot Data Dragon **16.20.1 的全部 173 个 LoL 英雄**，每个都有头像 PNG 和默认皮肤加载立绘 JPG，共 346 张图片。英雄目录与素材一同导出，离线也能使用。立绘接口不区分补丁，记录获取时间和 SHA256，不宣称对应历史比赛当时的美术。

## 维护范围

- CS：计划按有日期的固定排名来源维护全球前 50 支队伍，覆盖现役与替补选手。排名来源、排名日期和阵容有效期必须一起保存。
- LoL：计划覆盖当季 LPL、LCK 全队；其他世界赛赛区按联赛排名取前五，并补齐实际世界赛参赛队。赛区范围随赛季变化，不硬编码旧赛制。
- Dota：保留已核实资料，后续按使用需求扩充。
- 按提供方选手 ID 关联，不能只凭昵称绑定。同名、改名、来源冲突进入人工确认；CS 选手职责不从战绩或排名推断。
- 更新默认素材时，Matchcut 本机手动绑定的素材保持优先。

具体目标记录在 `catalog/scope.json`，目标范围与已收录数据分开记录。

## 文件

| 路径                         | 内容                                                    |
| ---------------------------- | ------------------------------------------------------- |
| `catalog/team-logos.json`    | 队名、别名、本地队标、上游来源                          |
| `catalog/player-photos.json` | 游戏、提供方选手 ID、昵称、照片与资料页来源             |
| `catalog/logo-catalog.json`  | 上游队标搜索目录，图片按需获取                          |
| `catalog/maps.json`          | CS 地图标识、图片及来源                                 |
| `catalog/lol-champions.json` | Riot 版本、完整英雄 ID 与名称、图片来源模板与获取时间   |
| `catalog/lol-players.json`   | 独立选手档案、别名、跨提供方 ID、照片状态与身份核对证据 |
| `catalog/lol-events.json`    | 赛事参赛队、个人 ID 引用、出场证据及报名核实状态        |
| `catalog/scope.json`         | 计划覆盖范围与人工确认规则                              |
| `assets/`                    | 已核实的初始素材与出处说明                              |
| `manifest.json`              | 数据版本、收录数量、各文件大小与 SHA256                 |

CS `playerId` 为完整 SteamID 字符串，LoL 为 Oracle’s Elixir 的 `playerid`。不要把 SteamID 转成 JavaScript 数字，也不要在昵称变化时更换稳定 ID。上游新 ID 的映射须有来源依据。

初始素材随 Git 保存，方便直接校验和离线构建；版本发布会同时生成完整素材包。后续大规模照片应迁往 Release 附件或对象存储，目录保留版本与校验值。

## 校验与发布

需要 Node.js 22 或更新版本。首次执行 `npm ci`；Sharp 用于缩放、解码与压缩照片，构建和验证不访问网络。

```sh
npm run validate
npm test
npm run build
```

`build` 输出 `dist/matchcut-data-<版本>.tar.gz` 及 `.sha256`。压缩包内的 `data/fixtures/` 与 `public/assets/` 可直接供 Matchcut 使用，不包含比赛 Demo、比赛缓存、个人配置或成片。

更新 LoL 全英雄素材：

```sh
npm run sync:lol
# 也可明确指定 Riot 的资料版本
npm run sync:lol -- 16.20.1
npm run manifest
npm run validate
```

同步从 Riot 官方版本目录发现英雄，使用四个并发请求下载完整头像与立绘，有限重试；全部下载并校验后才覆盖旧目录与图片。下载失败会保留原资料。校验要求每个英雄两张图片齐全，缺图或文件截断不能进入发布包。

更新选手照片：先核实 `catalog/lol-players.json` 中的个人 ID 映射和来源，再执行 `npm run sync:players`。该命令只下载已核实的来源，不会根据选手当前战队或同名自动创建关联；四个并发请求，失败重试，全部成功后才写入默认照片目录。图片保持透明背景、等比缩到最长边 900 像素。`npm run sync:players -- --reuse` 可复用来源未变化的本地图片进行压缩。完整报名名单发布后，应单独更新赛事成员引用。

修改资料后：

1. 补全来源并核实选手 ID、游戏和图片是否对应。
2. 在 `package.json` 更新资料版本。
3. 运行 `npm run manifest`，再运行 `npm run validate` 与 `npm run build`。
4. 提交，推送与版本一致的标签，例如 `v0.1.1`。GitHub Actions 会生成对应 Release 及素材包。

## 同步到本机 Matchcut

两个仓库放在同一级目录时：

```sh
npm run export -- ../matchcut
```

导出前会校验整套资料，只更新应用内置的队标、选手照片、地图、LoL 英雄图片与目录快照，并写入 `data/fixtures/media-catalog-version.json` 记录版本。不会写入应用的 `data/matchcut.sqlite`、旧版 `data/media-library.json`、偏好、用户上传或比赛缓存。共享资料保持 JSON 与图片格式；SQLite 用于应用本机的查询索引和个人绑定，不随本仓库发布。导出完成后重启 Matchcut，以重新载入目录并更新素材查询索引；应用的“游戏管理”也可以从 Release 独立下载各游戏的素材包；目录与比赛解析适配器随应用更新。

应用仓库保留一份可离线运行的内置快照；共享资料以本仓库为维护入口，导出后可在应用仓库审阅快照差异。

## 来源

队标来自 [esport-team-logos](https://github.com/lootmarket/esport-team-logos) 及样例 OpenDota 的 Steam 队标地址；选手照片来自 [Riot LoL Esports](https://lolesports.com/)、[LPL](https://lpl.qq.com/) 与 [ProSettings](https://prosettings.net/)；地图来自 [csgo-map-icons](https://github.com/vgalisson/csgo-map-icons)。逐项链接保存在目录 JSON 与 `assets/**/SOURCES.md`。

游戏美术、照片和战队商标的权利属于各自权利人。本仓库的收录不代表获得这些素材的著作权或商标授权。

LoL 技能与符文目录位于 `catalog/lol-loadouts/`，内置 14.6、16.18 的主副系、符文、属性碎片及九种峡谷召唤师技能，共 173 张图标。目录记录版本和来源 URL，素材来源见 `assets/lol/loadouts/SOURCES.md`。验证器检查编号、路径、PNG 和 SHA256，导出为应用的 `data/fixtures/lol/loadout-catalogs/`。比赛中的实际技能选择与符文快照保存在应用按局缓存中，不作为选手常驻资料，也不跟战队绑定。

## 独立游戏素材包

v0.6.0 起，`npm run build` 还生成 `dist/modules.json` 和三个 `matchcut-<游戏>-<版本>.pack.gz`，发布时一并上传到 Release。Dota 包包含内置英雄头像和立绘、装备、队标；LoL 包包含英雄、选手、队标、装备、技能和符文；CS 包包含地图、选手和队标。共用字体和占位图继续由应用提供。

每个包是 gzip 压缩的 JSONL：首行为游戏和版本，后续每行包含一个素材的应用路径、字节数、SHA256 和 Base64。应用先校验完整下载，再逐文件解压校验，以单个素材为单位控制内存；包内仅允许对应游戏的素材路径，不包含个人资料或比赛文件。新增游戏需增加比赛解析适配器、登记素材路径归属，并增加独立包定义。
