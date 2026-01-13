# Reminder 工具执行链路分析

## 1. 概述

本文档分析 memories-app-migrate iOS 应用中 reminder 工具的完整执行链路。该工具基于 MCP（Model Context Protocol）模式实现，通过 AI 大模型识别用户意图并执行相应的日程提醒操作。整体链路涵盖从用户语音输入到设备日程同步的完整闭环流程。

## 2. 注册入口

在 iOS 应用的入口文件 [`memories-app-migrate/ios/Runner/AppDelegate.swift`](memories-app-migrate/ios/Runner/AppDelegate.swift:32) 中，reminder 工具通过 MCP 框架进行注册：

```swift
// AppDelegate.swift:32
register.register(WKLargeModelMCPReminderAction(deviceModel: device))
```

注册的核心实现位于 [`memories-app-migrate/ios/Runner/AiLargeModel/MCPAction/WKLargeModelMCPReminderAction.swift`](memories-app-migrate/ios/Runner/AiLargeModel/MCPAction/WKLargeModelMCPReminderAction.swift)，该文件实现了 MCP 协议规定的四个核心方法：`select`、`set`、`update` 和 `delete`。

## 3. AI 识别的特殊信令

当用户通过语音或文本输入与 AI 交互时，AI 模型会识别出需要调用 reminder 工具的场景，并返回特殊的 `function_call` 信令。这种信令格式遵循 OpenAI 的 Function Calling 规范，但在 MCP 框架中进行了扩展以支持更复杂的参数传递。

### 信令类型定义

AI 返回的 MCP function call 信令数据结构定义在 [`WKLargeModelMCPModel.swift:40-59`](memories-app-migrate/ios/IwBluetooth/Classes/IwLargeModel/LargeModel/WKLargeModelMCPModel.swift:40)：

```swift
public struct WKLargeModelMCPReminderModel: Codable {
    public var content: String?           // 提醒内容
    public var reminderType: WKLargeModelMCPReminderType?  // 操作类型
    public var startAt: String?           // 查询开始时间 (yyyy-MM-dd HH:mm:ss)
    public var endAt: String?             // 查询结束时间
    public var occurAt: String?           // 设置/修改时间
}

public enum WKLargeModelMCPReminderType: String, Codable {
    case select   = "select"   // 查询日程
    case set      = "set"      // 设置提醒
    case delete   = "delete"   // 删除提醒
    case update   = "update"   // 修改提醒
}
```

### 关键字段说明

`arguments` 对象中包含以下核心字段：

- **reminderType**: 操作类型（`select`/`set`/`update`/`delete`）
- **content**: 提醒内容
- **occurAt**: 设置/修改时间（格式：`yyyy-MM-dd HH:mm:ss`）
- **startAt/endAt**: 查询日期范围（仅 select 操作使用）

### 完整 JSON 示例

**设置提醒 (set)**:
```json
{
  "function": "reminder",
  "arguments": {
    "content": "下午3点开会",
    "reminderType": "set",
    "occurAt": "2025-01-15 15:00:00"
  }
}
```

**查询日程 (select)**:
```json
{
  "function": "reminder",
  "arguments": {
    "reminderType": "select",
    "startAt": "2025-01-15 00:00:00",
    "endAt": "2025-01-15 23:59:59"
  }
}
```

**删除提醒 (delete)**:
```json
{
  "function": "reminder",
  "arguments": {
    "reminderType": "delete",
    "startAt": "2025-01-15 15:00:00",
    "endAt": "2025-01-15 15:00:00"
  }
}
```

**注意**：当用户说"一分钟后"时，AI 会自动计算并填充具体的绝对时间 `occurAt: "2025-01-15 15:00:00"`，而不是保留相对时间。

## 4. 支持的操作类型

reminder 工具支持四种核心操作类型，每种操作对应不同的业务场景：

| 操作类型 | 方法名 | 说明 |
|----------|--------|------|
| **select** | `select(params:)` | 查询现有日程提醒，支持按日期范围、关键词等条件筛选 |
| **set** | `set(params:)` | 创建新的日程提醒，设置标题、时间、重复规则等 |
| **update** | `update(params:)` | 修改已存在的日程提醒，可更新任意字段 |
| **delete** | `delete(params:)` | 删除指定的日程提醒，支持批量删除 |

