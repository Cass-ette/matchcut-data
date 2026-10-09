# Matchcut Data

[Matchcut](https://github.com/Cass-ette/matchcut) 的独立资料库，维护选手身份、战队别名、队标、选手照片、地图图标、LoL 英雄图片与素材出处。

初始版本收录 **17 支战队的本地队标、15 名选手的身份与照片、10 张 CS 地图徽标**，另含可搜索的上游队标目录快照。选手照片是 CS 示例十人和 LoL 示例 T1 五人；照片队服不代表历史比赛当时的所属战队。当前数据不包含完整的现役阵容、排名或转会历史，不能把示例选手视为当前阵容。

v0.2.0 新增 Riot Data Dragon **16.20.1 的全部 173 个 LoL 英雄**，每个都有头像 PNG 和默认皮肤加载立绘 JPG，共 346 张图片。英雄目录与素材一同导出，离线也能使用。立绘接口不区分补丁，记录获取时间和 SHA256，不宣称对应历史比赛当时的美术。

## 维护范围

- CS：计划按有日期的固定排名来源维护全球前 50 支队伍，覆盖现役与替补选手。排名来源、排名日期和阵容有效期必须一起保存。
- LoL：计划覆盖当季 LPL、LCK 全队；其他世界赛赛区按联赛排名取前五，并补齐实际世界赛参赛队。赛区范围随赛季变化，不硬编码旧赛制。
- Dota：保留已核实资料，后续按使用需求扩充。
- 按提供方选手 ID 关联，不能只凭昵称绑定。同名、改名、来源冲突进入人工确认；CS 选手职责不从战绩或排名推断。
- 更新默认素材时，Matchcut 本机手动绑定的素材保持优先。

具体目标记录在 `catalog/scope.json`，目标范围与已收录数据分开记录。

## 文件

| 路径 | 内容 |
| --- | --- |
| `catalog/team-logos.json` | 队名、别名、本地队标、上游来源 |
| `catalog/player-photos.json` | 游戏、提供方选手 ID、昵称、照片与资料页来源 |
| `catalog/logo-catalog.json` | 上游队标搜索目录，图片按需获取 |
| `catalog/maps.json` | CS 地图标识、图片及来源 |
| `catalog/lol-champions.json` | Riot 版本、完整英雄 ID 与名称、图片来源模板与获取时间 |
| `catalog/scope.json` | 计划覆盖范围与人工确认规则 |
| `assets/` | 已核实的初始素材与出处说明 |
| `manifest.json` | 数据版本、收录数量、各文件大小与 SHA256 |

CS `playerId` 为完整 SteamID 字符串，LoL 为 Oracle’s Elixir 的 `playerid`。不要把 SteamID 转成 JavaScript 数字，也不要在昵称变化时更换稳定 ID。上游新 ID 的映射须有来源依据。

初始素材随 Git 保存，方便直接校验和离线构建；版本发布会同时生成完整素材包。后续大规模照片应迁往 Release 附件或对象存储，目录保留版本与校验值。

## 校验与发布

需要 Node.js 22 或更新版本，无额外 npm 依赖。

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

导出前会校验整套资料，只更新应用内置的队标、选手照片、地图、LoL 英雄图片与目录快照，并写入 `data/fixtures/media-catalog-version.json` 记录版本。不会写入 `data/media-library.json`、偏好、用户上传或比赛缓存。导出完成后重启 Matchcut，以重新载入进程内的目录缓存；这是本机显式同步，应用暂未后台自动下载 Release。

应用仓库保留一份可离线运行的内置快照；共享资料以本仓库为维护入口，导出后可在应用仓库审阅快照差异。

## 来源

队标来自 [esport-team-logos](https://github.com/lootmarket/esport-team-logos) 及样例 OpenDota 的 Steam 队标地址；选手照片来自 [ProSettings](https://prosettings.net/)；地图来自 [csgo-map-icons](https://github.com/vgalisson/csgo-map-icons)。逐项链接保存在目录 JSON 与 `assets/**/SOURCES.md`。

游戏美术、照片和战队商标的权利属于各自权利人。本仓库的收录不代表获得这些素材的著作权或商标授权。
