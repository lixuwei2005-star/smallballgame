# 暗海探秘 — Web 版 (HTML5 rebuild)

浏览器可玩的「暗海探秘 / MergeJellyfish」合成小玩法。以 Windows 重建包
(`../merge_jellyfish_windows`) 为行为参考，复用官方解包出来的贴图 / 音频 / 字体资源。

> Windows 重建包保持原样，未被改动；本目录是独立的静态站点。

## 运行（本地）

纯静态站点，任意静态服务器即可：

```bash
cd merge_jellyfish_web
python -m http.server 8011
# 打开 http://127.0.0.1:8011/
```

> 必须通过 HTTP(S) 打开，不能直接 `file://`（ES module 与音频 fetch 需要同源 HTTP）。

## 资源管线

`assets/` 由 `tools/build_assets.py` 从 Windows 包的 `assets/` 生成：

```bash
python tools/build_assets.py
```

它会：

- 复制并 alpha 裁剪静态水母贴图（对应 pygame 的 `trim_alpha`）
- 将每级 60 帧内层动画打包成精灵表 + `manifest.json`（懒加载，约 18MB）
- 复制瓶子 / 夹子 / 气泡 / 背景 / 字体，以及 `sound_map.json` 引用到的音频
- 故意不打包 13MB 的全屏帧序列（`official_bg2_loop` 60×、`official_wave_loop`
  24×），改用程序化的摇摆 / 气泡 / 鱼 / 水波微光复刻——这正是 main.py 里本就
  程序化绘制的部分

## 技术栈

- 渲染：Canvas 2D（设计分辨率 1600×900，CSS transform 等比缩放，支持响应式 letterbox）
- 物理：Matter.js（`vendor/matter.min.js`），重力/尺寸/形状对齐 pymunk 常量
- 音频：WebAudio（音乐 / 音效分轨增益，首次交互解锁）
- 存储：localStorage（字段对齐 Windows 端 `save.json`）
- 网络：fetch（排行榜 API）

## 玩法保真

行为以 Python 实现为第一参考：`LEVEL_SIZES`、`SCORE_BY_LEVEL`、随机生成、
同级合成（接触→可合判定→0.2s 吸附缩放→生成下一级并入场）、失败线 + 即时/计时
判定、最高分/最高等级、本地存档字段、排行榜 payload 形状，均已移植。
详见 `src/game.js`（核心状态机）与 `src/render.js`（表现层）。

## 排行榜 / 部署（双域名）

- 静态站点部署在 **shuimu.apodfg.com**
- 排行榜 API 在 **smallballgame.apodfg.com**（`../merge_jellyfish_server` 的 Flask）

由于跨域，API 已加上 CORS 响应头（对 Windows 客户端完全向后兼容）。
前端 API 地址在 `config.js` 的 `apiBase` 中配置：

- 默认 `https://smallballgame.apodfg.com`（跨域，依赖 CORS）
- 若用同源反代，把 `apiBase` 改成 `/api`，并启用 `deploy/nginx-shuimu.conf`
  里被注释的 `/api` proxy 段（这样浏览器看来是同源，免 CORS）

API 接口：

```
GET  /api/leaderboard?limit=3|50  -> { rows: [{rank,nickname,score,best_level,updated_at}] }
POST /api/player                  -> { player_id, nickname }
POST /api/score                   -> { player_id, nickname, score, best_level }
```

玩家身份：首次启动生成持久 `player_id`，弹窗输入昵称（留空→「匿名用户」，设置里
可改）；游戏结束自动提交分数；离线时可用设置里的「同步排行」按钮补提交本地最佳分。

### 部署步骤

1. `python tools/build_assets.py`（如尚未生成 `assets/`）
2. 把整个 `merge_jellyfish_web/` 上传到 shuimu.apodfg.com 的站点根目录
3. 用 `deploy/nginx-shuimu.conf`（按需改 `root` 路径）
4. 重新部署 `merge_jellyfish_server`（已加 CORS）
5. 不要把任何数据库凭据写进前端；`config.js` 只放公开的 API 地址

## 操作

- 鼠标移动 / 触摸拖动：移动夹子
- 鼠标左键 / 空格 / 回车 / 触摸抬起：投放
- R：重新开始
- F6：设置；Esc：关闭弹窗/设置
