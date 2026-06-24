/**
 * 文件日志工具
 * 用于将二进制消息数据写入文件
 * 在浏览器环境中，使用 File System Access API 或提供下载功能
 */

export class FileLogger {
  private static instance: FileLogger | null = null;
  private logEntries: Array<{
    timestamp: string;
    data: string;
    hexData: string;
    size: number;
    commandId?: number;
    sessionId?: string;
  }> = [];
  private maxEntries: number = 10000; // 最大保存条目数
  private fileHandle: FileSystemFileHandle | null = null;
  private writableStream: FileSystemWritableFileStream | null = null;
  private useFileSystemAccess: boolean = false;

  private constructor() {
    // 检查是否支持 File System Access API
    if ('showSaveFilePicker' in window) {
      this.useFileSystemAccess = true;
    }
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): FileLogger {
    if (!FileLogger.instance) {
      FileLogger.instance = new FileLogger();
    }
    return FileLogger.instance;
  }

  /**
   * 初始化文件（使用 File System Access API）
   * 需要用户授权才能写入文件
   */
  public async initializeFile(filename: string = 'binary-messages.log'): Promise<boolean> {
    if (!this.useFileSystemAccess) {
      console.warn('[FileLogger] 浏览器不支持 File System Access API，将使用内存存储');
      return false;
    }

    try {
      // 请求文件写入权限
      // @ts-expect-error - File System Access API 可能不在类型定义中
      this.fileHandle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: 'Log files',
          accept: { 'text/plain': ['.log'] }
        }]
      });

      if (!this.fileHandle) {
        return false;
      }

      // 创建可写流
      this.writableStream = await this.fileHandle.createWritable();
      
      // 写入文件头
      await this.writableStream.write(`=== Binary Messages Log ===\n`);
      await this.writableStream.write(`Started at: ${new Date().toISOString()}\n`);
      await this.writableStream.write(`================================\n\n`);

      return true;
    } catch (error) {
      console.warn('[FileLogger] 文件初始化失败，将使用内存存储:', error);
      this.useFileSystemAccess = false;
      return false;
    }
  }

  /**
   * 写入日志条目
   */
  public async writeLog(data: Uint8Array, metadata?: {
    commandId?: number;
    sessionId?: string;
  }): Promise<void> {
    const timestamp = new Date().toISOString();
    const size = data.length;
    
    // 将二进制数据转换为十六进制字符串（便于查看）
    const hexString = Array.from(data)
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join(' ');

    // 也可以转换为 Base64（更紧凑）
    const base64String = btoa(String.fromCharCode(...data));

    const logEntry = {
      timestamp,
      data: base64String, // 使用 Base64 格式存储
      hexData: hexString, // 十六进制格式（用于调试）
      size,
      commandId: metadata?.commandId,
      sessionId: metadata?.sessionId
    };

    // 添加到内存数组
    this.logEntries.push(logEntry);

    // 如果超过最大条目数，移除最旧的
    if (this.logEntries.length > this.maxEntries) {
      this.logEntries.shift();
    }

    // 如果已初始化文件，直接写入
    if (this.writableStream) {
      try {
        const logLine = this.formatLogEntry(logEntry);
        await this.writableStream.write(logLine + '\n');
      } catch (error) {
        console.error('[FileLogger] 写入文件失败:', error);
        // 如果写入失败，关闭流并标记为不可用
        try {
          await this.writableStream.close();
        } catch (_closeError) {
          // 忽略关闭错误
        }
        this.writableStream = null;
        this.fileHandle = null;
      }
    }
  }

  /**
   * 格式化日志条目
   */
  private formatLogEntry(entry: {
    timestamp: string;
    data: string;
    hexData: string;
    size: number;
    commandId?: number;
    sessionId?: string;
  }): string {
    const parts = [
      `[${entry.timestamp}]`,
      `Size: ${entry.size} bytes`,
      entry.commandId !== undefined ? `CommandId: ${entry.commandId}` : '',
      entry.sessionId ? `SessionId: ${entry.sessionId}` : '',
      `Base64: ${entry.data}`,
      `Hex: ${entry.hexData.substring(0, 100)}${entry.hexData.length > 100 ? '...' : ''}`
    ].filter(Boolean);

    return parts.join(' | ');
  }

  /**
   * 下载所有日志（当不使用 File System Access API 时）
   */
  public downloadLogs(filename: string = 'binary-messages.log'): void {
    if (this.logEntries.length === 0) {
      console.warn('[FileLogger] 没有日志可下载');
      return;
    }

    // 构建日志内容
    let content = `=== Binary Messages Log ===\n`;
    content += `Generated at: ${new Date().toISOString()}\n`;
    content += `Total entries: ${this.logEntries.length}\n`;
    content += `================================\n\n`;

    for (const entry of this.logEntries) {
      content += this.formatLogEntry(entry) + '\n';
    }

    // 创建 Blob 并下载
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * 关闭文件流
   */
  public async closeFile(): Promise<void> {
    if (this.writableStream) {
      try {
        await this.writableStream.close();
        this.writableStream = null;
        this.fileHandle = null;
      } catch (_error) {
        console.error('[FileLogger] 关闭文件失败:', _error);
      }
    }
  }

  /**
   * 清空日志
   */
  public clearLogs(): void {
    this.logEntries = [];
  }

  /**
   * 获取日志统计信息
   */
  public getStats(): {
    totalEntries: number;
    totalSize: number;
    averageSize: number;
  } {
    const totalSize = this.logEntries.reduce((sum, entry) => sum + entry.size, 0);
    return {
      totalEntries: this.logEntries.length,
      totalSize,
      averageSize: this.logEntries.length > 0 ? totalSize / this.logEntries.length : 0
    };
  }

  /**
   * 获取所有日志条目
   */
  public getLogs(): typeof this.logEntries {
    return [...this.logEntries];
  }
}

