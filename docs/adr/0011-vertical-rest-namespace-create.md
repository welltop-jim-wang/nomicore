# ADR 0011：纵向 REST namespace create 与内容寻址 schema ID

日期：2026-08-28
状态：提议

## 背景

ADR 0008—0009 已建立单 namespace Runtime、唯一 write sequencer、NamespaceRegistry 与短请求 Lease 生命周期。未来 Nomicore server 同时承载业务 REST 和 WebSocket replication；两种入口必须共享同一个 Registry，才能保持同一 namespace 在进程内只有一个 Runtime 与一个 write sequencer。

首个 REST 纵向切片是创建 namespace。调用方需要提交 VFSL schema 和完整 logical ROOT，由服务端创建持久化 namespace 并返回 Registry 生成的 namespaceId。当前尚无可部署 server、authentication 或 authorization；本切片用于受信开发环境，并建立以后由 server 装配的标准 Web Request/Response seam。

现有 SCHEMA 信封要求 `lang/version/id/text`。调用方不应手工产生内容身份；schema ID 应从 VFSL semantic fingerprint 确定性派生，同时保留调用方原始 schema text。普通 create 的 namespaceId 继续由 Registry 的受控 CSPRNG 生成。

## 决策

### 模块与装配

建立 `@nomicore/namespace-api`，REST Adapter 由 `@nomicore/namespace-api/rest` 暴露。首版只公开 REST router；create 编排保持包内私有，待出现第二个真实 Adapter 后再决定是否形成公共 seam。

REST router 是 Host 无关的普通 Module，不是 Cordis plugin。composition root 构造 REST 与 WebSocket Module时注入并共享同一个 `NamespaceRegistry` 引用。核心 Module 不读取 Cordis Context，不按请求或消息重新查找 Registry，也不在运行时静默替换 Registry。

router 构造时注入：

- 静态实例 role：`hub | peer`；
- `NamespaceRegistry`；
- metrics-safe observer；
- 敏感 diagnostic observer；
- 可选资源 limits。

配置在构造时读取、校验、复制并冻结；首版不支持动态更新，变更配置需重建 router。构造配置错误使用普通 `TypeError`，不承诺稳定错误文案。

router 使用标准 Web `Request → Response` 接口，并以判别结果表达 route 是否匹配。server 先按 raw path 选择 REST 与 WebSocket route family；REST router 不拥有 listener、authentication、authorization、CORS、TLS、Request ID、全局并发或 graceful drain。

### 受信环境与角色

首版不实现 authentication 或 owner authorization。调用方可选择任何符合安全文法的 owner，因此 route 只能直接暴露在 localhost 或明确受信网络，不构成公网安全接口。正式生产暴露前必须由 server 增加 authentication 与 owner authorization。

只有 Hub 可创建 namespace。Peer 保持相同 route 形状，但在匹配 method/raw path 后、解析 owner或读取body前返回：

- HTTP 403；
- 稳定 code `INSTANCE_ROLE_FORBIDDEN`。

创建成功的 namespace 默认 `replication-disabled`；后续是否启用复制必须由 Hub 通过独立管理操作显式决定。

### HTTP 契约

endpoint：

```http
POST /v1/owners/{ownerUserId}/namespaces
Content-Type: application/json
```

请求 body 恰含：

```json
{
  "schemaText": "type ROOT = { title: string };",
  "root": { "title": "hello" }
}
```

约束：

- route 大小写敏感，只接受无尾随斜杠的 canonical path；
- owner 使用 Registry 既有安全文法，path 中不允许 percent-encoding；
- 首版不接受 query 参数；
- 已知 path 的非 POST 方法返回 405，并携带 `Allow: POST`；
- CORS/OPTIONS 可由外层 server/gateway 截获，否则按方法不匹配处理；
- 缺失或不兼容 Content-Type 返回 415；接受 `application/json` 与仅带 `charset=utf-8` 的形式；
- Content-Encoding 只接受缺失或 `identity`；
- `root` 必须显式提交，不提供默认值；
- 顶层必须是非数组 object，解析后恰有 `schemaText` 与 `root` 两个 own keys；
- `schemaText` 必须是 string；空字符串交给 VFSL 领域校验；
- `root` 的领域合法性由 Registry/VFSL 校验，REST 不预设其具体形状。

成功返回 HTTP 201：

```json
{
  "namespaceId": "ns-0123456789abcdef0123456789abcdef",
  "schema": {
    "lang": "vfsl",
    "version": 1,
    "id": "sc1-..."
  }
}
```

