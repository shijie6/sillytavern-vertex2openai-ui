/**
 * vertex2openai 前端控制台（SillyTavern UI 扩展）
 *
 * 与服务端插件 sillytavern-vertex2openai 配套。后端自带独立 HTTP 服务（默认 127.0.0.1:8050）
 * 提供 OpenAI 兼容端点，本扩展只做配置与状态展示，不参与实际转发。
 *
 * 为什么必须走酒馆自己的 /api/plugins/... 路由，而不是让浏览器直接访问 127.0.0.1:8050：
 * 从手机或别的电脑打开酒馆页面时，页面 JS 里的 127.0.0.1 指的是「浏览器所在那台机器」，
 * 不是跑酒馆的那台机器，直连必然失败。走 /api/plugins/ 是同源请求，由酒馆服务端转发给插件，
 * 无论从哪里打开都能用。代价是 POST 要过 CSRF 校验，所以必须用 getRequestHeaders() 带上令牌。
 */

import { getRequestHeaders } from '../../../script.js';

const PLUGIN_ID = 'vertex2openai';
const BASE = `/api/plugins/${PLUGIN_ID}`;
const PANEL_ID = 'v2o_panel';

const $ = jQuery;

let cfg = null;
let status = null;
let started = false;

function esc(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** 数组 <-> 文本框。模型/Key 每行一条，Cookie 用空行分隔多条（与后端 parseCookies 约定一致）。 */
const joinLines = (arr) => (Array.isArray(arr) ? arr : []).join('\n');
const joinBlocks = (arr) => (Array.isArray(arr) ? arr : []).join('\n\n');

async function api(path, options = {}) {
    const res = await fetch(`${BASE}${path}`, {
        method: options.method || 'GET',
        headers: getRequestHeaders(),
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    if (!res.ok) {
        let detail = '';
        try {
            const j = await res.json();
            detail = j?.error || j?.message || '';
        } catch {
            detail = (await res.text().catch(() => '')).slice(0, 200);
        }
        const err = new Error(detail ? `${detail}` : `请求失败（HTTP ${res.status}）`);
        err.httpStatus = res.status;
        throw err;
    }
    return await res.json();
}

function say(text, kind = '') {
    $(`#${PANEL_ID} .v2o-msg`).removeClass('ok err').addClass(kind).text(text);
}

function fatal(text) {
    $(`#${PANEL_ID} .v2o-err`).show().html(text);
    $(`#${PANEL_ID} .v2o-body`).hide();
}

/* ---------------------------------- 渲染 ---------------------------------- */

function renderStatus() {
    if (!status) return;
    const on = status.listening;
    const rows = [
        ['服务状态', on ? `<span class="v2o-on">监听中</span>` : `<span class="v2o-off">未启动</span>`],
        ['端点地址', `<code>${esc(status.endpoint)}</code>`],
        ['当前通道', esc({ auto: '自动', express: '仅 Express', cookie: '仅 Cookie' }[status.channel] || status.channel)],
        ['凭证', `Express Key ${status.keys} 把 / Cookie ${status.cookies} 条`],
        ['项目', esc(status.projectId || '未填') + (status.cookieProjectId ? `（Cookie 通道：${esc(status.cookieProjectId)}）` : '')],
        ['区域', esc(status.location || '未填')],
        ['出网代理', esc(status.proxy || '直连')],
    ];
    $(`#${PANEL_ID} .v2o-status`).html(
        rows.map(([k, v]) => `<div class="v2o-srow"><span>${k}</span><span>${v}</span></div>`).join(''),
    );
}

function fillForm() {
    if (!cfg) return;
    const set = (id, v) => $(`#${PANEL_ID} #v2o_${id}`).val(v ?? '');
    const chk = (id, v) => $(`#${PANEL_ID} #v2o_${id}`).prop('checked', Boolean(v));

    set('channel', cfg.channel || 'auto');
    set('expressKeys', joinLines(cfg.expressKeys));
    set('projectId', cfg.projectId);
    set('location', cfg.location);
    set('cookies', joinBlocks(cfg.cookies));
    set('cookieProjectId', cfg.cookieProjectId);
    set('cookieSafety', cfg.cookieSafety || 'OFF');
    set('models', joinLines(cfg.models));
    set('prefillInstruction', cfg.prefillInstruction);
    set('proxyUrl', cfg.proxyUrl);
    set('host', cfg.host);
    set('port', cfg.port);
    set('accessKey', cfg.accessKey);
    set('nativeThinkingMode', cfg.nativeThinkingMode || 'off');
    set('thinkingLevel', cfg.thinkingLevel || '');
    set('samplingPolicy', cfg.samplingPolicy || 'auto');
    chk('prefillSuppressThinking', cfg.prefillSuppressThinking);
    chk('debug', cfg.debug);
}

function renderModels() {
    const models = (cfg && Array.isArray(cfg.models)) ? cfg.models : [];
    const sel = $(`#${PANEL_ID} #v2o_testModel`);
    const keep = sel.val();
    sel.html(models.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join(''));
    const want = models.includes(keep) ? keep : (models.find(m => m === 'gemini-3.6-flash') || models[0] || '');
    sel.val(want);
}

/* ---------------------------------- 动作 ---------------------------------- */

async function refresh(fill = true) {
    try {
        cfg = await api('/config');
        status = await api('/status');
    } catch (err) {
        if (err.httpStatus === 404) {
            fatal('连不上后端插件 <code>vertex2openai</code>。'
                + '请确认已经在「扩展 → 下载扩展/插件」里安装了<b>服务端插件</b>'
                + '（<code>https://github.com/shijie6/sillytavern-vertex2openai</code>），'
                + '并且 <code>config.yaml</code> 里 <code>enableServerPlugins: true</code>，然后重启酒馆。');
        } else {
            fatal(`拉取配置失败：${esc(err.message)}`);
        }
        return;
    }
    $(`#${PANEL_ID} .v2o-err`).hide();
    $(`#${PANEL_ID} .v2o-body`).show();
    renderStatus();
    renderModels();
    if (fill) fillForm();
}

function collect() {
    const v = (id) => $(`#${PANEL_ID} #v2o_${id}`).val();
    const c = (id) => $(`#${PANEL_ID} #v2o_${id}`).prop('checked');
    return {
        host: v('host'),
        port: Number(v('port')) || 8050,
        expressKeys: v('expressKeys'),
        projectId: v('projectId'),
        location: v('location'),
        proxyUrl: v('proxyUrl'),
        accessKey: v('accessKey'),
        nativeThinkingMode: v('nativeThinkingMode'),
        thinkingLevel: v('thinkingLevel'),
        prefillSuppressThinking: c('prefillSuppressThinking'),
        samplingPolicy: v('samplingPolicy'),
        channel: v('channel'),
        cookies: v('cookies'),
        cookieProjectId: v('cookieProjectId'),
        cookieSafety: v('cookieSafety'),
        prefillInstruction: v('prefillInstruction'),
        models: v('models'),
        debug: c('debug'),
    };
}

async function save(restart) {
    say('正在保存...');
    try {
        await api('/config', { method: 'POST', body: collect() });
        if (restart) {
            say('已保存，正在重启服务...');
            await api('/restart', { method: 'POST', body: {} });
        }
        await refresh(false);
        say(restart ? '已保存并重启服务' : '已保存', 'ok');
    } catch (err) {
        say(`保存失败：${err.message}`, 'err');
    }
}

async function selftest() {
    const model = $(`#${PANEL_ID} #v2o_testModel`).val();
    const channel = $(`#${PANEL_ID} #v2o_testChannel`).val();
    if (!model) { say('模型列表是空的，先填模型', 'err'); return; }
    say(`正在用 ${model} 发一条测试消息...`);
    const qs = `?model=${encodeURIComponent(model)}&channel=${encodeURIComponent(channel)}`;
    try {
        const r = await api(`/selftest${qs}`);
        if (r.ok) {
            const via = { express: 'Express', cookie: 'Cookie' }[r.channel] || r.channel;
            say(`成功（${via}）：${(r.reply || '').slice(0, 60)}`, 'ok');
        } else {
            const extra = r.hint ? ` —— ${r.hint}` : '';
            say(`失败【${r.kind || '错误'}】：${(r.error || '').slice(0, 120)}${extra}`, 'err');
        }
    } catch (err) {
        say(`自检请求失败：${err.message}`, 'err');
    }
}

async function scan() {
    const channel = $(`#${PANEL_ID} #v2o_scanChannel`).val();
    const out = $(`#${PANEL_ID} .v2o-scanout`);
    say('正在逐个探测，这会真实消耗配额...');
    try {
        const r = await api('/scan', { method: 'POST', body: { channel } });
        const lines = (r.results || []).map(x => (x.ok ? `  ✔ ${x.model}` : `  ✘ ${x.model}  [${x.kind}]`));
        const good = (r.results || []).filter(x => x.ok).map(x => x.model);
        out.show().text(
            ['探测结果：', ...lines, '', '可直接粘回模型列表框：', good.join('\n')].join('\n'),
        );
        say(`探测完成：${good.length} / ${(r.results || []).length} 个可用`, good.length ? 'ok' : 'err');
    } catch (err) {
        say(`探测失败：${err.message}`, 'err');
    }
}

async function copyEndpoint() {
    const text = status ? status.endpoint : `http://127.0.0.1:${Number(cfg?.port) || 8050}/v1`;
    let ok = false;
    try {
        await navigator.clipboard.writeText(text);
        ok = true;
    } catch {
        const ta = $('<textarea>').val(text).css({ position: 'fixed', opacity: 0 }).appendTo('body');
        ta[0].select();
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        ta.remove();
    }
    say(ok ? `已复制：${text}` : `复制失败，请手动复制：${text}`, ok ? 'ok' : 'err');
}

/* ---------------------------------- 装配 ---------------------------------- */

function buildPanel() {
    const html = `
<div id="${PANEL_ID}">
    <div class="v2o-err" style="display:none"></div>
    <div class="v2o-body">
        <div class="v2o-status"></div>

        <div class="v2o-actions">
            <button class="v2o-btn" data-act="refresh">刷新状态</button>
            <button class="v2o-btn" data-act="save">保存</button>
            <button class="v2o-btn" data-act="saveRestart">保存并重启服务</button>
            <button class="v2o-btn" data-act="copy">复制端点地址</button>
            <span class="v2o-msg"></span>
        </div>

        <div class="v2o-group">
            <div class="v2o-field">
                <label>通道选择</label>
                <select id="v2o_channel">
                    <option value="auto">自动（Express 被限流时转 Cookie）</option>
                    <option value="express">仅 Express（官方 API Key）</option>
                    <option value="cookie">仅 Cookie（网页端配额）</option>
                </select>
            </div>
            <div class="v2o-field">
                <label>Express API Key（每行一把，多把轮换）</label>
                <textarea id="v2o_expressKeys" rows="3" placeholder="AQ.xxxx 或 AIzaSyxxxx"></textarea>
            </div>
            <div class="v2o-field v2o-half">
                <label>GCP 项目 ID</label>
                <input id="v2o_projectId" type="text" placeholder="例如 central-star-x83d0">
            </div>
            <div class="v2o-field v2o-half">
                <label>区域</label>
                <input id="v2o_location" type="text" placeholder="global">
            </div>

            <div class="v2o-sep">Cookie 直连</div>
            <div class="v2o-field">
                <label>浏览器 Cookie（一整条；配多条请中间空一行）</label>
                <textarea id="v2o_cookies" rows="4" placeholder="从 DevTools 请求头里复制的 cookie: 那一整行"></textarea>
                <div class="v2o-hint">它会自动折行显示，那是正常的，不用管。必须含 <code>SAPISID</code>。</div>
            </div>
            <div class="v2o-field v2o-half">
                <label>Cookie 通道项目 ID（留空复用上面）</label>
                <input id="v2o_cookieProjectId" type="text">
            </div>
            <div class="v2o-field v2o-half">
                <label>安全过滤</label>
                <select id="v2o_cookieSafety">
                    <option value="OFF">OFF（关掉过滤器）</option>
                    <option value="BLOCK_NONE">BLOCK_NONE（评分但不拦截）</option>
                </select>
            </div>

            <div class="v2o-sep">服务与网络</div>
            <div class="v2o-field v2o-half">
                <label>监听地址</label>
                <input id="v2o_host" type="text" placeholder="0.0.0.0 或 127.0.0.1">
            </div>
            <div class="v2o-field v2o-half">
                <label>端口</label>
                <input id="v2o_port" type="number" placeholder="8050">
            </div>
            <div class="v2o-field v2o-half">
                <label>出网代理（留空直连）</label>
                <input id="v2o_proxyUrl" type="text" placeholder="http://192.168.31.115:7890">
            </div>
            <div class="v2o-field v2o-half">
                <label>访问口令（留空不校验）</label>
                <input id="v2o_accessKey" type="text">
            </div>

            <div class="v2o-sep">模型与生成</div>
            <div class="v2o-field">
                <label>模型列表（每行一个）</label>
                <textarea id="v2o_models" rows="6"></textarea>
            </div>
            <div class="v2o-field">
                <label>原生思考控制</label>
                <select id="v2o_nativeThinkingMode">
                    <option value="off">关闭原生思考（推荐，让预设思维链接管）</option>
                    <option value="request">跟随客户端档位</option>
                    <option value="console">强制使用下面设的档位</option>
                </select>
            </div>
            <div class="v2o-field v2o-half">
                <label>思考档位（仅在「强制」时生效）</label>
                <select id="v2o_thinkingLevel">
                    <option value="">跟随模型默认</option>
                    <option value="minimal">minimal</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                </select>
            </div>
            <div class="v2o-field v2o-half">
                <label>采样参数策略</label>
                <select id="v2o_samplingPolicy">
                    <option value="auto">自动（按模型版本判定）</option>
                    <option value="deprecated">强制剥离 temperature/top_p/top_k</option>
                    <option value="allowed">强制保留</option>
                </select>
            </div>
            <div class="v2o-field">
                <label>预填充续写提示语（留空用默认）</label>
                <input id="v2o_prefillInstruction" type="text">
            </div>
            <div class="v2o-field">
                <label class="v2o-inline"><input id="v2o_prefillSuppressThinking" type="checkbox"> 预填充时抑制原生思考</label>
                <label class="v2o-inline"><input id="v2o_debug" type="checkbox"> 输出调试日志</label>
            </div>
        </div>

        <div class="v2o-row">
            <span>连通性自检</span>
            <select id="v2o_testModel"></select>
            <select id="v2o_testChannel">
                <option value="">跟随配置</option>
                <option value="express">强制 Express</option>
                <option value="cookie">强制 Cookie</option>
            </select>
            <button class="v2o-btn" data-act="selftest">自检</button>
        </div>

        <div class="v2o-row">
            <span>批量探测可用模型</span>
            <select id="v2o_scanChannel">
                <option value="">跟随配置</option>
                <option value="express">强制 Express</option>
                <option value="cookie">强制 Cookie</option>
            </select>
            <button class="v2o-btn" data-act="scan">探测</button>
            <span class="v2o-hint">会真实发 N 条请求（N=模型数），配额紧张时慎用</span>
        </div>
        <pre class="v2o-scanout" style="display:none"></pre>
    </div>
</div>`;

    const drawer = $(`
<div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
        <b>Vertex2OpenAI 控制台</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">${html}</div>
</div>`);
    $('#extensions_settings').append(drawer);
    drawer.find('.inline-drawer-toggle').on('click', function () {
        $(this).next('.inline-drawer-content').slideToggle(150);
        $(this).find('.inline-drawer-icon').toggleClass('up down');
    });

    const acts = { refresh: () => refresh(true), save: () => save(false), saveRestart: () => save(true), copy: copyEndpoint, selftest, scan };
    drawer.on('click', '[data-act]', function () {
        const fn = acts[$(this).data('act')];
        if (fn) fn();
    });
}

jQuery(async () => {
    if (started) return;
    started = true;
    try {
        buildPanel();
        await refresh(true);
    } catch (err) {
        console.error('[vertex2openai-ui] 初始化失败', err);
        $(`#${PANEL_ID} .v2o-err`).show().text(`初始化失败：${err.message}`);
    }
});