## 5. 完整执行流程

以下流程图展示从用户语音输入到闭环的完整链路：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           用户交互层                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  用户通过语音或文本输入需求                                            │    │
│  │  例如："一分钟后提醒我"                                               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  VoiceInputManager / TextInputManager                                │    │
│  │  收集用户输入并转换为文本                                              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                           AI 处理层                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  WKLargeModelManager                                                 │    │
│  │  将用户输入发送给 AI 大模型                                           │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  AI 模型意图识别                                                      │    │
│  │  识别出需要调用 reminder 工具                                         │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  返回 function_call 信令                                             │    │
│  │  包含 call_id、response_id、item_id 和完整参数                       │    │
│  │  AI 自动计算绝对时间 startAt                                         │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                           MCP 执行层                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  WKLargeModelMCPReminderAction                                       │    │
│  │  根据 action 类型分发到对应方法                                       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  ReminderManager / BLE Protocol                                      │    │
│  │  通过 BLE 协议与设备通信，创建日程                                    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                           设备响应层                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  BLE 设备响应                                                         │    │
│  │  返回 scheduleId 和状态码                                             │    │
│  │  格式: {length = 15, bytes = 0xea000c003601010000000000000006}       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                           闭环处理层                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  App 发送 tool result 到 WSS                                         │    │
│  │  消息类型: conversation.item.create (function_call_output)           │    │
│  │  包含 call_id、control.mode、output、payload.tts_text               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  TTS 音频获取                                                         │    │
│  │  通过 SSE 流式获取 TTS 音频                                          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  TTS 音频传输                                                         │    │
│  │  通过 BLE File 传输协议发送到设备                                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  LLM 最终响应                                                         │    │
│  │  返回 response.text.done 和自然语言回复                              │    │
│  │  例如："好的，已为你设置2026年1月11日 15:53:34提醒"                   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 6. App 闭环机制

### 6.1 Tool Result 回传机制

当 MCP 执行层完成日程创建后，App 需要将执行结果回传给 AI 模型。这一过程通过 WSS（WebSocket Secure）协议完成，发送 `conversation.item.create` 消息，类型为 `function_call_output`。

```json
{
  "protocol_id": 100,
  "command_id": 100,
  "content": {
    "conversation": {
      "item": {
        "create": {
          "call_id": "agent_reminder_QlvUST",
          "type": "function_call_output",
          "control": {
            "mode": "tts"
          },
          "output": "{\"scheduleId\":6,\"status\":1}",
          "payload": {
            "tts_text": "好的，已为你设置2026年1月11日 15:53:34提醒"
          }
        }
      }
    }
  }
}
```

关键字段说明：

| 字段名 | 说明 |
|--------|------|
| protocol_id | 协议标识符（100 表示 MCP 协议） |
| command_id | 命令标识符（100 表示创建消息） |
| call_id | 与 AI 返回的 function_call 对应的调用 ID |
| type | 消息类型，固定为 `function_call_output` |
| control.mode | 控制模式，`tts` 表示需要语音播报 |
| output | 设备返回的执行结果 JSON |
| payload.tts_text | TTS 播报的文本内容 |

### 6.2 设备响应格式

BLE 设备在收到日程创建指令后，会返回响应数据。响应格式为二进制数据，包含日程 ID 和状态码。

**BLE 响应原始数据**：
```
{length = 15, bytes = 0xea000c003601010000000000000006}
```

**响应字段解析**：

| 字节位置 | 长度 | 字段 | 说明 |
|----------|------|------|------|
| 0-1 | 2 | 0xea00 | 响应头标识 |
| 2-3 | 2 | 0x0c00 | 数据长度（12 字节） |
| 4-5 | 2 | 0x3601 | 命令码（0x0136 表示创建日程响应） |
| 6-9 | 4 | 0x01000000 | 状态码（1 = 成功） |
| 10-13 | 4 | 0x00000006 | scheduleId（6 = 新创建的日程 ID） |

