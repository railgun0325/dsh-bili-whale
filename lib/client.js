/**
 * dsh-bili-whale —— 客户端半边：DSH「设置」里的 **养鱼** section（完整版）
 *
 * 历史（2026-10-18）：
 *   v1 只放了 6 个字段（owner/persona/作息窗口）→ 主人说"和微信端讲的不一样" ✗。
 *   真因：宿主半边那份独立页面 `settings.html` 有 25 个字段，但它被 DSH 的信任栅栏挡着打不开 ✗，
 *        而 section 是我另写的精简版 ✗ → 两套界面、一个配置，看着像两个插件。
 *   v2（本文件）：把那 25 个字段**按同一份配置结构**搬进 section ✓；渲染改成**数据驱动**
 *                （FIELDS 是唯一真相；加字段只改这个数组 ✓）。
 *
 * 数据流：section ⇄ `/dsh-bili/api/*`（同源 fetch ✓）⇄ `~/.dsh/bili-whale.config.json`
 *         —— 与 bilibili-tools 的 `lib/config.mjs` 读**同一份文件** ✓，不存在"两套配置"。
 *         ⚠️ 保存时提交**整份配置**（load 回来原样改几个键）→ 未显示的字段不会被抹掉 ✓
 */
window.__ModuleLoader__.load({
  id: "dsh-bili-whale",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const { createElement: h, useCallback, useEffect, useState } = React;

    const API = "/dsh-bili/api";
    const CSS_TAG = "dsh-bili-whale/section.css";
    const CSS = [
      ".blw{max-width:960px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:6px}",
      ".blw-title{margin:0;font-size:16px;font-weight:500;line-height:24px}",
      ".blw-intro{color:var(--dsw-alias-label-tertiary);margin:0 0 4px;font-size:13px;line-height:20px}",
      ".blw-group{margin-top:14px;font-size:13px;font-weight:600;line-height:20px}",
      ".blw-rows{display:flex;flex-direction:column}",
      ".blw-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px 20px;padding:10px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);flex-wrap:wrap}",
      ".blw-row:last-child{border-bottom:none}",
      ".blw-row>div:first-child{flex:1;min-width:190px}",
      ".blw-label{font-size:13px;line-height:19px}",
      ".blw-hint{color:var(--dsw-alias-label-tertiary);margin-top:3px;font-size:11.5px;line-height:17px}",
      ".blw-input,.blw-select{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;height:28px;padding:0 8px;min-width:180px;outline:none}",
      ".blw-input:focus-visible,.blw-select:focus-visible{border-color:var(--dsw-alias-brand-primary)}",
      ".blw-input.blw-wide{min-width:260px}",
      ".blw-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:.5px solid var(--dsw-alias-border-l2)}",
      ".blw .blw-btn{background:#315fa8;color:#fff;border:1px solid #315fa8;border-radius:6px;font-size:12.5px;min-height:32px;padding:5px 12px;cursor:pointer}",
      ".blw .blw-btn:hover:not(:disabled){background:#244b89;border-color:#244b89}",
      ".blw .blw-btn:focus-visible{outline:2px solid #78a9f3;outline-offset:2px}",
      ".blw .blw-btn:disabled{background:#48576e;border-color:#48576e;color:#e2e8f0;opacity:1;cursor:default}",
      ".blw .blw-btn2{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}",
      ".blw .blw-btn2:hover:not(:disabled){background:rgba(127,127,127,.12);border-color:var(--dsw-alias-border-l2)}",
      ".blw{container-type:inline-size;--blw-muted:var(--dsw-alias-label-secondary);--blw-border:var(--dsw-alias-border-l2)}",
      ".blw-panel{border:1px solid var(--blw-border);border-radius:14px;padding:18px 20px;background:rgba(127,127,127,.035);margin-top:12px;min-width:0}",
      ".blw-panel-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}",
      ".blw-panel-heading h4{font-size:13px;line-height:20px;font-weight:600;margin:0}",
      ".blw-live-label{font-size:11px;line-height:18px;color:var(--blw-muted)}",
      ".blw-status-heading{display:flex;align-items:center;gap:12px;margin:18px 0}",
      ".blw-status-heading>div{min-width:0;flex:1}",
      ".blw-status-title{font-size:19px;line-height:28px;font-weight:600;letter-spacing:-.3px}",
      ".blw-secondary{display:block;font-size:12px;line-height:19px;color:var(--blw-muted);margin:3px 0 0;overflow-wrap:anywhere}",
      ".blw-status-mark{width:36px;height:36px;flex:none;border-radius:50%;display:grid;place-items:center;background:rgba(127,127,127,.1)}",
      ".blw-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#8c96a5;flex:none}",
      ".blw-status-mark .blw-dot{width:10px;height:10px}",
      ".blw-tone-ok{background:rgba(55,181,143,.12)}.blw-tone-ok .blw-dot,.blw-dot-ok{background:#3eb792}",
      ".blw-tone-active{background:rgba(111,158,248,.14)}.blw-tone-active .blw-dot{background:#6f9ef8}",
      ".blw-tone-warn{background:rgba(237,182,108,.14)}.blw-tone-warn .blw-dot{background:#d49b4f}",
      ".blw-runtime-cards{display:grid;grid-template-columns:1fr 1fr;gap:12px}",
      ".blw-next-card,.blw-dm-card{border:1px solid var(--blw-border);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;min-width:0}",
      ".blw-next-card{background:linear-gradient(125deg,rgba(111,158,248,.08),rgba(111,158,248,.015))}",
      ".blw-eyebrow{display:block;font-size:11px;line-height:18px;color:var(--blw-muted)}",
      ".blw-next-time{display:block;font-size:28px;line-height:40px;letter-spacing:-.6px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:2px}",
      ".blw-channel-title{font-size:17px;line-height:26px;font-weight:500;margin:9px 0 6px}",
      ".blw-card-foot{font-size:11px;line-height:17px;color:var(--blw-muted);margin-top:auto;padding-top:12px}",
      ".blw-channel-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}",
      ".blw-pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--blw-border);padding:4px 8px;border-radius:6px;font-size:11px;line-height:16px}",
      ".blw-pill-state{color:var(--blw-muted);margin-left:2px}",
      ".blw-details{border-top:1px solid var(--blw-border);margin-top:16px;padding-top:12px;font-size:12px;line-height:19px}",
      ".blw-details summary{cursor:pointer;color:var(--blw-muted);width:fit-content;max-width:100%;list-style:none;display:flex;align-items:center;gap:7px;flex-wrap:wrap}",
      ".blw-details summary::-webkit-details-marker{display:none}.blw-details summary:before{content:'›';font-size:17px;line-height:16px;display:inline-block;transition:transform .15s}",
      ".blw-details[open]>summary:before{transform:rotate(90deg)}.blw-details summary:hover{color:var(--dsw-alias-label-primary)}",
      ".blw-details summary:focus-visible,.blw-period:focus-visible{outline:2px solid #78a9f3;outline-offset:3px;border-radius:4px}",
      ".blw-detail-list{margin:12px 0;display:flex;flex-direction:column;gap:8px}",
      ".blw-detail-row{display:grid;grid-template-columns:100px minmax(0,1fr);gap:8px;font-size:11.5px;line-height:18px}",
      ".blw-detail-row dt{color:var(--blw-muted)}.blw-detail-row dd{margin:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}",
      ".blw-detail-note{font-size:11.5px;line-height:19px;color:var(--blw-muted);margin:10px 0 0}",
      ".blw-periods{display:inline-flex;gap:2px;background:rgba(127,127,127,.08);border:1px solid var(--blw-border);border-radius:7px;padding:3px}",
      ".blw .blw-period{border:0;background:transparent;color:var(--blw-muted);padding:4px 12px;border-radius:4px;font:inherit;font-size:11px;line-height:16px;cursor:pointer;box-shadow:none}",
      ".blw .blw-period.is-active{background:rgba(127,127,127,.18);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.04);font-weight:600}",
      ".blw .blw-period:hover:not(.is-active){background:rgba(127,127,127,.08)}",
      ".blw-usage-main{display:grid;grid-template-columns:minmax(0,1fr) 160px;gap:12px;align-items:center;padding:20px 4px 16px}",
      ".blw-cost-number{display:block;font-size:32px;font-weight:600;line-height:44px;letter-spacing:-1px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;margin:3px 0 10px}",
      ".blw-cost-meta{display:flex;flex-direction:column;gap:4px;color:var(--blw-muted);font-size:12px;line-height:19px}.blw-cost-meta b{font-weight:500;color:var(--dsw-alias-label-primary)}",
      ".blw-scope-label{display:inline-block;font-size:10px;line-height:16px;color:var(--blw-muted);margin-top:12px;padding:2px 6px;border-radius:4px;background:rgba(127,127,127,.08)}",
      ".blw-donut{width:160px;height:160px;position:relative;flex:none}.blw-donut svg{display:block;width:100%;height:100%}.blw-ring-track{color:rgba(127,127,127,.14)}",
      ".blw-donut-center{position:absolute;inset:0;display:flex;flex-direction:column;gap:3px;justify-content:center;align-items:center;pointer-events:none}",
      ".blw-donut-center strong{font-size:22px;line-height:28px;letter-spacing:-.6px;font-weight:600;font-variant-numeric:tabular-nums}.blw-donut-center span{font-size:10px;line-height:16px;color:var(--blw-muted)}",
      ".blw-token-legend{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;border-top:1px solid var(--blw-border);padding-top:14px}",
      ".blw-legend-item{min-width:0}.blw-legend-label{display:flex;align-items:center;gap:6px;font-size:11px;line-height:18px;color:var(--blw-muted)}.blw-legend-label i{width:6px;height:6px;border-radius:2px;flex:none}",
      ".blw-legend-item strong{display:block;font-size:14px;line-height:22px;font-weight:500;font-variant-numeric:tabular-nums;margin:3px 0 0 12px}",
      ".blw-usage-footer{margin-top:16px;display:flex;justify-content:space-between;gap:6px 14px;flex-wrap:wrap;font-size:10.5px;line-height:17px;color:var(--blw-muted)}",
      ".blw-billing-note{font-size:10px;line-height:16px;color:var(--blw-muted);margin:9px 0 0}",
      ".blw-notice{font-size:12px;line-height:19px;padding:9px 12px;margin:12px 0 0;border-radius:6px;overflow-wrap:anywhere}.blw-notice-warn{background:rgba(237,182,108,.1);border:1px solid rgba(212,155,79,.3)}",
      ".blw-loading{font-size:12px;line-height:20px;color:var(--blw-muted);padding:22px 0;margin:0}",
      ".blw-discovery{padding:12px 2px 4px;margin-top:8px}.blw-summary-meta{font-size:10.5px;opacity:.85;margin-left:7px}.blw-candidates{padding-left:16px;font-size:12px;margin:12px 0 4px}.blw-candidates li{margin:9px 0}.blw-candidates small{display:block;font-size:10px;color:var(--blw-muted);margin-top:2px}",
      "@container(max-width:500px){.blw-panel{padding:16px}.blw-runtime-cards{gap:8px}.blw-next-card,.blw-dm-card{padding:12px}.blw-usage-main{grid-template-columns:minmax(0,1fr) 140px;gap:8px;padding:18px 0 14px}.blw-donut{width:140px;height:140px}.blw-cost-number{font-size:28px;line-height:38px}.blw-next-time{font-size:25px;line-height:36px}}",
      "@container(max-width:350px){.blw-panel{padding:14px 12px}.blw-runtime-cards{grid-template-columns:1fr}.blw-usage-main{grid-template-columns:minmax(0,1fr) 110px;gap:8px}.blw-donut{width:110px;height:110px}.blw-donut-center strong{font-size:17px}.blw-cost-number{font-size:23px;line-height:32px}.blw-cost-meta{font-size:11px}.blw-period{padding:4px 9px!important}.blw-detail-row{grid-template-columns:80px minmax(0,1fr)}}",
      "@media(prefers-reduced-motion:reduce){.blw-details summary:before{transition:none}}",
      ".blw-out{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary);background:rgba(127,127,127,.08);border-radius:8px;padding:10px 12px;max-height:240px;overflow:auto;margin-top:10px}",
      ".blw-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin-top:8px;white-space:pre-line}",
      ".blw-hint.blw-pre{white-space:pre-line}",
      ".blw-badge{display:inline-block;font-size:11px;line-height:16px;padding:1px 7px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-secondary);margin-left:6px}",
      ".blw-cookie{display:flex;flex-direction:column;gap:8px;min-width:250px}",
    ].join("");

    // ── 唯一真相：字段清单（加字段只改这里 ✓）────────────────────────────
    //   kind: text | number | list（逗号分隔数组）| switch | select
    const FIELDS = [
      { group: "工具链", path: ["home"], label: "专用会话目录", hint: "已存在目录的绝对路径；留空用默认目录。重启后新建会话生效，已有会话不迁移。本机：「专属会话 → 工作目录」填了就以它为准", kind: "text", wide: true },
      { group: "日记与推送", path: ["listen", "mentionSummary"], label: "主人 @ 请求总结", hint: "默认关闭。开启后处理主人含总结/摘要/概括的新 @，通过消息推送通道发送", kind: "switch" },
      { group: "作息", path: ["night", "minGapMin"], label: "最小唤醒间隔（分钟）", hint: "默认 10；窗口放不下就少醒几次", kind: "number" },
      { group: "她是谁", path: ["persona", "name"], label: "角色名", hint: "她怎么被称呼", kind: "text" },
      { group: "她是谁", path: ["persona", "ownerTitle"], label: "她怎么称呼你", hint: "例如「主人」", kind: "text" },
      { group: "她是谁", path: ["persona", "selfClaim"], label: "她怎么自称", hint: "例如「我」/「人家」", kind: "text" },

      { group: "你（主人）", path: ["owner", "mid"], label: "主人 mid", hint: "用来认「谁回过她 / 谁点了赞」", kind: "text" },
      { group: "你（主人）", path: ["owner", "name"], label: "主人昵称", hint: "@ 分享时写进正文", kind: "text" },
      { group: "你（主人）", path: ["self", "mid"], label: "她自己 mid", hint: "只读（来自 cookie）", kind: "text", readOnly: true },
      { group: "你（主人）", path: ["self", "name"], label: "她自己昵称", hint: "只读（来自 nav）", kind: "text", readOnly: true },

      { group: "专属会话", path: ["session", "id"], label: "会话 ID", hint: "固定使用此会话；换目录时请同时换一个新 ID", kind: "text" },
      { group: "专属会话", path: ["session", "cwd"], label: "工作目录", hint: "绝对路径；在此放鲸鱼自己的 AGENTS.md 与工具入口，不修改其他会话", kind: "text", wide: true },

      { group: "作息", path: ["night", "enabled"], label: "启用生物钟", hint: "关闭后不再计划或定时唤醒；设置页仍可用。评论、私信和直播监听由各自开关控制。", kind: "switch" },
      { group: "作息", path: ["night", "offPeakOnly"], label: "仅在低价作息窗口运行", hint: "按北京时间拦截 09–12、14–18，并限制在下方作息窗口。周末也沿用这些窗口。", kind: "switch" },
      { group: "作息", path: ["night", "maxWakesPerDay"], label: "每天选片轮次上限", hint: "独立于窗口数量；三个允许窗口也可只醒两次，0 表示不定时选片", kind: "number" },
      { group: "作息", path: ["night", "skipChance"], label: "今晚不看的概率", hint: "0.3 = 三成", kind: "number" },
      { group: "作息", path: ["night", "maxVideos"], label: "单次醒来观看视频数量", hint: "初筛候选数；低频模式每轮只深读最有价值的 1 条", kind: "number" },

      { group: "低频自主互动", path: ["interaction", "enabled"], label: "允许自主评论与回复（不 @）", hint: "只用独立小号，正文不提及用户；发送端同时执行数量、间隔、去重和风险停止限制。", kind: "switch" },
      { group: "低频自主互动", path: ["interaction", "daily"], label: "每天发言总数", hint: "最多 3 次发送尝试，失败也计次，0 表示暂停", kind: "number" },
      { group: "低频自主互动", path: ["interaction", "topLevelDaily"], label: "每天主动评论", hint: "最多 1 条，不同于给网友的楼中楼回复", kind: "number" },
      { group: "低频自主互动", path: ["interaction", "replyDaily"], label: "每天回复网友", hint: "最多 2 条，同一条评论不重复回复", kind: "number" },
      { group: "低频自主互动", path: ["interaction", "minIntervalSec"], label: "两次发言最短间隔（秒）", hint: "当前 1200 秒（20 分钟）；不得低于 600 秒", kind: "number" },
      { group: "低频自主互动", path: ["interaction", "maxChars"], label: "单条评论字数上限", hint: "最多 160 字；不发送网址、凭据或本地路径", kind: "number" },
      { group: "低频自主互动", path: ["interaction", "maxListenerWakesPerDay"], label: "每天回复唤醒次数", hint: "最多 2 次；没有新消息不调用模型，每次只处理 1 条", kind: "number" },
      { group: "低频自主互动", path: ["interaction", "maxRunMinutes"], label: "每轮建议最长分钟数", hint: "最多 12 分钟的执行提示预算；不是 API token 的硬封顶", kind: "number" },
      { group: "主人私信", path: ["ownerCommand", "enabled"], label: "主人指令独立通道", hint: "按真实主人UID核实来信；私信交办不受后台每日额度、作息或只选第一名限制。保留身份、防重和风控停止。", kind: "switch" },
      { group: "主人私信", path: ["privateReply", "enabled"], label: "自动回复主人私信", hint: "只回复主人 mid 的新文字私信；双方须互关，不回复陌生人", kind: "switch" },
      { group: "主人私信", path: ["privateReply", "daily"], label: "限额模式每天回复上限", hint: "仅关闭「主人指令独立通道」时生效；独立通道不限每日回复次数", kind: "number" },
      { group: "主人私信", path: ["privateReply", "minIntervalSec"], label: "限额模式回复间隔（秒）", hint: "仅关闭主人独立通道时生效；主人交办不受此间隔限制", kind: "number" },
      { group: "主人私信", path: ["privateReply", "pollIntervalSec"], label: "私信检查间隔（秒）", hint: "无新消息不调用模型；主人独立通道全天检查，普通限额模式遵守作息", kind: "number" },

      { group: "口味", path: ["preferences", "like"], label: "爱看", hint: "逗号分隔", kind: "list" },
      { group: "口味", path: ["preferences", "dislike"], label: "不爱看", hint: "逗号分隔", kind: "list" },
      { group: "智能选片", path: ["preferences", "discovery", "enabled"], label: "结合 OpenBiliClaw 智能选片", hint: "复用已评分候选、画像与明确反馈；默认优先 DeepSeek／AI，再留少量长期兴趣", kind: "switch" },
      { group: "智能选片", path: ["preferences", "discovery", "focusSlots"], label: "每三条中优先 AI 的条数", hint: "默认 2；只影响选片方向，不改变每天轮数或发言额度", kind: "number" },
      { group: "智能选片", path: ["preferences", "discovery", "communityQueries"], label: "大肥鱼社区搜索词", hint: "逗号分隔；是否聚集仍需核对实际评论，标题只算线索", kind: "list" },
      { group: "智能选片", path: ["preferences", "discovery", "aiQueries"], label: "AI 探索搜索词", hint: "逗号分隔，按轮次轮换，避免一直重复同一个词", kind: "list" },

      { group: "日记与推送", path: ["diary", "push"], label: "推送日记摘要", hint: "关掉 = 她照写两本日记，但不推给你（日记本身不能关 ✓）", kind: "switch" },

      { group: "工具链", path: ["toolsPath"], label: "工具目录", hint: "留空 = 用插件自带的 tools/ 或开发目录", kind: "text", wide: true },
    ];

    const getPath = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
    const setPath = (obj, path, value) => {
      let cur = obj;
      for (let i = 0; i < path.length - 1; i += 1) {
        const k = path[i];
        if (cur[k] == null || typeof cur[k] !== "object") cur[k] = typeof path[i + 1] === "number" ? [] : {};
        cur = cur[k];
      }
      cur[path[path.length - 1]] = value;
    };

    const tokenCount = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
    const tokens = value => tokenCount(value).toLocaleString('zh-CN');
    const compactTokens = value => {
      const n = tokenCount(value);
      return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : tokens(n);
    };
    const localTime = value => {
      const date = value ? new Date(value) : null;
      return date && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '尚无记录';
    };
    const clockTime = value => {
      const date = value ? new Date(value) : null;
      return date && Number.isFinite(date.getTime()) ? date.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '尚无记录';
    };
    function formatCost(sum) {
      if (!sum || (sum.calls > 0 && sum.unpricedCalls >= sum.calls) ||
          typeof sum.estimatedCostLow !== 'number' || !Number.isFinite(sum.estimatedCostLow) ||
          typeof sum.estimatedCostHigh !== 'number' || !Number.isFinite(sum.estimatedCostHigh)) return '暂无法估算';
      const low = sum.estimatedCostLow, high = sum.estimatedCostHigh;
      return (sum.unpricedCalls ? '至少 ' : '') + '¥' + low.toFixed(4) +
        (Math.abs(high - low) > 0.000001 ? '–' + high.toFixed(4) : '');
    }
    function buildTokenBreakdown(sum) {
      const parts = [
        { key: 'cacheRead', label: '缓存输入', color: '#6f9ef8', value: tokenCount(sum?.cacheRead) },
        { key: 'input', label: '未缓存输入', color: '#edb66c', value: tokenCount(sum?.input) },
        { key: 'output', label: '输出', color: '#aa91ed', value: tokenCount(sum?.output) },
      ];
      if (tokenCount(sum?.cacheWrite)) parts.push({ key: 'cacheWrite', label: '缓存写入', color: '#66bfae', value: tokenCount(sum.cacheWrite) });
      const classified = parts.reduce((n, x) => n + x.value, 0);
      const reported = tokenCount(sum?.totalTokens);
      if (reported > classified) parts.push({ key: 'other', label: '未分类', color: '#8b95a5', value: reported - classified });
      const total = Math.max(reported, classified);
      let offset = 0;
      const segments = parts.map(x => {
        const percent = total ? x.value / total * 100 : 0;
        const result = { ...x, percent, offset };
        offset += percent;
        return result;
      });
      const inputTotal = tokenCount(sum?.input) + tokenCount(sum?.cacheRead) + tokenCount(sum?.cacheWrite);
      return { total, segments, inputCacheRate: inputTotal ? tokenCount(sum?.cacheRead) / inputTotal * 100 : null, inconsistent: classified > reported && reported > 0 };
    }
    function buildRuntimeView(status, cfg, now = Date.now(), error = '') {
      const controls = status?.controls ?? {};
      const runtime = status?.runtime ?? {};
      const heartbeat = Date.parse(runtime.lastTickAt ?? '');
      const stale = Number.isFinite(heartbeat) && now - heartbeat > 180000;
      const problem = status?.dm?.halted?.reason || status?.ownerCommand?.halted?.reason || runtime.lastWakeError || runtime.lastDmError;
      let state = '正在读取', tone = 'muted', description = '正在连接鲸鱼的调度器';
      if (error) { state = '状态读取失败'; tone = 'warn'; description = '以下为最近一次成功读取的数据'; }
      else if (status) {
        if (runtime.stopped) { state = '调度已停止'; description = '等待 DSH 恢复插件调度'; }
        else if (stale) { state = '心跳延迟'; tone = 'warn'; description = '超过 3 分钟没有调度心跳，请检查 DSH 和电脑休眠状态'; }
        else if (problem) { state = '需要留意'; tone = 'warn'; description = String(problem); }
        else if (status.sessionRunning === true) { state = '正在处理任务'; tone = 'active'; description = '可在「B站选片助手」查看这次执行的对话和轨迹'; }
        else if (controls.autoBrowse || controls.dm || controls.comment) {
          if (!Number.isFinite(heartbeat)) { state = '等待调度心跳'; description = '开关已启用，尚未收到调度器的运行回报'; }
          else { state = '自动待命'; tone = 'ok'; description = status.activity?.allowed === false ? '自主浏览等待作息窗口' + (controls.dm ? '，主人私信继续检查' : '') : '到点选片，收到新消息后处理'; }
        } else { state = '自动任务已暂停'; description = '可在下方开启生物钟或消息监听'; }
      }
      let next = '等待计划', nextHint = '由插件内置生物钟安排';
      const text = status?.plan?.atText;
      if (status && !controls.autoBrowse) { next = '已暂停'; nextHint = '下方「作息 → 启用生物钟」可开启'; }
      else if (status?.plan?.action === 'done') { next = '今日已结束'; nextHint = '下一天会重新生成计划'; }
      else if (typeof text === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(text)) {
        const at = Date.parse(text.replace(' ', 'T') + ':00+08:00');
        const day = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
        if (status.plan.action === 'skip') { next = '本轮休息'; nextHint = text + ' · 按跳过概率安排'; }
        else if (Number.isFinite(at)) {
          next = at <= now ? '等待调度' : text.slice(11);
          nextHint = at <= now ? '原计划 ' + text + '，等待下一次检查' : (text.slice(0, 10) === day ? '今天' : text.slice(0, 10)) + ' · 约 ' + Math.ceil((at - now) / 60000) + ' 分钟后';
        }
      }
      return { state, tone, description, next, nextHint, stale, problem, maxWakes: cfg?.night?.maxWakesPerDay };
    }
    function statusPill(label, active, key) {
      return h('span', { className: 'blw-pill', key, 'aria-label': label + '：' + (active ? '已开启' : '已关闭') },
        h('i', { className: 'blw-dot ' + (active ? 'blw-dot-ok' : ''), 'aria-hidden': true }), label, h('span', { className: 'blw-pill-state' }, active ? '开启' : '关闭'));
    }
    function detailRow(label, value, key) {
      return h('div', { className: 'blw-detail-row', key: key || label }, h('dt', null, label), h('dd', null, value));
    }
    function renderRuntimeOverview({ status: rs, cfg, error, now = Date.now() }) {
      const view = buildRuntimeView(rs, cfg, now, error);
      const runtime = rs?.runtime ?? {};
      const attempt = rs?.dm?.lastAttempt;
      const sent = { success: '接口确认成功', failed: '发送失败', unknown: '结果未知，已停止', reserved: '正在发送' };
      const dmLabel = rs?.dm?.halted ? '已停止，需处理' : rs?.controls?.dm ? rs.dm?.unlimited ? '主人通道不限每日次数' : '今日 ' + (rs.dm?.usedToday ?? 0) + '/' + (rs.dm?.max ?? 0) : '监听未开启';
      return h('section', { className: 'blw-panel blw-runtime', 'aria-label': '运行状态' },
        h('div', { className: 'blw-panel-heading' }, h('h4', null, '运行状态'), h('span', { className: 'blw-live-label' }, '每10秒更新')),
        h('div', { className: 'blw-status-heading', role: 'status', 'aria-live': 'polite' },
          h('span', { className: 'blw-status-mark blw-tone-' + view.tone, 'aria-hidden': true }, h('i', { className: 'blw-dot' })),
          h('div', null, h('strong', { className: 'blw-status-title' }, view.state), h('p', { className: 'blw-secondary' }, view.description))),
        h('div', { className: 'blw-runtime-cards' },
          h('div', { className: 'blw-next-card' }, h('span', { className: 'blw-eyebrow' }, '下次自动选片'), h('strong', { className: 'blw-next-time' }, view.next), h('span', { className: 'blw-secondary' }, view.nextHint),
            h('span', { className: 'blw-card-foot' }, '今日已唤醒 ' + (rs?.plan?.wakes ?? '—') + ' 次' + (view.maxWakes != null ? ' / 最多 ' + view.maxWakes + ' 轮' : ''))),
          h('div', { className: 'blw-dm-card', 'aria-label': rs ? '主人私信：' + (rs.controls?.dm ? '已开启' : '已关闭') : '主人私信：读取中' }, h('span', { className: 'blw-eyebrow' }, '主人私信'), h('strong', { className: 'blw-channel-title' }, rs ? (rs.controls?.dm ? '持续监听' : '已关闭') : '读取中…'),
            h('span', { className: 'blw-secondary' }, dmLabel), h('span', { className: 'blw-card-foot', title: localTime(runtime.lastDmPollAt) }, '最近检查 ' + clockTime(runtime.lastDmPollAt)))),
        rs ? h('div', { className: 'blw-channel-row' }, statusPill('自动选片', rs.controls?.autoBrowse, 'browse'), statusPill('评论监听', rs.controls?.comment, 'comment'), statusPill('分享 @', rs.controls?.share, 'share')) : null,
        error ? h('p', { className: 'blw-notice blw-notice-warn', role: 'alert' }, '运行状态读取失败：' + error) : null,
        h('details', { className: 'blw-details' }, h('summary', null, '运行详情与自动运行说明'),
          h('dl', { className: 'blw-detail-list' },
            detailRow('模型任务', rs?.sessionRunning === true ? '正在运行' : rs?.sessionRunning === false ? '空闲，等待消息或计划' : '状态未返回'),
            detailRow('调度检查', localTime(runtime.lastTickAt)),
            detailRow('最近自动选片', localTime(runtime.lastWakeAt)),
            detailRow('私信检查', localTime(runtime.lastDmPollAt) + ' · ' + (runtime.dmState ?? '尚无记录')),
            detailRow('私信交付模型', localTime(runtime.lastDmDispatchAt)),
            detailRow('最近私信发送', attempt ? localTime(attempt.at) + ' · ' + (sent[attempt.status] ?? attempt.status) : '尚无记录'),
            detailRow('今日私信记录', rs ? (rs.dm?.usedToday ?? 0) + ' 次' : '—'),
            rs?.ownerCommand?.enabled ? detailRow('主人指令', '独立执行，不占后台额度；今日公开发送记录 ' + (rs.ownerCommand.commentsToday ?? 0) + ' 次') : null,
            rs?.activity?.allowed === false ? detailRow('作息', rs.activity.reason) : null),
          h('p', { className: 'blw-detail-note' }, '插件随 DSH 启动，用内置定时器唤醒专属会话；无需另建自动化任务。后台任务需要 DSH 保持运行、Mac 未休眠并联网。'),
          h('p', { className: 'blw-detail-note' }, '执行对话与轨迹在「B站选片助手」中查看。关闭会话标签不影响监听；退出 DSH 后停止。待命检查不调用模型。')));
    }
    function renderUsageOverview({ usage, period = 'today', setPeriod, error }) {
      const selected = ['today', 'month', 'total'].includes(period) ? period : 'today';
      const label = { today: '今日', month: '本月', total: '累计' }[selected];
      const sum = usage?.[selected];
      const chart = buildTokenBreakdown(sum);
      const rate = chart.inputCacheRate == null ? '—' : chart.inputCacheRate.toFixed(1) + '%';
      const chartLabel = label + ' Token 构成：' + chart.segments.map(x => x.label + ' ' + tokens(x.value)).join('，');
      return h('section', { className: 'blw-panel blw-usage', 'aria-label': 'Token 与费用' },
        h('div', { className: 'blw-panel-heading' }, h('h4', null, 'Token 与费用'),
          h('div', { className: 'blw-periods', role: 'group', 'aria-label': '用量统计周期' }, ['today', 'month', 'total'].map(key =>
            h('button', { key, type: 'button', className: 'blw-period' + (selected === key ? ' is-active' : ''), 'aria-pressed': selected === key, onClick: () => setPeriod(key) }, { today: '今日', month: '本月', total: '累计' }[key])))),
        sum ? h('div', null,
          h('div', { className: 'blw-usage-main' },
            h('div', { className: 'blw-cost' }, h('span', { className: 'blw-eyebrow' }, label + '费用估算'), h('strong', { className: 'blw-cost-number' }, formatCost(sum)),
              h('div', { className: 'blw-cost-meta' }, h('span', null, tokens(sum.calls) + ' 次模型调用'), h('span', null, '输入缓存命中 ', h('b', null, rate))),
              h('span', { className: 'blw-scope-label' }, '鲸鱼专属会话')),
            h('div', { className: 'blw-donut', title: chartLabel },
              h('svg', { viewBox: '0 0 160 160', role: 'img', 'aria-label': chartLabel },
                h('title', null, chartLabel), h('circle', { cx: 80, cy: 80, r: 66, fill: 'none', stroke: 'currentColor', strokeWidth: 12, className: 'blw-ring-track' }),
                chart.segments.filter(x => x.value > 0).map(x => h('circle', { key: x.key, cx: 80, cy: 80, r: 66, fill: 'none', stroke: x.color, strokeWidth: 12, pathLength: 100, strokeDasharray: x.percent + ' ' + (100 - x.percent), strokeDashoffset: -x.offset, transform: 'rotate(-90 80 80)' }))),
              h('div', { className: 'blw-donut-center', 'aria-hidden': true }, h('strong', { title: tokens(sum.totalTokens) + ' Token' }, compactTokens(sum.totalTokens)), h('span', null, chart.total ? 'Token 总量' : '暂无用量')))),
          h('div', { className: 'blw-token-legend' }, chart.segments.map(x => h('div', { className: 'blw-legend-item', key: x.key },
            h('span', { className: 'blw-legend-label' }, h('i', { style: { background: x.color }, 'aria-hidden': true }), x.label), h('strong', { title: tokens(x.value) + ' Token' }, compactTokens(x.value))))),
          chart.inconsistent ? h('p', { className: 'blw-notice blw-notice-warn' }, '分类 Token 与报告总量不一致，环形图按已分类用量展示。') : null,
          sum.unpricedCalls ? h('p', { className: 'blw-notice blw-notice-warn' }, '另有 ' + sum.unpricedCalls + ' 次调用暂无价格，未按零元处理。') : null,
          usage.projectionMatches === false ? h('p', { className: 'blw-notice blw-notice-warn', role: 'alert' }, '账本与 DSH 累计值尚未对齐，数据待核对。') : null,
          h('div', { className: 'blw-usage-footer' }, h('span', null, '每5秒刷新 · 模型返回用量后更新'), h('span', { title: localTime(usage.lastCallAt) }, '最近调用 ' + clockTime(usage.lastCallAt))),
          h('details', { className: 'blw-details' }, h('summary', null, '完整用量与计费说明'),
            h('dl', { className: 'blw-detail-list' }, detailRow(label + ' Token 总量', tokens(sum.totalTokens)),
              ...chart.segments.map(x => detailRow(x.label, tokens(x.value), x.key)),
              detailRow('最近调用', localTime(usage.lastCallAt)), detailRow('价格核对日期', usage.pricing?.checkedAt ?? '未知')),
            h('p', { className: 'blw-detail-note' }, '按专属会话实际用量与官方峰谷价估算，非平台结算账单。统计不含 OpenBiliClaw、Codex、其他会话及未记入本会话的辅助调用。'),
            h('p', { className: 'blw-detail-note' }, '环形图表示 Token 构成；缓存命中率 = 缓存输入 ÷ 全部输入，不含输出。这里只统计用量，没有设置金额或 Token 预算。')),
          h('p', { className: 'blw-billing-note' }, '费用为估算，非平台结算账单')) : h('p', { className: 'blw-loading', role: 'status' }, '正在回读鲸鱼会话的实际用量…'),
        error ? h('p', { className: 'blw-notice blw-notice-warn', role: 'alert' }, '用量读取失败：' + error + (usage ? '；当前显示最近一次成功数据。' : '')) : null);
    }
    function renderDiscoverySummary(discovery) {
      if (!discovery) return null;
      const candidates = discovery.candidates ?? [];
      return h('details', { className: 'blw-discovery blw-details' },
        h('summary', null, '最近智能选片', h('span', { className: 'blw-summary-meta' }, candidates.length + ' 条初选 · ' + candidates.filter(x => x.community?.distinctRecentPeers > 0).length + ' 条有社区线索')),
        h('p', { className: 'blw-detail-note' }, localTime(discovery.generatedAt) + ' · OpenBiliClaw 已评分 ' + (discovery.inventory?.obcScoredCandidates ?? 0) + ' 条候选；此处也会记录手动预览，不代表自动任务已执行。'),
        h('ul', { className: 'blw-candidates' }, candidates.map(x => h('li', { key: x.bvid }, h('span', null, x.title), h('small', null, x.focus ? 'AI / 大肥鱼社区' : '长期兴趣')))));
    }

    function useStyleOnce() {
      useEffect(() => {
        if (typeof document === "undefined") return;
        let el = document.getElementById(CSS_TAG);
        if (!el) {
          el = document.createElement("style");
          el.id = CSS_TAG;
          document.head.appendChild(el);
        }
        if (el.textContent !== CSS) el.textContent = CSS;
      }, []);
    }

    function Row({ f, cfg, set }) {
      const raw = getPath(cfg, f.path);
      const common = { className: "blw-input" + (f.wide ? " blw-wide" : "") };
      // 2026-10-18 修：list 字段以前"值 = 数组 join、改动 = split 回数组" ✗
      //   → 你一打逗号，join 立刻把它吞掉（输入框里根本打不出逗号 ✗）
      //   现在：本地文本 state 管显示 ✓ 数组只在解析时更新 ✓（逗号能打、末尾逗号也不会乱跳 ✓）
      const [listText, setListText] = useState(Array.isArray(raw) ? raw.join("，") : (raw ?? ""));
      useEffect(() => {
        setListText(Array.isArray(raw) ? raw.join("，") : (raw ?? ""));
      }, [JSON.stringify(raw ?? null)]);
      let control;
      if (f.kind === "list") {
        control = h("input", {
          ...common,
          value: listText,          // ← 显示用本地文本（逗号不会被吞 ✓）
          readOnly: !!f.readOnly,
          onChange: (e) => {
            const v = e.target.value;
            setListText(v);          // 先原样显示（中文逗号、英文逗号、末尾逗号都能打 ✓）
            // 再解析成数组写进配置（空项过滤掉，不会因为末尾逗号多出一个空串 ✓）
            set(f.path, v.split(/[,，]/).map((s) => s.trim()).filter(Boolean));
          },
        });
      } else if (f.kind === "number") {
        control = h("input", { ...common, type: "number", step: "any", value: raw ?? "", readOnly: !!f.readOnly,
          onChange: (e) => set(f.path, e.target.value === "" ? undefined : Number(e.target.value)) });
      } else if (f.kind === "switch") {
        control = h("input", { type: "checkbox", checked: !!raw, disabled: !!f.readOnly,
          onChange: (e) => set(f.path, e.target.checked) });
      } else if (f.kind === "select") {
        control = h("select", { className: "blw-select", value: raw ?? "", disabled: !!f.readOnly,
          onChange: (e) => set(f.path, e.target.value) },
          f.options.map((o) => h("option", { key: o, value: o }, o)));
      } else {
        control = h("input", { ...common, value: raw ?? "", readOnly: !!f.readOnly,
          onChange: (e) => set(f.path, e.target.value) });
      }
      return h("div", { className: "blw-row" },
        h("div", null,
          h("div", { className: "blw-label" }, f.label, f.readOnly ? h("span", { className: "blw-badge" }, "只读") : null),
          f.hint ? h("div", { className: "blw-hint" }, f.hint) : null),
        control);
    }

    // ── 作息窗口编辑器（2026-10-18 主人画的草图）─────────────────────────
    //   ①  07:00 – 09:00   （醒来 1 次）   [x]
    //   ②  17:00 – 18:00   （醒来 1 次）   [x]
    //   [ + 添加窗口 ]
    // 每个窗口有自己的次数；保存不能把独立的每日上限补回窗口总和。
    const NUMS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"];
    function WindowsEditor({ cfg, set }) {
      const wins = getPath(cfg, ["night", "windows"]);
      const list = Array.isArray(wins) ? wins : [];
      const upd = (i, patch) => set(["night", "windows"], list.map((w, j) => (j === i ? { ...w, ...patch } : w)));
      const del = (i) => set(["night", "windows"], list.filter((_, j) => j !== i));
      const add = () => set(["night", "windows"], [...list, { start: "20:00", end: "22:00", wakes: 1 }]);
      const timeInput = (v, onChange) =>
        h("input", { className: "blw-input", style: { width: "86px", minWidth: "86px" }, value: v ?? "", onChange: (e) => onChange(e.target.value) });
      return h("div", null,
        h("div", { className: "blw-rows" },
          list.length === 0
            ? h("div", { className: "blw-hint" }, "（没有窗口 = 永远不醒；至少加一个）")
            : list.map((w, i) =>
                h("div", { className: "blw-row", key: i },
                  h("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
                    h("span", { className: "blw-hint", style: { minWidth: "18px" } }, NUMS[i] ?? String(i + 1)),
                    timeInput(w.start, (v) => upd(i, { start: v })),
                    h("span", { className: "blw-hint" }, "–"),
                    timeInput(w.end, (v) => upd(i, { end: v })),
                    h("span", { className: "blw-hint" }, "醒来"),
                    h("input", { className: "blw-input", style: { width: "56px", minWidth: "56px" }, type: "number", min: 1,
                      value: w.wakes ?? 1, onChange: (e) => upd(i, { wakes: Number(e.target.value) || 1 }) }),
                    h("span", { className: "blw-hint" }, "次")),
                  h("button", { className: "blw-btn blw-btn2", disabled: list.length <= 1, onClick: () => del(i), title: "删掉这个窗口" }, "×"))),
        h("div", { style: { marginTop: "8px" } },
          h("button", { className: "blw-btn blw-btn2", onClick: add }, "+ 添加窗口"))));
    }

    // ── 开关行（复选框 + 说明）──────────────────────────────────────────
    function SwitchRow({ label, hint, value, onChange, disabled }) {
      return h("div", { className: "blw-row" },
        h("div", null,
          h("div", { className: "blw-label" }, label),
          hint ? h("div", { className: "blw-hint" }, hint) : null),
        h("input", { type: "checkbox", checked: !!value, disabled: !!disabled, onChange: (e) => onChange(e.target.checked) }));
    }

    // ── 【分享评论】（主动 @ 你）· 2026-10-18 主人给的排版 ────────────────
    function ShareEditor({ cfg, set }) {
      const s = cfg.share ?? {};
      const daily = cfg.quota?.shareDaily ?? 3;
      // 2026-10-19：分享方式二选一 —— comment=评论区公开 @ / dm=私信给你（必须带视频链接）
      const via = s.via === "dm" ? "dm" : "comment";
      const viaRadio = ([value, label, hint]) =>
        h("label", { key: value, style: { display: "flex", alignItems: "flex-start", gap: "8px", marginBottom: "10px", cursor: "pointer" } },
          h("input", { type: "radio", name: "blw-share-via", checked: via === value, style: { marginTop: "3px" }, onChange: () => set(["share", "via"], value) }),
          h("div", null,
            h("div", { className: "blw-label" }, label),
            h("div", { className: "blw-hint" }, hint)));
      return h("div", null,
        h("div", { className: "blw-group" }, "后台主动分享（不含主人私信交办）"),
        h("div", { className: "blw-rows" },
          h(SwitchRow, { label: "开启后台主动分享", hint: "只控制自主分享；主人指令独立通道可按你的要求评论或@，不占这里额度", value: s.enabled !== false, onChange: (v) => set(["share", "enabled"], v) }),
          h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "分享方式（二选一）"),
              h("div", { className: "blw-hint" }, "只在「有值得分享的」时才发；一条都不值得就一条都不发 ✓")),
            h("div", null,
              viaRadio(["comment", "评论区 @ 你", "在视频评论区发一条带 @ 的公开评论 ✓（原功能 · 别人也看得到）"]),
              viaRadio(["dm", "B站私信", "不发公开评论 ✗ 直接把分享内容 + 视频链接私信给你 ✓（更干净 ✓ 需要互关 ✓）"]))),
          h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "每天后台分享上限"),
              h("div", { className: "blw-hint" }, "仅计后台自主分享；主人私信明确交办不占用。0表示不主动分享")),
            h("input", { className: "blw-input", style: { width: "80px", minWidth: "80px" }, type: "number", min: 0,
              value: daily, onChange: (e) => set(["quota", "shareDaily"], Number(e.target.value)) }))));
    }

    // ── 【全天监听】（别人找她）· 2026-10-18 主人给的排版 ──────────────────
    function ListenEditor({ cfg, set }) {
      const L = cfg.listen ?? {};
      const mins = Math.max(1, Math.round((L.commentIntervalSec ?? 300) / 60));
      const sel = (value, options, onChange) =>
        h("select", { className: "blw-select", value, onChange: (e) => onChange(e.target.value) },
          options.map(([v, label]) => h("option", { key: v, value: v }, label)));
      const num = (value, onChange, w = "70px") =>
        h("input", { className: "blw-input", style: { width: w, minWidth: w }, type: "number", min: 0, value: value ?? "", onChange: (e) => onChange(Number(e.target.value)) });
      return h("div", null,
        h("div", { className: "blw-group" }, "全天监听（别人找她）"),
        h("div", { className: "blw-rows" },
          h(SwitchRow, { label: "评论区监听", hint: `每 ${mins} 分钟查一次「回复我的 / @我的」`, value: L.comment !== false, onChange: (v) => set(["listen", "comment"], v) }),
          h("div", { className: "blw-row" },
            h("div", null, h("div", { className: "blw-label" }, "查一次间隔（分钟）"),
              h("div", { className: "blw-hint" }, "别小于 1 分钟，免得像刷接口")),
            num(mins, (v) => set(["listen", "commentIntervalSec"], Math.max(60, v * 60)))),
          h("div", { className: "blw-row" },
            h("div", null, h("div", { className: "blw-label" }, "只回"), h("div", { className: "blw-hint" }, "哪种通知算「找她」")),
            sel(L.scope ?? "both", [["both", "直接回我的 + @我的"], ["reply", "只回直接回我的"]], (v) => set(["listen", "scope"], v))),
          h(SwitchRow, { label: "同一个人最多只回一条", hint: "30 天内只回一次同一人（默认开 ✓）", value: L.oncePerPerson !== false, onChange: (v) => set(["listen", "oncePerPerson"], v) }),
          h(SwitchRow, { label: "全天（我睡着时也回）", hint: "关掉 = 只在她醒着的窗口里回 ✓", value: !!L.allDay, onChange: (v) => set(["listen", "allDay"], v) }),

          h(SwitchRow, { label: "私信监听（只认主人）", value: !!L.dm, onChange: (v) => set(["listen", "dm"], v),
            hint: "每 20 秒看一次主人有没有给你发私信 —— 有就叫醒你，实时回 ✓ 他不说话就零开销 ✓" }),
          h(SwitchRow, { label: "直播间监听", hint: "蹲直播间弹幕里有没有叫她", value: !!L.live, onChange: (v) => set(["listen", "live"], v) }),
          h("div", { className: "blw-row" },
            h("div", null, h("div", { className: "blw-label" }, "直播间房间号"), h("div", { className: "blw-hint" }, "留空 = 不蹲直播")),
            h("input", { className: "blw-input", style: { width: "120px", minWidth: "120px" }, value: L.liveRoom ?? "", placeholder: "例如 12345", onChange: (e) => set(["listen", "liveRoom"], e.target.value) })),
          h("div", { className: "blw-row" },
            h("div", null, h("div", { className: "blw-label" }, "直播间只回"), h("div", { className: "blw-hint" }, "只回主人 = 观众的一律不理；只回艾特她的 = 只看有没有人叫她")),
            sel(L.liveScope ?? "owner", [["owner", "只回主人"], ["mention", "只回艾特她的"]], (v) => set(["listen", "liveScope"], v)))),
        h("div", { className: "blw-out" },
          "【风控护栏 · 不可关】撞到 12015 / 12051 / 10031 → 立刻停监听 + 报你\n" +
          "【权限说明 · 只读】这一轮只注册只读工具；「发评论」必须显式打开；\n不注册：上传视频、发动态、私信、抓全站"));
    }

    // ── 【待审核】（2026-10-18 主人选 B 档：她的回复先给你看，你点「发」才发）──────
    function PendingEditor() {
      const [items, setItems] = useState([]);
      const [busy, setBusy] = useState("");
      const [msg, setMsg] = useState("");

      const load = useCallback(async () => {
        try { const r = await fetch(`${API}/pending`, { headers: { accept: "application/json" } }); const j = await r.json(); setItems(j.items ?? []) } catch {}
      }, []);
      useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [load]);

      const act = async (id, what) => {
        setBusy(id + what); setMsg("");
        try {
          const r = await fetch(`${API}/pending/${what}`, {
            method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ id }),
          });
          const j = await r.json().catch(() => ({}));
          setMsg(j.ok
            ? (what === "approve" ? `✓ 已发出${j.rpid ? " · rpid=" + j.rpid : ""}` : "✓ 已删掉（也记了一笔「否」✓）")
            : `✗ ${j.error ?? "失败"}`);
          await load();
        } catch (e) { setMsg("✗ " + e.message) } finally { setBusy("") }
      };

      return h("div", null,
        h("div", { className: "blw-group" }, "待审核" + (items.length ? `（${items.length} 条）` : "")),
        h("div", { className: "blw-hint", style: { marginTop: "2px" } }, "她回复别人之前，草稿先到这儿 —— 你点「发」才发 ✓（否掉也会记一笔，她会学着改 ✓）"),
        h("div", { className: "blw-rows" },
          items.length === 0
            ? h("div", { className: "blw-hint", style: { padding: "8px 0" } }, "（队列是空的 ✓）")
            : items.map((x) => h("div", { className: "blw-row", key: x.id },
              h("div", null,
                h("div", { className: "blw-label" }, `→ ${x.who || "对方"}`, h("span", { className: "blw-badge" }, String(x.at ?? "").slice(5, 16).replace("T", " "))),
                x.src ? h("div", { className: "blw-hint" }, `他说：${String(x.src).slice(0, 80)}`) : null,
                h("div", { className: "blw-hint", style: { color: "var(--dsw-alias-label-primary)", marginTop: "4px" } }, `你要回：${x.message}`)),
              h("div", { style: { display: "flex", gap: "6px" } },
                h("button", { className: "blw-btn", disabled: !!busy, onClick: () => act(x.id, "approve") }, busy === x.id + "approve" ? "发出中…" : "发"),
                h("button", { className: "blw-btn blw-btn2", disabled: !!busy, onClick: () => act(x.id, "reject") }, "删"))))),
        msg ? h("div", { className: msg.startsWith("✓") ? "blw-hint" : "blw-err" }, msg) : null);
    }

    // ── 【消息推送】（她看完一轮，把摘要送到哪）· 2026-10-18 主人给的排版 ──────
    function NotifyEditor({ cfg, set, save }) {
      const n = cfg.notify ?? {};
      // 旧配置里可能是 stdout / file → 界面上按「不推送」显示（不误导 ✓），选新方式时会被覆盖 ✓
      const type = ["none", "desktop", "dm", "webhook", "command"].includes(n.type) ? n.type : "none";
      const [testing, setTesting] = useState(false);
      const [testOut, setTestOut] = useState("");
      const setType = (v) => set(["notify", "type"], v);
      const radio = ([value, label]) =>
        h("label", { key: value, style: { display: "inline-flex", alignItems: "center", gap: "6px", marginRight: "14px", cursor: "pointer", fontSize: "13px" } },
          h("input", { type: "radio", name: "blw-notify", checked: type === value, onChange: () => setType(value) }),
          label);
      const test = async () => {
        setTesting(true); setTestOut("…正在保存设置（测试前先落盘 ✓）\n");
        try {
          // 2026-10-19：测试前**先保存** ✓
          //   以前测试读的是磁盘上的旧配置 → "点了别的单选、测试却还发到旧通道" ✗
          //   现在"你看到的就是你测的" ✓
          await save();
          const r = await fetch(`${API}/notify-test`, { method: "POST", headers: { accept: "application/json" } });
          const j = await r.json().catch(() => ({}));
          setTestOut((j.ok ? "✓ 已发送（设置已自动保存 ✓）\n" : "✗ 失败（设置已自动保存 ✓）\n") + (j.out || "") + (j.err ? "\n" + j.err : ""));
        } catch (e) { setTestOut("✗ " + e.message); } finally { setTesting(false); }
      };
      const box = { className: "blw-out", style: { marginTop: "8px" } };
      return h("div", null,
        h("div", { className: "blw-group" }, "消息推送"),
        h("div", { className: "blw-hint", style: { marginTop: "2px" } }, "她看完一轮，把摘要送到哪？"),
        h("div", { className: "blw-rows" },
          h("div", { className: "blw-row" },
            h("div", null, h("div", { className: "blw-label" }, "方式"),
              h("div", { className: "blw-hint" }, "不推送 = 只写日记与事件流")),
            h("div", null, ["none", "desktop", "dm", "webhook", "command"].map((v, i) =>
              radio([v, ["不推送", "桌面通知", "B站私信", "Webhook", "自定义命令"][i]])))),

          type === "webhook" ? h("div", null,
            h("div", { className: "blw-row" },
              h("div", null, h("div", { className: "blw-label" }, "Webhook 地址"),
                h("div", { className: "blw-hint" }, "飞书 / 钉钉 / 企业微信 / QQ机器人 / WorkBuddy —— 把机器人给的地址贴进来就行（报文按域名自动适配 ✓）")),
              h("input", { className: "blw-input blw-wide", style: { minWidth: "300px" }, value: n.url ?? "", placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/…", onChange: (e) => set(["notify", "url"], e.target.value) })),
            h("div", { className: "blw-row" },
              h("div", null, h("div", { className: "blw-label" }, "模板"),
                h("div", { className: "blw-hint" }, "纯文本最稳；飞书/钉钉选 markdown 会漂亮一些")),
              h("select", { className: "blw-select", value: n.template ?? "text", onChange: (e) => set(["notify", "template"], e.target.value) },
                h("option", { value: "text" }, "纯文本"),
                h("option", { value: "markdown" }, "markdown")))) : null,

          type === "command" ? h("div", { className: "blw-row" },
            h("div", null, h("div", { className: "blw-label" }, "自定义命令"),
              h("div", { className: "blw-hint" }, "cmd = 可执行文件（如 node.exe）；消息**自动作为最后一个参数**传进去 ✓"),
              h("div", { className: "blw-hint" }, "⚠️ 不再支持 $MSG（2026-10-18 弃用：走 shell 有命令注入风险 ✗）")),
            h("input", { className: "blw-input blw-wide", style: { minWidth: "300px" }, value: n.cmd ?? "", placeholder: 'C:\\path\\to\\node.exe', onChange: (e) => set(["notify", "cmd"], e.target.value) }),
            h("div", { className: "blw-hint", style: { marginTop: "6px" } }, "参数（JSON 数组，可留空；比如 [\"C:/path/to/cli.js\"]）"),
            h("input", {
              className: "blw-input blw-wide", style: { minWidth: "300px" },
              value: JSON.stringify(n.args ?? []),
              onChange: (e) => {
                try { const v = JSON.parse(e.target.value); set(["notify", "args"], Array.isArray(v) ? v : []) } catch {}
              },
              placeholder: '["C:/path/to/cli.js"]',
            })) : null),

        h("div", { className: "blw-actions", style: { borderTop: "none", marginTop: "8px", paddingTop: "0" } },
          h("button", { className: "blw-btn blw-btn2", onClick: test, disabled: testing }, testing ? "发送中…" : "发条测试"),
          type === "none" ? h("span", { className: "blw-hint" }, "（方式=不推送时，测试只验证命令能跑通）") : null),
        testOut ? h("div", box, testOut) : null);
    }

    function BiliWhaleSection() {
      useStyleOnce();
      const [cfg, setCfg] = useState(null);
      const [savedJson, setSavedJson] = useState("");   // 2026-10-19：用来判断"有没有未保存的改动" ✓
      const [out, setOut] = useState("");
      const [err, setErr] = useState("");
      const [busy, setBusy] = useState("");
      const [runtimeStatus, setRuntimeStatus] = useState(null);
      const [runtimeError, setRuntimeError] = useState("");
      const [ck, setCk] = useState({ sessdata: "", bili_jct: "", buvid3: "" });
      const [ckMsg, setCkMsg] = useState("");
      // 2026-10-21：她专属的人设（~/.bili-ai/persona.md）—— 自由输入 + 注入 ✓
      const [personaText, setPersonaText] = useState("");
      const [personaMsg, setPersonaMsg] = useState("");
      const [personaBytes, setPersonaBytes] = useState(0);
      const [usageStatus, setUsageStatus] = useState(null);
      const [usageError, setUsageError] = useState("");
      const [usagePeriod, setUsagePeriod] = useState("today");

      const load = useCallback(async () => {
        setErr("");
        try {
          const r = await fetch(`${API}/settings`, { headers: { accept: "application/json" } });
          if (!r.ok) throw new Error(`HTTP ${r.status}${r.status === 403 ? "（被信任栅栏拒绝）" : ""}`);
          const j = await r.json();
          setCfg(j.config ?? {});
          setSavedJson(JSON.stringify(j.config ?? {}));
          // 人设单独一个文件，顺手读一下 ✓
          try {
            const pr = await fetch(`${API}/persona`, { headers: { accept: "application/json" } });
            if (pr.ok) { const pj = await pr.json(); setPersonaText(pj.text ?? ""); setPersonaBytes(pj.bytes ?? 0); }
          } catch {}
        } catch (e) { setErr(`读取配置失败：${e.message}`); }
      }, []);

      useEffect(() => { load(); }, [load]);
      const refreshStatus = useCallback(async () => {
        try { const r=await fetch(`${API}/status`); if(!r.ok) throw Error(`HTTP ${r.status}`); setRuntimeStatus(await r.json()); setRuntimeError(""); }
        catch(e) {setRuntimeError(e.message);}
      }, []);
      useEffect(() => { refreshStatus(); const timer=setInterval(refreshStatus,10000); return ()=>clearInterval(timer); },[refreshStatus]);
      const refreshUsage = useCallback(async () => {
        try { const r=await fetch(`${API}/usage`); if(!r.ok) throw Error(`HTTP ${r.status}`); const j=await r.json(); if(j.ok!==true) throw Error(j.error||'用量暂不可读'); setUsageStatus(j); setUsageError(""); }
        catch(e) {setUsageError(e.message);}
      }, []);
      useEffect(() => { refreshUsage(); const timer=setInterval(refreshUsage,5000); return ()=>clearInterval(timer); },[refreshUsage]);

      const set = (path, value) => setCfg((c) => {
        const next = JSON.parse(JSON.stringify(c ?? {}));
        setPath(next, path, value);
        if(path.join('.')==='privateReply.enabled') setPath(next,['listen','dm'],value);
        if(path.join('.')==='listen.dm') setPath(next,['privateReply','enabled'],value);
        return next;
      });

      const save = async () => {
        setBusy("save"); setErr(""); setOut("");
        try {
          const wins = cfg?.night?.windows ?? [];
          const total = wins.reduce((s, w) => {
            const n = Number(w.wakes);
            return s + (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 1);
          }, 0);
          const requested = cfg?.night?.maxWakesPerDay;
          const cap = requested === undefined ? total : Math.min(total, Math.max(0, Number(requested) || 0));
          const body = { ...(cfg ?? {}), night: { ...(cfg?.night ?? {}), maxWakesPerDay: cap } };
          const r = await fetch(`${API}/settings`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            // 2026-10-18：宿主现在两种都收 ✓，这里显式包一层最稳（以前发裸对象 → 宿主 merge 到 {}
            body: JSON.stringify({ config: body }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          setOut(`✓ 已保存${j.warn ? `\n⚠️ ${j.warn}` : ""}\n配置：${j.configPath ?? "~/.dsh/bili-whale.config.json"}`);
          if (j.config) { setCfg(j.config); setSavedJson(JSON.stringify(j.config)); }
          await refreshStatus();
        } catch (e) { setErr(`保存失败：${e.message}`); } finally { setBusy(""); }
      };

      const injectPersona = async () => {
        setBusy("persona"); setPersonaMsg("");
        try {
          const r = await fetch(`${API}/persona`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ text: personaText }),
          });
          const j = await r.json();
          if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
          setPersonaBytes(j.bytes ?? 0);
          setPersonaMsg(j.detail ?? "✓ 已注入");
        } catch (e) { setPersonaMsg("✗ " + e.message); }
        finally { setBusy(""); }
      };

      const deps = async () => {
        setBusy("deps"); setErr(""); setOut("检查中…");
        try {
          const r = await fetch(`${API}/deps`, { headers: { accept: "application/json" } });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          const lines = (j.items ?? []).map((i) => `${i.ok ? "✓" : "✗"} ${i.name} — ${i.detail ?? ""}`);
          const schedulerOk = j.scheduler?.ok === true;
          lines.push(`${schedulerOk ? "✓" : "✗"} 生物钟 — ${j.scheduler?.reason ?? "未返回调度器状态"}`);
          if (j.error) lines.push(j.error);
          // 2026-10-19：体检后顺手重读配置 ✓ 不然「她自己 mid/昵称」那两格永远显示旧值 ✗
          if (j.self) lines.push("", `她自己：${j.self.name}（mid ${j.self.mid}）✓`);
          await load();
          setOut([...lines, "", j.ok && schedulerOk ? "全部可用 ✓" : "有项不可用 ✗"].join("\n"));
        } catch (e) { setErr(`依赖体检失败：${e.message}`); } finally { setBusy(""); }
      };

      const saveCookie = async () => {
        setBusy("cookie"); setErr(""); setCkMsg("");
        try {
          const r = await fetch(`${API}/cookie`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify(ck),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          setCkMsg(`✓ ${j.detail ?? "已写入"}` + (j.warn ? `\n${j.warn}` : ""));   // 永不回显 cookie ✓（warn 要说出来 ✗ 不然等于没查）
          setCk({ sessdata: "", bili_jct: "", buvid3: "" });
        } catch (e) { setCkMsg(`✗ ${e.message}`); } finally { setBusy(""); }
      };

      if (!cfg) {
        return h("div", { className: "blw" },
          h("h3", { className: "blw-title" }, "养鱼"),
          err ? h("div", { className: "blw-err" }, err) : h("div", { className: "blw-hint" }, "读取中…"));
      }

      const groups = [];
      for (const f of FIELDS) {
        let g = groups.find((x) => x.name === f.group);
        if (!g) { g = { name: f.group, fields: [] }; groups.push(g); }
        g.fields.push(f);
      }
      // 渲染顺序（2026-10-22 主人定，见下面的 GROUP_ORDER）：
      //   她是谁 → 你（主人）→ 口味 → 作息 →【分享评论 + 全天监听】→ 日记与推送 → 消息推送 → 工具链
      // 2026-10-21：人设块 —— 挂在「她是谁」那一组下面 ✓（主人要求放这三个字段下面）
      const personaBlock = () => [
          h("div", { className: "blw-group" }, "她的人设（只属于她）"),
          h("div", { className: "blw-rows" },
            h("div", { className: "blw-row" },
              h("div", null,
                h("div", { className: "blw-label" }, "人设正文"),
                h("div", { className: "blw-hint" },
                  "写到 ", h("code", null, "~/.bili-ai/persona.md"),
                  "，只影响她（不影响别的会话 ✓）。每次唤醒/监听都会附在提示里 ✓",
                  h("br"),
                  "建议写：身份与来历 / 说话腔调 / 在意什么、怕什么 / 明确不要的行为。上限 20000 字，注入时只取前 3000 字 ✓")),
              h("div", { className: "blw-cookie", style: { minWidth: 0, width: "100%", flexBasis: "100%" } },
                h("textarea", {
                  className: "blw-input",
                  rows: 16,
                  placeholder: "例如：\n她的名字是…\n她说话时会…\n她在意…\n她绝对不会…",
                  value: personaText,
                  onChange: (e) => setPersonaText(e.target.value),
                  style: { resize: "vertical", fontFamily: "inherit", lineHeight: "1.6", width: "100%", minHeight: "280px", height: "clamp(280px, 40vh, 560px)", boxSizing: "border-box", padding: "10px 12px" },
                }),
                h("div", { className: "blw-hint" },
                  "当前 " + personaBytes + " 字节" + (personaText.length > 20000 ? "（超过 20000 上限 ✗）" : "")),
                h("button", { className: "blw-btn", onClick: injectPersona, disabled: !!busy || personaText.length > 20000 },
                  busy === "persona" ? "注入中…" : "注入人设"),
                personaMsg ? h("div", { className: personaMsg.startsWith("✓") ? "blw-hint" : "blw-err" }, personaMsg) : null))),
      ];

      const renderGroup = (g) => h("div", { key: g.name },
        h("div", { className: "blw-group" }, g.name),
        g.name === "作息" ? h(WindowsEditor, { cfg, set }) : null,
        h("div", { className: "blw-rows" }, g.fields.map((f) => h(Row, { key: f.path.join("."), f, cfg, set }))),
        // 2026-10-21：人设块放在这三个字段【下面】✓（主人要求）
        g.name === "她是谁" ? h("div", null, personaBlock()) : null);
      // 2026-10-22 修：分组顺序显式定死 ✗ 不再靠 FIELDS 里字段出现的先后
      //   （v0.4.2 把新字段插在 FIELDS 最前面 → 工具链跑到了第一位 ✗ 整个页面顺序乱了）
      //   主人定的顺序：她是谁 → 你 → 口味 → 作息 →【分享 / 监听】→ 日记与推送 → 消息推送 → 工具链
      const GROUP_ORDER = ["她是谁", "你（主人）", "口味", "智能选片", "作息"]
      const byName = (n) => groups.find((g) => g.name === n)
      const orderedTop = GROUP_ORDER.map(byName).filter(Boolean)
      const orderedMid = ["日记与推送"].map(byName).filter(Boolean)
      const orderedTool = ["工具链"].map(byName).filter(Boolean)
      // 兜底：万一以后又加了新分组，别让它消失 ✗
      const known = new Set([...GROUP_ORDER, "日记与推送", "工具链"])
      const leftovers = groups.filter((g) => !known.has(g.name))
      const ci = { className: "blw-input" };
      return h("div", { className: "blw" },
        h("h3", { className: "blw-title" }, "养鱼"),
        renderRuntimeOverview({ status: runtimeStatus, cfg, error: runtimeError }),
        renderUsageOverview({ usage: usageStatus, period: usagePeriod, setPeriod: setUsagePeriod, error: usageError }),
        renderDiscoverySummary(runtimeStatus?.discovery),
        h("p", { className: "blw-intro" },
          "让 agent 自己按作息刷 B 站、看懂视频、写两本日记，把值得的 @ 你。",
          "所有值写进 ", h("code", null, "~/.dsh/bili-whale.config.json"),
          "（与工具链共用同一份 ✓；这里没显示的字段保存时原样保留 ✓）。"),

        ...orderedTop.map(renderGroup),

        h(ShareEditor, { cfg, set }),
        h(ListenEditor, { cfg, set }),

        ...orderedMid.map(renderGroup),
        h(NotifyEditor, { cfg, set, save }),
        ...leftovers.map(renderGroup),
        ...orderedTool.map(renderGroup),

        h("div", { className: "blw-group" }, "B 站 cookie"),
        h("div", { className: "blw-rows" },
          h("div", { className: "blw-row" },
            h("div", null,
              h("div", { className: "blw-label" }, "凭据"),
              h("div", { className: "blw-hint" }, "浏览器 F12 → Cookie 里复制（SESSDATA 是 HttpOnly，console 拿不到 ✗）；写入后永不回显 ✓")),
            h("div", { className: "blw-cookie" },
              h("input", { ...ci, placeholder: "SESSDATA", value: ck.sessdata, onChange: (e) => setCk((s) => ({ ...s, sessdata: e.target.value })) }),
              h("input", { ...ci, placeholder: "bili_jct", value: ck.bili_jct, onChange: (e) => setCk((s) => ({ ...s, bili_jct: e.target.value })) }),
              h("input", { ...ci, placeholder: "buvid3（可空）", value: ck.buvid3, onChange: (e) => setCk((s) => ({ ...s, buvid3: e.target.value })) }),
              h("button", { className: "blw-btn blw-btn2", onClick: saveCookie, disabled: !!busy || !ck.sessdata || !ck.bili_jct },
                busy === "cookie" ? "写入中…" : "写入凭据"),
              ckMsg ? h("div", { className: (ckMsg.startsWith("✓") ? "blw-hint blw-pre" : "blw-err") }, ckMsg) : null))),
        h("div", { className: "blw-actions" },
          h("button", { className: "blw-btn", onClick: save, disabled: !!busy }, busy === "save" ? "保存中…" : "保存"),
          cfg && savedJson && JSON.stringify(cfg) !== savedJson
            ? h("span", { style: { marginLeft: "10px", color: "#ffb020", fontSize: "13px" } }, "● 有改动还没保存（改了不点保存 = 没生效 ✗）")
            : null,
          h("button", { className: "blw-btn blw-btn2", onClick: deps, disabled: !!busy }, busy === "deps" ? "体检中…" : "依赖体检"),
          h("button", { className: "blw-btn blw-btn2", onClick: load, disabled: !!busy }, "重新读取")),

        err ? h("div", { className: "blw-err" }, err) : null,
        out ? h("div", { className: "blw-out" }, out) : null,
        h("div", { className: "blw-hint" }, "装完先点「依赖体检」：cookie / ffmpeg / node / 数据目录 都 ✓ 才算可用。"));
    }

    const inject = ["slots"];
    const NS = "bili-whale";
    const NAMES = { nav: "养鱼" };

    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.slots.inject("settings.section", () =>
            ctx.slots.register(
              { name: "settings.section", id: NS, order: 6, label: () => NAMES.nav },
              BiliWhaleSection,
            ),
            "bili-whale: settings section",
          ),
        "bili-whale: settings section",
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.BiliWhaleSection = BiliWhaleSection;
    exports.FIELDS = FIELDS;
    exports.buildRuntimeView = buildRuntimeView;
    exports.buildTokenBreakdown = buildTokenBreakdown;
    exports.formatCost = formatCost;
    exports.renderRuntimeOverview = renderRuntimeOverview;
    exports.renderUsageOverview = renderUsageOverview;
    return module.exports;
  },
});
