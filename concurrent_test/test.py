import asyncio
import json
import base64
import binascii
import logging
import time
import uuid
import os
from pathlib import Path
from websockets.client import connect
from websockets.exceptions import ConnectionClosed

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('websocket.log', encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


class WeikeWebSocketClient:
    def __init__(self, url='ws://agent-zh-test.vkcto.com:32028/ws'):
        self.url = url
        self.ws = None
        self.session_id = None
        self.loop = None

    async def connect(self):
        """建立 WebSocket 连接"""
        try:
            logger.info(f"[REQUEST] 正在连接到 WebSocket: {self.url}")
            self.ws = await connect(self.url)
            logger.info("[RESPONSE] WebSocket 连接已建立")
        except Exception as e:
            logger.error(f"[ERROR] WebSocket 连接失败: {e}")
            raise

    async def create_session(self, config=None):
        """创建会话"""
        if config is None:
            config = {}
        
        self.session_id = self.generate_session_id()
        
        message = {
            "protocol_id": 100,  # ALL
            "command_id": 1,     # START
            "session_id": self.session_id,
            "payload": {
                "type": "session_config",
                "mode": config.get("mode", "vad_deferred"),
                "vad_threshold": config.get("vad_threshold", 0.5),
                "silence_duration_ms": config.get("silence_duration_ms", 1000),
                "min_speech_duration_ms": config.get("min_speech_duration_ms", 300),
                "system_prompt": config.get("system_prompt", "你是一个友好的AI助手"),
                "enable_search": config.get("enable_search", True),
                "voice_setting": {
                    "voice_id": "zh_female_wanwanxiaohe_moon_bigtts",
                    "speed": 1.0,
                    "pitch": 0.0,
                    "volume": 1.0
                },
                "audio_chunk_size_kb": 4,
                "initial_burst_count": 10,
                "initial_burst_delay_ms": 10,
                "send_rate_multiplier": 1.02,
                "asr_language": "zh",
                "timezone": "Asia/Shanghai",
                "location": "深圳",
                **{k: v for k, v in config.items() if k not in ["mode", "vad_threshold", "silence_duration_ms", 
                                                                  "min_speech_duration_ms", "system_prompt", "enable_search"]}
            }
        }
        
        message_str = json.dumps(message, ensure_ascii=False)
        logger.info(f"[REQUEST] 创建会话 - Session ID: {self.session_id}")
        logger.info(f"[REQUEST] 原始Payload: {message_str}")
        
        await self.ws.send(message_str)
        return self.session_id

    def generate_session_id(self):
        """生成会话ID"""
        return f'session_{int(time.time() * 1000)}_{uuid.uuid4().hex[:9]}'

    async def send_audio_chunk(self, audio_data_bytes):
        """直接发送二进制音频数据块"""
        if not self.session_id:
            raise Exception('会话未创建')
        
        preview_bytes = audio_data_bytes[:64]
        hex_preview = binascii.hexlify(preview_bytes).decode()
        b64_preview = base64.b64encode(preview_bytes).decode()
        logger.info(f"[REQUEST] 发送二进制音频块 - Session ID: {self.session_id}, 数据大小: {len(audio_data_bytes)} 字节")
        logger.info(f"[REQUEST] 音频HEX预览(前64字节): {hex_preview}")
        logger.info(f"[REQUEST] 音频Base64预览(前64字节): {b64_preview}")
        
        # 直接发送二进制数据
        await self.ws.send(audio_data_bytes)

    async def stream_audio_file(self, audio_file_path, chunk_size_kb=4):
        """流式发送音频文件（直接发送二进制）"""
        if not self.session_id:
            raise Exception('会话未创建')
        
        # 检查文件是否存在 - 使用绝对路径
        audio_path = Path(audio_file_path).resolve()
        if not audio_path.exists():
            logger.error(f"[ERROR] 音频文件不存在: {audio_file_path}")
            logger.error(f"[ERROR] 绝对路径: {audio_path}")
            logger.error(f"[ERROR] 当前工作目录: {os.getcwd()}")
            raise FileNotFoundError(f"音频文件不存在: {audio_file_path} (绝对路径: {audio_path})")
        
        logger.info(f"[REQUEST] 开始流式发送音频文件: {audio_file_path}")
        logger.info(f"[INFO] 文件绝对路径: {audio_path}")
        
        # 以二进制方式流式读取并发送音频
        try:
            file_size = audio_path.stat().st_size
            logger.info(f"[INFO] 音频文件大小: {file_size} 字节")
            
            chunk_size = chunk_size_kb * 1024
            total_chunks = (file_size + chunk_size - 1) // chunk_size
            
            with audio_path.open("rb") as audio_file:
                chunk_num = 0
                while True:
                    chunk = audio_file.read(chunk_size)
                    if not chunk:
                        break
                    chunk_num += 1
                    logger.info(f"[REQUEST] 流式发送二进制音频块 {chunk_num}/{total_chunks}, 大小: {len(chunk)} 字节")
                    await self.send_audio_chunk(chunk)
                    await asyncio.sleep(0.01)
            
            logger.info(f"[REQUEST] 音频文件发送完成，共发送 {chunk_num} 个块")
            
        except Exception as e:
            logger.error(f"[ERROR] 处理音频文件失败: {e}")
            import traceback
            logger.error(traceback.format_exc())
            raise

    async def send_text(self, text):
        """发送文本"""
        if not self.session_id:
            raise Exception('会话未创建')
        
        message = {
            "protocol_id": 100,  # ALL
            "command_id": 4,     # TEXT_DATA
            "session_id": self.session_id,
            "payload": {
                "type": "text_data",
                "text": text
            }
        }
        
        message_str = json.dumps(message, ensure_ascii=False)
        logger.info(f"[REQUEST] 发送文本: {text}")
        logger.info(f"[REQUEST] 原始Payload: {message_str}")
        
        await self.ws.send(message_str)

    async def stop_input(self):
        """停止输入"""
        if not self.session_id:
            return
        
        message = {
            "protocol_id": 100,  # ALL
            "command_id": 5,     # STOP_INPUT
            "session_id": self.session_id,
            "payload": {}
        }
        
        message_str = json.dumps(message, ensure_ascii=False)
        logger.info(f"[REQUEST] 停止输入 - Session ID: {self.session_id}")
        logger.info(f"[REQUEST] 原始Payload: {message_str}")
        
        await self.ws.send(message_str)

    async def stop_session(self):
        """停止会话"""
        if not self.session_id:
            return
        
        message = {
            "protocol_id": 100,  # ALL
            "command_id": 2,     # STOP
            "session_id": self.session_id,
            "payload": {}
        }
        
        message_str = json.dumps(message, ensure_ascii=False)
        logger.info(f"[REQUEST] 停止会话 - Session ID: {self.session_id}")
        logger.info(f"[REQUEST] 原始Payload: {message_str}")
        
        await self.ws.send(message_str)
        self.session_id = None

    async def handle_message(self, message):
        """处理接收到的消息"""
        try:
            if isinstance(message, (bytes, bytearray)):
                try:
                    raw_message = message.decode('utf-8', errors='replace')
                except Exception:
                    raw_message = str(message)
                hex_dump = binascii.hexlify(message).decode()
                b64_dump = base64.b64encode(message).decode()
                logger.info(f"[RESPONSE] 二进制消息长度: {len(message)}")
                logger.info(f"[RESPONSE] 二进制HEX: {hex_dump}")
                logger.info(f"[RESPONSE] 二进制Base64: {b64_dump}")
            else:
                raw_message = message
            
            logger.info(f"[RESPONSE] 原始消息: {raw_message}")
            
            if isinstance(message, str):
                data = json.loads(message)
            elif isinstance(message, (bytes, bytearray)):
                try:
                    data = json.loads(raw_message)
                except json.JSONDecodeError:
                    data = {}
            else:
                data = message if isinstance(message, dict) else {}
            
            logger.info(f"[RESPONSE] 收到消息类型: {data.get('type', 'unknown')}")
            logger.debug(f"[RESPONSE] 完整消息内容: {json.dumps(data, ensure_ascii=False, indent=2)}")
            
            msg_type = data.get('type', '')
            
            if msg_type == 'session.created':
                logger.info(f"[RESPONSE] 会话已创建: {data.get('session_id', 'N/A')}")
                
            elif msg_type == 'input_audio_buffer.speech_started':
                logger.info("[RESPONSE] 检测到语音开始")
                
            elif msg_type == 'input_audio_buffer.speech_stopped':
                logger.info("[RESPONSE] 检测到语音结束")
                
            elif msg_type == 'conversation.item.input_audio_transcription.delta':
                delta = data.get('delta', '')
                logger.info(f"[RESPONSE] ASR增量: {delta}")
                
            elif msg_type == 'conversation.item.input_audio_transcription.completed':
                transcript = data.get('transcript', '')
                logger.info(f"[RESPONSE] ASR完成: {transcript}")
                
            elif msg_type == 'response.text.delta':
                delta = data.get('delta', '')
                logger.info(f"[RESPONSE] LLM增量: {delta}")
                print(f"LLM输出: {delta}", end='', flush=True)
                
            elif msg_type == 'response.text.done':
                text = data.get('text', '')
                logger.info(f"[RESPONSE] LLM完成: {text}")
                print(f"\n[完整回复] {text}")
                
            elif msg_type == 'response.audio.delta':
                # 处理TTS音频数据
                audio_delta = data.get('delta', '')
                logger.info(f"[RESPONSE] TTS音频增量，数据大小: {len(audio_delta)} 字符")
                # 可以在这里保存或播放音频
                
            elif msg_type == 'response.done':
                logger.info("[RESPONSE] 响应完成")
                
            elif msg_type == 'error.event':
                error_msg = data.get('message', '未知错误')
                logger.error(f"[RESPONSE] 错误: {error_msg}")
                
            else:
                logger.info(f"[RESPONSE] 未知消息类型: {msg_type}")
                logger.debug(f"[RESPONSE] 消息内容: {json.dumps(data, ensure_ascii=False, indent=2)}")
                
        except Exception as e:
            logger.error(f"[ERROR] 处理消息失败: {e}")
            logger.error(f"[ERROR] 原始消息: {message}")

    async def listen_messages(self):
        """监听消息"""
        try:
            async for message in self.ws:
                await self.handle_message(message)
        except ConnectionClosed:
            logger.info("[INFO] WebSocket 连接已关闭")
        except Exception as e:
            logger.error(f"[ERROR] 监听消息时出错: {e}")

    async def disconnect(self):
        """断开连接"""
        if self.ws:
            logger.info("[REQUEST] 断开 WebSocket 连接")
            await self.ws.close()
            self.ws = None


async def main():
    """主函数"""
    client = WeikeWebSocketClient()
    
    try:
        # 连接 WebSocket
        await client.connect()
        
        # 创建会话
        session_id = await client.create_session({
            "mode": "vad",
            "system_prompt": "你是一个智能语音助手",
            "enable_search": True
        })
        
        logger.info(f"会话ID: {session_id}")
        
        # 启动消息监听任务
        listen_task = asyncio.create_task(client.listen_messages())
        
        # 等待一下让会话创建完成
        await asyncio.sleep(1)
        
        # 流式发送音频文件
        # 尝试多个可能的文件名，使用绝对路径
        audio_files = ["test.mp3", "你好你是谁.mp3"]
        audio_file = None
        current_dir = Path.cwd()
        logger.info(f"[INFO] 当前工作目录: {current_dir}")
        
        for af in audio_files:
            path = Path(af).resolve()
            logger.info(f"[INFO] 检查文件: {af} -> {path}")
            if path.exists():
                audio_file = path
                logger.info(f"[INFO] 找到音频文件: {audio_file}")
                break
        
        if audio_file and audio_file.exists():
            await client.stream_audio_file(str(audio_file))
            
            # 等待一段时间让服务器处理
            await asyncio.sleep(2)
            
            # 停止输入
            await client.stop_input()
        else:
            logger.error(f"音频文件不存在: {audio_file}")
        
        # 等待响应完成
        await asyncio.sleep(10)
        
        # 停止会话
        await client.stop_session()
        
        # 等待消息处理完成
        await asyncio.sleep(2)
        
        # 断开连接
        await client.disconnect()
        
        # 取消监听任务
        listen_task.cancel()
        try:
            await listen_task
        except asyncio.CancelledError:
            pass
            
    except Exception as e:
        logger.error(f"执行失败: {e}")
        import traceback
        logger.error(traceback.format_exc())
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())

