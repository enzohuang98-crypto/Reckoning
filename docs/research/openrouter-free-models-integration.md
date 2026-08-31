# OpenRouter 免費模型整合研究

研究日期：2026-08-31（Asia/Taipei）
範圍：只使用 OpenRouter 官方文件與官方即時 API；不含任何真實 API Key。

## Research question

本研究要確定四件事：

1. OpenRouter API Key 的正確鑑權方式、Base URL 與可用的伺服器端驗證端點。
2. 應用程式如何即時取得「所有可選的特定免費模型」，以及 `:free`、`pricing = 0`、Models API 之間的關係。
3. Chat Completions 的 `model` 欄位如何確保使用者在 UI 選到 A 模型時，後端不改呼叫 B 模型。
4. 免費模型、Free Models Router 與 Auto Router 的限制與風險。

主要歧義是「免費模型」可能指：

- 一個有明確模型 ID、可由使用者精確選擇的 `:free` 靜態變體；或
- `openrouter/free`，由 OpenRouter 在免費池中隨機選模型的路由器。

這兩者不能在 UI 或後端中混為同一種行為。

## Answer

### 1. API Key、鑑權與 Base URL

**[Confirmed]** OpenRouter 的 OpenAI 相容 Base URL 是：

```text
https://openrouter.ai/api/v1
```

Chat Completions 的完整端點是：

```text
POST https://openrouter.ai/api/v1/chat/completions
```

API Key 以 Bearer token 傳入：

```http
Authorization: Bearer <OPENROUTER_API_KEY>
Content-Type: application/json
```