v1 成功 response 恰含这些字段。201 表示 Persistence create 已提交、namespaceId 可用于后续 open；不表示 Runtime P0 已 ready，也不表示复制已启用。首版尚无对应 GET resource，因此不返回 `Location`。

### JSON 处理与资源限制

首版不实现独立 JSON parser，也不引入 SAX/token parser。REST endpoint：

1. 有界收集 body bytes；
2. 以严格 UTF-8 解码；
3. 使用平台标准 JSON 解析；
4. 执行顶层形状与解析后资源检查。

重复 JSON key 遵循平台 last-key-wins 语义，不形成额外协议保证。malformed JSON只返回通用错误，不返回源码位置。JSON parse 产生本请求独占数据，REST不再深拷贝；Registry仍执行自身的输入快照与安全门禁。

默认 limits：

- body：4 MiB；
- schemaText：256 KiB，以UTF-8 bytes计算；
- JSON depth：64；
- JSON nodes：100,000；
- issues：100条；
- 单条 issue message：1,024 UTF-8 bytes；
- issues总预算：64 KiB。

Host可用Partial配置覆盖，未知键和越界值在构造时TypeError。`maxSchemaTextBytes`不得大于`maxBodyBytes`。输入规模超限返回413；body读取使用Content-Length仅作提前拒绝优化，实际stream始终执行byte上限。body读取阶段尊重`Request.signal`，中断后Registry零触达；调用Registry后不传播客户端取消，必须等待create settle并release Lease。

解析后以迭代方式检查depth、nodes和不安全整数，避免递归栈溢出。REST不为`-0`建立额外语义。

### 内容寻址 schema ID

新增 `@nomicore/vfsl` 的窄 Module interface，用于从以下输入派生schema身份：

- `lang = vfsl`；
- `version = 1`；
- VFSL text。

该接口不接收 provisional envelope ID，不暴露IR、派生schema或validator。它复用现有VFSL编译pipeline，返回semantic fingerprint和schema ID，或VFSL issues。它不是REST endpoint。

schema ID格式冻结为：

```text
sc1-<52位小写 RFC 4648 Base32>
```

其中payload是semantic fingerprint的完整256-bit SHA-256 digest：不截断、无`=`padding。`sc1-`表示schema ID格式版本。它与`sha256:v1:<64 lowercase hex>`携带相同digest信息。

因此：

- 空白与普通注释不改变schema ID；
- JSDoc、声明顺序及其他VFSL语义变化会改变schema ID；
- 持久化的`SCHEMA.text`保留调用方原文，不格式化；
- schema ID是schema语义内容身份，不承担额外业务谱系或名称职责；业务含义通过VFSL JSDoc表达。

REST先派生身份、组装完整SCHEMA envelope，再调用现有Registry create。Registry仍按现有安全入口重新编译并校验ROOT；首版有意接受两次编译，不引入prepared-schema seam。

旧式SCHEMA id继续兼容。本决策只要求新REST create生成`sc1-`。但任何输入envelope一旦使用`sc1-`前缀，VFSL完整envelope编译必须验证canonical格式及其与text semantic fingerprint的精确匹配；格式错误和语义不匹配使用两个稳定VFSL issue code，具体编号由实施时按错误注册表分配。

### 执行顺序与Lease

Hub请求的固定顺序：

1. raw route与method匹配；
2. role gate；
3. owner、query、Content-Type/Encoding检查；
4. 有界读取与标准JSON解析；
5. 顶层形状和解析后资源检查；
6. 派生schema identity；
7. 调用`Registry.create({ owner, schema, root })`；
8. 成功后立即复制namespaceId与schema identity为owned plain DTO；
9. 恰一次调用并等待`lease.release()`；
10. 返回Response。

release失败不改变已知创建事实：仍返回201，通过diagnostic observer报告已验证owner、namespaceId与exact cause，不重复调用release。Registry shutdown最终按自身契约关闭Runtime。

### 错误契约

客户端只按稳定`code`分支；message供人阅读，不保证逐字稳定。错误response使用固定problem shape，validation issues映射为受控、可JSON序列化的REST issue：稳定code、可选`line/column`或`(string | number)[]` path，以及有UTF-8 byte上限的安全message；不返回schema/root片段。数量或总byte预算截断时显式`issuesTruncated: true`。

主要映射：