**解析后的 JSON**：
```json
{
  "scheduleId": 6,
  "status": 1
}
```

### 6.3 TTS 播放机制

TTS（Text-to-Speech）模块负责将 AI 的文字回复转换为语音播报。TTS 播放采用以下流程：

1. **SSE 流式获取**：TTS 音频通过 SSE（Server-Sent Events）流式传输协议获取
2. **BLE File 传输**：TTS 音频数据通过 BLE File 传输协议发送到设备
3. **设备端播放**：设备端接收音频数据并播放

```swift
// TTS 播放的关键代码片段
class TTSManager {
    func fetchTTSStream(_ text: String) {
        // 通过 SSE 流式获取 TTS 音频
        let url = "https://api.example.com/tts/stream"
        let params = ["text": text, "voice": "zh-CN"]
        
        // 使用 SSE 客户端接收音频流
        let eventSource = EventSource(url: url, params: params)
        eventSource.onMessage = { [weak self] data in
            self?.sendToDeviceViaBLE(data)
        }
    }
    
    func sendToDeviceViaBLE(_ audioData: Data) {
        // 通过 BLE File 协议传输音频到设备
        BLEManager.shared.sendFile(audioData, type: .tts)
    }
}
```

### 6.4 LLM 最终响应

当 AI 模型收到 App 发送的 tool result 后，会根据执行结果生成最终的自然语言回复。

**LLM 响应**：
```json
{
  "response": {
    "text": {
      "done": true
    }
  },
  "content": [
    {
      "type": "text",
      "text": "好的，已为你设置2026年1月11日 15:53:34提醒"
    }
  ]
}
```

最终回复内容会根据执行结果动态生成：
- 成功时：`"好的，已为你设置2026年1月11日 15:53:34提醒"`
- 失败时：`"抱歉，设置提醒失败了，请重试"`

### 6.5 关键代码片段

以下是 MCP 执行层与业务层交互的核心代码：

```swift
// WKLargeModelMCPReminderAction.swift:104-126
func handle(arg: WKLargeModelRespondFunctionCallPayload?, ...) {
    guard let arguments = arg?.arguments,
          let jsonData = arguments.data(using: .utf8),
          let reminderModel = try? JSONDecoder().decode(WKLargeModelMCPReminderModel.self, from: jsonData),
          let type = reminderModel.reminderType else {
        failure(nil)
        return
    }
    
    prepare(.pause)
    
    remindHandle(type: type, reminder: reminderModel) { [weak self] message in
        peripheral.apps.largeModelApp.deviceControl(
            type: .schedule,
            canContinue: WKLargeMCPFunctionConfig.canFunctionContinue(type: .schedule)
        )
        self?.sendToolCallTTS(message.message ?? "")
        finished(.waitTTSAndStop)
    }
}

// 发送 functionCallBack 给 AI - WKLargeModelMCPToolCall.swift:20-42
static func sendTTSToolcall(msg: String, callId: String, sessionId: String) {
    let outputPayload: WKLargeModelFunctionCallOutputPayload = .init(
        item: .init(
            call_id: callId,
            output: "{\"result\":\"\(msg)\"}",
            control: .init(mode: .tts),
            payload: .init(tts_text: msg)
        )
    )
    
    let sendModel: WKLargeModelSendModel = .init(
        protocol_id: .all,
        command_id: .result,
        session_id: sessionId,
        payload: .functionCallBack(outputPayload)
    )
    
    WKDeviceLargeModelManager.shared.largeModel.send(model: sendModel)
}
```

## 7. 关键文件索引

以下是与 reminder 工具相关的核心文件路径：