`HTTP-Referer` 與 `X-OpenRouter-Title` 是可選的應用識別標頭，不是鑑權必填欄位。來源：[OpenRouter Quickstart](https://openrouter.ai/docs/quickstart)。

**[Confirmed]** 驗證使用者貼上的金鑰時，可呼叫：

```text
GET https://openrouter.ai/api/v1/key
```

同樣使用 Bearer token；有效金鑰返回目前金鑰資訊，無效金鑰有明確的 `401 Unauthorized`。這比只用字串前綴判斷可靠。官方建立金鑰的範例目前使用 `sk-or-v1-...`，但本機只應把前綴當初步格式提示，不能取代伺服器驗證。來源：[Get current API key](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key)、[Create a new API key](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys)。

### 2. 即時取得所有可選免費模型

**[Confirmed]** 完整模型目錄由以下官方端點提供：

```text
GET https://openrouter.ai/api/v1/models
```

不帶分頁參數时会返回完整列表；每个 Model 对象的 `id` 是 API 请求应使用的唯一模型标识，`name` 是人类可读名称。列表还包含 `pricing`、`supported_parameters`、`architecture`、`context_length` 等元数据。来源：[Models overview and schema](https://openrouter.ai/docs/guides/overview/models)、[List all models API](https://openrouter.ai/docs/api/api-reference/models/get-models)。

**[Confirmed]** `:free` 是静态模型变体。官方说明只有部分模型提供该变体，且静态变体会出现在 Models API。若应用要显示「可让使用者精确选择的免费模型」，最直接且语义正确的候选集合是：

```text
model.id.endsWith(":free")
```

选择后必须保存并提交这个完整 `id`，包括作者、slug 与 `:free` 后缀，例如 `author/model:free`；不能移除后缀后再依价格猜测。来源：[Free Variant](https://openrouter.ai/docs/guides/routing/model-variants/free)、[OpenRouter FAQ — model variants](https://openrouter.ai/docs/faq)。

**[Confirmed]** `pricing` 中的字符串值 `"0"` 代表该计费项目免费，但不能单独拿来认定一个条目就是「可选的特定免费聊天模型」。原因有二：

1. 官方 `max_price=0` 查询参数只定义为「最大 prompt 价格」；另有 `max_output_price=0` 只限制 completion 价格。两者都不是对 request、image、web search、internal reasoning 与 cache 等所有费用字段的共同保证。
2. `openrouter/free` 本身也显示零价格，但它是会改选底层模型的路由器，不是一个固定模型。

来源：[Models pricing schema](https://openrouter.ai/docs/guides/overview/models)、[List all models API query parameters](https://openrouter.ai/docs/api/api-reference/models/get-models)、[Free Models Router](https://openrouter.ai/docs/guides/routing/routers/free-router)。官方没有文件化的 `free=true` 过滤参数，因此即使以这两个价格查询缩小结果，仍要依 `:free` concrete ID 判定特定免费模型。

**[Confirmed — live snapshot]** 2026-08-31 09:50 UTC 直接读取官方 `GET /api/v1/models?output_modalities=text` 得到 396 个条目，其中 18 个 ID 以 `:free` 结尾。以 prompt、completion、request 均为零筛选会得到 21 个条目，额外包含两个不带 `:free` 的 Lyria preview 条目和 `openrouter/free`。而 `max_price=0` 也返回两个不带 `:free` 的 Lyria preview 条目。因此，`pricing=0` 或 `max_price=0` 都不能替代 `:free` ID 判定。即时来源：[OpenRouter Models API](https://openrouter.ai/api/v1/models)。这些数量会随官方目录变化，不应写死在产品里。

建议的目录语义约束是：

- 「特定免费模型」：Models API 中 `id` 以 `:free` 结尾的条目。
- 「自动选择免费模型」：单独标示为 `openrouter/free`，不得伪装成某个具体模型。
- 若产品目标是让使用者明确选择模型，默认不要加入 `openrouter/free`；若以后加入，UI 必须明确写成自动/随机路由。

### 3. 如何保证 UI A 模型与后端请求一致

**[Confirmed]** Chat Completions 请求应只发送使用者选择的一个精确模型 ID：

```json
{
  "model": "author/model:free",
  "messages": [
    { "role": "user", "content": "..." }
  ]
}
```

OpenRouter 的 `model` 是「要用于 completion 的模型」；响应正文也含 `model` 字段，报告实际使用的模型。来源：[Create a chat completion](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request?explorer=true)。

**[Confirmed]** 若要保证不会换成别的模型，后端不得在这条精确选择路径中使用：

- `models: [...]`：这是跨模型 fallback 数组；第一模型错误、限流、停机或被 moderation 拒绝时，OpenRouter 可尝试下一个模型。
- `openrouter/free`：会在当前免费模型池随机选择符合需求的模型。
- `openrouter/auto`：会根据 prompt 从一个会变化的模型池自动选择模型，而且被选模型可能收费。
- `~author/family-latest`：这是会随新版本发布而解析到不同具体模型的 latest alias。
- `@preset/...`：preset 可以在 OpenRouter 控制台中改变模型选择，代码里的显示名称不足以证明实际模型。

来源：[Model Fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks)、[Free Models Router](https://openrouter.ai/docs/guides/routing/routers/free-router)、[Auto Router](https://openrouter.ai/docs/guides/routing/routers/auto-router)、[Latest Model Resolution](https://openrouter.ai/docs/guides/routing/routers/latest-resolution)、[Presets](https://openrouter.ai/docs/guides/features/presets)。

**[Confirmed]** OpenRouter 默认可能在多个基础设施 provider endpoint 之间为同一个模型做负载均衡与 provider fallback。这是「同一模型由哪个 provider endpoint 服务」的变化，不等于切换成另一个模型。只有加入 `models` fallback、使用 router/alias/preset，或应用自身错误映射，才会让模型层级发生预期或非预期的变化。来源：[Provider Routing](https://openrouter.ai/docs/guides/routing/provider-selection)、[Model Fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks)。

**[Confirmed]** 审计实际路由时可以加：

```http
X-OpenRouter-Metadata: enabled
```

成功响应会出现 `openrouter_metadata`，其中 `requested` 是客户端送出的 model slug，`strategy` 会区分 `direct`、`free`、`auto`、`latest`、`alias`、`fallback` 等路由策略，并可提供实际尝试记录。来源：[Router Metadata](https://openrouter.ai/docs/guides/features/router-metadata)。

因此产品层应保持一条可验证的不变量：

```text
UI 显示名称
  -> 同一笔目录资料的 model.id
  -> 储存的 model.id
  -> Chat Completions request.model
  -> response.model / router metadata 验证
```

显示名称不能再被后端反向映射成另一个 ID；后端必须直接使用选择时保存的完整 `model.id`。若响应的 concrete model 与精确选择的 ID 不相容，应记录为路由一致性错误，不应继续把结果标成 UI 所选模型。

### 4. 免费模型与自动路由注意事项

**[Confirmed]** 免费模型具有较低 rate limits，且可用性会变化，尖峰时延迟可能更高。OpenRouter 官方把免费模型定位在学习、实验、原型与低流量用途，不适合要求稳定吞吐的生产负载。来源：[Free Models Router limitations](https://openrouter.ai/docs/guides/routing/routers/free-router)、[OpenRouter FAQ](https://openrouter.ai/docs/faq)。

**[Confirmed]** 官方当前说明：未购买至少 10 美元 credits 的帐号，免费模型总额度为每天 50 个请求；购买至少 10 美元 credits 后为每天 1000 个免费模型请求。这里是帐号层级的免费模型总额度，不是「每个免费模型各有一份」。此政策可能改变，错误讯息仍应以 OpenRouter 实际 HTTP 回应为准。来源：[OpenRouter FAQ — rate limits](https://openrouter.ai/docs/faq)。

**[Confirmed]** `openrouter/free`：

- 完全免费；
- 会先过滤能支持请求功能（如 vision、tools、structured output）的免费模型；
- 再从合格池随机选择；
- 响应的 `model` 会报告实际使用的具体免费模型；
- 不能保证使用者指定的某一个模型。

来源：[Free Models Router](https://openrouter.ai/docs/guides/routing/routers/free-router)。

**[Confirmed]** `openrouter/auto` 与 `openrouter/free` 不同。Auto Router 会挑选它认为适合 prompt 的模型，并按最终选中的模型收费；它不是「所有免费模型自动路由」。若产品承诺只开放免费模型，不应把 `openrouter/auto` 放进该免费模型清单。来源：[Auto Router](https://openrouter.ai/docs/guides/routing/routers/auto-router)。

## Evidence

1. **[Confirmed] OpenRouter Models API 是当前模型 ID 的权威目录。**
   Source: [Models API](https://openrouter.ai/docs/api/api-reference/models/get-models)
   Relevant location: `GET /api/v1/models`、Model Object 的 `id` 与 `pricing`。
   What it demonstrates: 应用可以实时取得完整 model ID 和元数据，避免硬编码过期清单。

2. **[Confirmed] `:free` 是针对特定模型的免费静态变体。**
   Source: [Free Variant](https://openrouter.ai/docs/guides/routing/model-variants/free)、[FAQ model variants](https://openrouter.ai/docs/faq)
   Relevant location: “Append `:free` to any model ID” 与 “Static variants ... listed in our models API”。
   What it demonstrates: 特定免费模型应保留并发送完整 `:free` ID。

3. **[Confirmed] `openrouter/free` 会随机改变实际模型。**
   Source: [Free Models Router](https://openrouter.ai/docs/guides/routing/routers/free-router)
   Relevant location: How It Works、Response、Limitations。
   What it demonstrates: 自动免费路由不能用于要求 UI 所选模型与后端实际模型一致的路径。

4. **[Confirmed] 单一 `model` 与 `models` fallback 是不同控制面。**
   Source: [Chat Completion API](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request?explorer=true)、[Model Fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks)
   Relevant location: request 的 `model` / `models` 字段与 fallback behavior。
   What it demonstrates: 精确选择路径只能发送一个完整 model ID，不能偷偷加备用模型数组。

5. **[Confirmed] 路由结果可被响应与 metadata 审计。**
   Source: [Router Metadata](https://openrouter.ai/docs/guides/features/router-metadata)
   Relevant location: `X-OpenRouter-Metadata: enabled`、`requested`、`strategy`、`attempts`。
   What it demonstrates: 可以建立自动测试，证明 UI ID、请求 ID 和实际路由一致。

6. **[Confirmed] 金钥可用服务器端端点验证。**
   Source: [Get current API key](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key)
   Relevant location: `GET /api/v1/key`、Bearer authentication、401 error。
   What it demonstrates: 不需要也不应该只靠前缀猜测金钥有效性。

## Contradictions or uncertainty

- **[Confirmed contradiction in candidate heuristics]** `pricing = 0` 表示单一计费项目免费，但不等同于 `:free` 静态聊天模型。当前官方 API 本身就会返回零价格但不带 `:free` 的条目；`openrouter/free` 也是零价格路由器。因此不能把「所有价格栏位为零」当作唯一模型类别。
- **[Confirmed drift]** 免费模型数量和可用性会频繁变化；本研究的 18 个 `:free` 条目只是 2026-08-31 的即时快照，不是产品常数。
- **[Likely]** 某些免费模型可能不支持应用依赖的结构化输出或其他参数。Models API 提供 `supported_parameters`，但不同 provider endpoint 对参数的支持仍可能不同；若功能依赖严格 JSON/structured output，实施阶段需要用实际请求和 provider routing 选项验证。
- **[Uncertain]** OpenRouter 没有在上述文件中承诺所有未来金钥永远维持 `sk-or-v1-` 前缀。因此前缀可以用于自动识别的强提示，但最终有效性必须由 `GET /api/v1/key` 判定。

## Implications

- OpenRouter 应是独立 Provider 身份，固定 Base URL 为 `https://openrouter.ai/api/v1`；金钥仍须按应用既有机密储存边界加密保存。
- 使用者贴上金钥后，先由 `GET /api/v1/key` 验证，再从 `GET /api/v1/models` 即时取得目录；不要在发行包中硬编码免费模型名单。
- 可选择清单以完整 `id` 结尾为 `:free` 的条目为核心，显示 `name`，但业务值必须始终是 `id`。
- 选择 A 后，储存与传输的都必须是 A 的完整 `id`；Chat Completions 只发单一 `model`，不加 `models` fallback，不用 router、latest alias 或 preset。
- 测试必须截获并断言实际 HTTP request 的 `model`，并以 response `model` 或 OpenRouter metadata 验证路由；这样才是真正证明「UI A 没有连接到 B」。
- `openrouter/free` 若未来提供，应作为明确写着「自动选择免费模型」的独立选项，不能放在某个具体模型名称下。`openrouter/auto` 不属于免费模型清单。
- 模型目录请求失败时，不应把旧清单伪装成实时清单；可以显示最后更新时间和重试状态。若采用短期缓存，应在金钥变更或打开模型选择器时重新验证/刷新。

## Recommended next investigation

实施前最高价值的下一步是只读追踪应用当前的 Provider → Model Registry → renderer selector → IPC → Chat Completions request 全链路，列出每一处目前用显示名称、provider/model 组合或自定义 Base URL 做映射的位置，并找出可加入 request/response model parity 回归测试的既有测试入口。