- 400：非法owner、query、空body、malformed JSON、请求形状、数字范围；
- 403：Peer role禁止create；
- 405：已知path的方法错误；
- 413：body/schema/JSON结构超限；
- 415：Content-Type或Content-Encoding不支持；
- 422：VFSL schema invalid或ROOT invalid；
- 503：`REGISTRY_NOT_ACCEPTING`，明确零提交，可稍后重新请求；
- 500 `NAMESPACE_CREATE_FAILED`：typed operational failure，code语义保证`committed:false`；
- 500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN`：Registry fatal且`committed:true`，不得自动重试；
- 500 `INTERNAL_ERROR`：unknown exception或内部契约违例。

普通REST create不应返回`NAMESPACE_ALREADY_EXISTS`，因为namespaceId由Registry生成并内部处理碰撞。REST自行构造合法Registry输入，因此`NAMESPACE_CREATE_INVALID_INPUT`和`NAMESPACE_ALREADY_EXISTS`均视为内部契约违例，返回安全500并上报diagnostic observer。

首版不支持Idempotency-Key、recoveryId或持久恢复catalog。网络超时与outcome unknown不能安全自动重试；这是受信开发切片的明确限制。明确零提交的4xx、`REGISTRY_NOT_ACCEPTING`与`NAMESPACE_CREATE_FAILED`可由调用方修正或重新发起，但通用代理不得盲目重放create。

### Observability

构造时必须显式注入两个同步void observer；传no-op也必须是显式决定。observer throw一律隔离，不改变HTTP结果。

metrics-safe observer只有统一低基数事件：operation、`succeeded | rejected | unavailable | failed | aborted` outcome、稳定code与可选HTTP status；不携带owner、namespaceId、issues、schema/root或cause。

diagnostic observer只接收三类事件：Registry fatal、unknown exception、Lease release failure。它可携带已验证owner、错误本身已知的namespaceId、Registry operation/phase/committed与exact cause，但不得携带schema/root或完整validation issues。Host必须把该Adapter视为敏感运维接口并负责访问控制、采样和脱敏。

## 测试决策

最高测试seam是标准Web`Request → Response`的REST router。相同create契约在MemoryPersistence和FilePersistence上运行，断言HTTP结果、持久化事实、Lease释放与Registry后续open，不读取Registry内部entry map、Runtime或Y.Doc私有对象。

VFSL包级契约测试覆盖semantic fingerprint与`sc1-`一一重编码、空白/普通注释稳定、JSDoc变化、canonical Base32、旧ID兼容，以及`sc1-`格式错误/语义不匹配。

REST测试覆盖：

- Hub成功创建与Peer role拒绝；
- route/method/owner/query/media/body错误顺序；
- body/schema/depth/node/issues limits；
- schema invalid与ROOT invalid的稳定安全映射；
- Registry not accepting、operational failure、fatal committed二分；
- success DTO在release前复制，release恰一次，release失败仍201；
- body读取中断时Registry零触达；Registry接纳后客户端中断不取消create；
- observer事件低基数与敏感字段隔离，observer throw不改变结果；
-并发请求不在router全局串行，由Registry维持namespace生命周期不变量。

server集成验收验证REST与WebSocket Module确实共享同一个Registry引用，并按顺序停止intake、等待已接纳REST/WS工作、释放Lease/Session，再shutdown Registry与Persistence。

## 后果

- REST与WebSocket共享Registry安全不变量，但保持短请求和长连接不同Lease生命周期。
- schema ID是完整semantic digest的较短canonical表示，避免调用方手工命名内容身份。
-首版重复编译schema，换取Registry安全入口不扩张。
-标准JSON解析和受信部署保持首个切片可控；更严格的duplicate-key/token-level parser留给正式公网安全评审。
-首版没有authentication、authorization、idempotency或outcome recovery，不得误称production-ready公网create。

## 非目标

- authentication、owner authorization、TLS或公网部署；
- Idempotency-Key、recoveryId、异步job或namespace discovery/list；
- ROOT读取/修改、SCHEMA replacement、replication管理或server管理REST；
- Peer创建、publish/adopt或REST bootstrap；
-独立JSON parser、重复key拒绝、源码excerpt；
-HTTP listener、Cordis router plugin、CORS或graceful drain实现；
-prepared-schema seam或消除两次VFSL编译。

## 取代与关联

本ADR不取代ADR 0008、0009或0010。它在Registry/Lease seam上定义首个业务REST纵向切片。server的REST route依赖本Module；WebSocket Module不依赖REST create，而是直接使用Registry/Lease/ReplicationSession。二者由composition root共享同一个Registry引用与server lifecycle。