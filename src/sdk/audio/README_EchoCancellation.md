# WebRTC 回声消除集成指南

本文档介绍如何使用 WebRTC 内置的回声消除机制来改善音频质量。

## 功能概述

WebRTC 提供了三种主要的音频处理功能：

1. **回声消除 (Echo Cancellation)** - 消除来自扬声器的回声
2. **噪声抑制 (Noise Suppression)** - 抑制背景噪声  
3. **自动增益控制 (Auto Gain Control)** - 自动调节音频增益

## 使用方法

### 基本用法

```typescript
import { AudioManager } from './sdk/audio/AudioManager';

const audioManager = new AudioManager();

// 启用回声消除
audioManager
  .setEchoCancellation(true)
  .setNoiseSuppression(true)
  .setAutoGainControl(true);

// 配置并启动
await audioManager
  .configure({
    enabled: true,
    threshold: 0.5
  })
  .start();
```

### 高级配置

```typescript
// 使用高级 WebRTC 配置
audioManager.configureWebRTCAudio({
  echoCancellation: { exact: true },    // 强制启用回声消除
  noiseSuppression: { exact: true },    // 强制启用噪声抑制
  autoGainControl: { exact: true },     // 强制启用自动增益控制
  enableAdvancedProcessing: true        // 使用高级音频约束
});

// 或者在初始配置中设置
audioManager.configure({
  enabled: true,
  threshold: 0.5,
  webrtc: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    enableAdvancedProcessing: false
  }
});
```

### 动态调整

```typescript
// 运行时动态调整设置
audioManager.setEchoCancellation(false);  // 禁用回声消除
audioManager.setNoiseSuppression(true);   // 启用噪声抑制

// 检查当前配置
const config = audioManager.getWebRTCConfig();
console.log('当前 WebRTC 配置:', config);
```

## 技术原理

### 回声消除工作原理

1. **参考信号捕获** - WebRTC 使用播放的音频作为参考信号
2. **自适应滤波** - 实时学习和建模音频环境的回声特性
3. **信号处理** - 从麦克风输入中减去预测的回声分量

### 约束配置

```typescript
// 默认推荐配置
export const RECOMMENDED_AUDIO_CONSTRAINTS = {
  sampleRate: 16000,
  channelCount: 1,
  echoCancellation: true,        // 启用回声消除
  noiseSuppression: true,        // 启用噪声抑制
  autoGainControl: true,         // 启用自动增益控制
};

// 高级配置 - 强制启用
export const ADVANCED_AUDIO_CONSTRAINTS = {
  sampleRate: 16000,
  channelCount: 1,
  echoCancellation: { exact: true },    // 强制启用
  noiseSuppression: { exact: true },    // 强制启用
  autoGainControl: { exact: true },     // 强制启用
};
```

## 验证回声消除是否生效

```typescript
// 创建音频流时会自动验证设置
const result = await createWebRTCAudioStream(deviceId, options);

// 检查实际应用的设置
const audioTrack = result.mediaStream.getAudioTracks()[0];
const settings = audioTrack.getSettings();

console.log('音频设置:', {
  echoCancellation: settings.echoCancellation,  // 应该是 true
  noiseSuppression: settings.noiseSuppression,  // 应该是 true
  autoGainControl: settings.autoGainControl,    // 应该是 true
});
```

## 注意事项

1. **浏览器兼容性** - 大部分现代浏览器都支持 WebRTC 音频处理
2. **硬件支持** - 某些设备可能不支持特定的音频处理功能
3. **性能影响** - 启用音频处理会增加 CPU 使用率，但通常是可接受的
4. **实时性** - WebRTC 的回声消除是实时的，延迟很低

## 最佳实践

1. **默认启用** - 对于大多数应用，建议默认启用所有音频处理功能
2. **用户控制** - 提供用户界面让用户可以调整这些设置
3. **环境适应** - 在不同的音频环境中测试效果
4. **备选方案** - 为不支持的设备提供降级方案

## 故障排除

如果回声消除不生效：

1. 检查浏览器控制台的音频设置日志
2. 确认设备支持回声消除功能
3. 尝试使用 `enableAdvancedProcessing: true`
4. 检查音频设备驱动程序更新

```typescript
// 调试信息
const config = audioManager.getWebRTCConfig();
console.log('WebRTC 配置:', config);

// 验证实际应用的约束
const stream = await navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: true }
});
const track = stream.getAudioTracks()[0];
console.log('实际设置:', track.getSettings());
```
