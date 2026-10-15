# Vertex2OpenAI 控制台（SillyTavern UI 扩展）

服务端插件 [sillytavern-vertex2openai](https://github.com/shijie6/sillytavern-vertex2openai) 的配套面板。
装了它就不用再单独开浏览器标签访问 `/api/plugins/vertex2openai/settings`，直接在酒馆的
「扩展」面板里改配置、自检、探测可用模型。

**它只是个遥控器**，不参与请求转发。真正干活的是后端插件自带的那台 HTTP 服务。

## 安装

1. 先装好后端服务端插件（见上面那个仓库的 README）
2. 酒馆里：扩展 → 下载扩展/插件 → 贴 `https://github.com/shijie6/sillytavern-vertex2openai-ui` → 安装
3. 重启酒馆，进「扩展」面板，会看到 **Vertex2OpenAI 控制台**

如果面板里显示「连不上后端插件」，说明服务端插件没装上或没启用 —— 检查
`config.yaml` 里的 `enableServerPlugins: true`。

## 能做什么

| 区 | 内容 |
|---|---|
| 状态 | 服务是否在监听、端点地址、当前通道、Key/Cookie 数量、项目、区域、代理 |
| 凭证 | Express API Key（每行一把）、Cookie（一整条，多条之间空一行）、项目 ID、区域 |
| 服务 | 监听地址、端口、出网代理、访问口令 |
| 模型与生成 | 模型列表、原生思考控制、思考档位、采样策略、预填充设置、调试开关 |
| 连通性自检 | 选模型 + 选通道，真发一条消息验证，失败会给出分类和处置建议 |
| 批量探测 | 逐个试模型列表，列出哪些能用，并给出可直接粘回模型框的文本（**会烧配额，慎用**） |

「复制端点地址」按钮复制的就是酒馆连接里要填的那个地址（`http://127.0.0.1:8050/v1`）。

## 它为什么不直接连 127.0.0.1:8050

后端服务监听在 `127.0.0.1:8050`，只有**跑酒馆的那台机器**自己能访问。
而如果你从手机、或者局域网里另一台电脑的浏览器打开酒馆页面，页面 JS 里的
`127.0.0.1` 指的是**浏览器所在那台机器**，不是服务端 —— 直连必然失败。

所以本扩展一律走酒馆自己的 `/api/plugins/vertex2openai/*`：同源请求，由酒馆服务端
转发给插件，从任何设备打开都能用。代价是 POST 要过 CSRF 校验，所以请求都带了
`getRequestHeaders()`（内含 `X-CSRF-Token`）。

## Cookie 通道可能用不了

在 **Vertex Express 快速模式**的项目上，Cookie 通道常常报：

```
Permission 'aiplatform.endpoints.predict' denied ... (or it may not exist)
```

这句里的 `(or it may not exist)` 是 Google 的固定后缀，**不是**说模型不存在。
真正的判定依据是那个权限名 `aiplatform.endpoints.predict` —— 出现它就是 IAM 授权问题。

两种常见原因：

1. Cookie 抓自**另一个 Google 账号**（浏览器多账号登录时极易抓错）
2. Express 快速模式的项目只给 `express-mode@<项目>.iam.gserviceaccount.com` 这个服务账号
   授了权，**人类账号没有该权限**

去 GCP 控制台「IAM 与管理 → IAM」看你的邮箱是否带 `Vertex AI User` 角色。
快速模式项目若不给改 IAM，就只能用 Express 通道。

## 开发说明

- 纯前端 ES 模块，无第三方依赖，只用酒馆自带的 jQuery
- 目录结构遵循酒馆扩展规范：`manifest.json` + `index.js` + `style.css`
- 字段与后端 `DEFAULT_SETTINGS` 一一对应；POST 只提交表单里有的字段，
  后端合并时未提交的字段保持原值，不会因为少提交而丢配置