| 功能模块 | 文件路径 | 说明 |
|----------|----------|------|
| 注册入口 | [`memories-app-migrate/ios/Runner/AppDelegate.swift`](memories-app-migrate/ios/Runner/AppDelegate.swift:32) | 应用入口，MCP handler 注册 |
| Reminder Action | [`memories-app-migrate/ios/Runner/AiLargeModel/MCPAction/WKLargeModelMCPReminderAction.swift`](memories-app-migrate/ios/Runner/AiLargeModel/MCPAction/WKLargeModelMCPReminderAction.swift) | Reminder 工具核心实现 |
| 数据模型 | [`memories-app-migrate/ios/IwBluetooth/Classes/IwLargeModel/LargeModel/WKLargeModelMCPModel.swift`](memories-app-migrate/ios/IwBluetooth/Classes/IwLargeModel/LargeModel/WKLargeModelMCPModel.swift:40) | MCP 信令数据结构定义 |
| 日程管理 | [`memories-app-migrate/ios/IwBluetooth/Classes/IwDaliySchedule/WKScheduleDeviceManager.swift`](memories-app-migrate/ios/IwBluetooth/Classes/IwDaliySchedule/WKScheduleDeviceManager.swift) | 设备日程 CRUD 操作 |
| TTS 工具 | [`memories-app-migrate/ios/Runner/AiLargeModel/MCPAction/WKLargeModelMCPToolCall.swift`](memories-app-migrate/ios/Runner/AiLargeModel/MCPAction/WKLargeModelMCPToolCall.swift) | 发送 functionCallBack 给 AI |

## 8. 与 Take_Photo 的对比

Reminder 和 Take_Photo 是两种不同类型的 MCP 工具，它们在执行链路和复杂度上有显著差异：

| 特性 | Reminder | Take_Photo |
|------|----------|------------|
| **MCP Function** | `reminder` | `take_photo` |
| **Arguments** | 复杂结构 (content, type, time) | 空或简单结构 |
| **处理复杂度** | 高 (4种操作类型) | 低 (单一拍照指令) |
| **设备交互** | BLE Schedule + TTS 文件上传 | BLE 拍照指令 |
| **本地存储** | 需要 (SQLite DB) | 不需要 |
| **TTS 反馈** | 需要 (生成提醒语音) | 不需要 |
| **返回模式** | `.waitTTSAndStop` | `.stop` |

### Take_Photo 简化处理

```swift
// WKLargeModelMCPTakePhotoAction.swift:26-50
func handle(arg: WKLargeModelRespondFunctionCallPayload?, ...) {
    guard let peripheral = kBLE.devicePeripheral(deviceModel.mac) as? WKPeripheral else {
        failure(nil)
        return
    }
    
    // 直接下发拍照指令，结束当前轮
    prepare(.stop)
    peripheral.apps.largeModelApp.deviceControl(
        type: .takePhoto,
        canContinue: WKLargeMCPFunctionConfig.canFunctionContinue(type: .takePhoto)
    )
    
    // 简单回包
    sendAckToLLM(callId: arg?.call_id, sessionId: sessionId)
    finished(.stop)
}
```

### Reminder 特殊处理逻辑

1. **时间格式处理**：AI 返回时间格式为 `yyyy-MM-dd HH:mm:ss`，使用 `DateFormatter` 转换
2. **数量限制**：每台设备最多 10 个日程 (`WKLargeModelMCPReminderTool.maxScheduleNum`)
3. **过去时间校验**：不允许设置过去时间的提醒
4. **TTS 语音上传**：提醒时间到达时，设备会播放 TTS 生成的语音
5. **本地通知**：使用 `WKLocalNotification` 在手机端显示本地通知

## 9. 总结

memories-app-migrate iOS 应用中的 reminder 工具采用 MCP 模式实现了一套完整的日程提醒执行链路。该链路的核心特点包括：

1. **标准化接口**：通过 select/set/update/delete 四个标准方法覆盖所有日程操作场景
2. **AI 驱动**：利用大模型的意图识别能力，自动将用户自然语言转换为结构化操作
3. **智能时间计算**：AI 自动将相对时间（如"一分钟后"）转换为绝对时间
4. **闭环反馈**：通过 WSS 协议回传执行结果、SSE 流式获取 TTS、BLE 传输音频的完整闭环
5. **设备通信**：通过 BLE 协议与硬件设备进行日程同步和数据传输
6. **本地存储**：通过 SQLite DB 存储日程数据，支持 CRUD 操作

这种 MCP 模式的设计使得 reminder 工具具有良好的扩展性，未来可以方便地添加新的操作类型或集成更多外部服务。同时，统一的信令格式和清晰的执行流程也便于维护和调试。