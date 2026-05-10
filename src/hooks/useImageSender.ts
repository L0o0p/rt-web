import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, MutableRefObject } from 'react';
import { ProtocolId } from '../sdk/protocol/ClientProtocol';
import type { RealTime } from '../RealTime';

interface PendingVisualQa {
  callId: string;
  question: string;
}

interface UseImageSenderOptions {
  realTimeRef: MutableRefObject<RealTime | undefined>;
}

const IMAGE_INPUT_ID = 'imageInput';
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const clearFileInput = () => {
  const fileInput = document.getElementById(IMAGE_INPUT_ID) as HTMLInputElement | null;
  if (fileInput) {
    fileInput.value = '';
  }
};

const getBlobExtension = (type: string): string => {
  switch (type) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'jpg';
  }
};

const downloadCapturedPhotoBestEffort = (blob: Blob) => {
  try {
    const filename = `photo-${Date.now()}.${getBlobExtension(blob.type)}`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch {
    // Best effort only. Some browsers block non-user-gesture downloads.
  }
};

export const useImageSender = ({ realTimeRef }: UseImageSenderOptions) => {
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isImageUploading, setIsImageUploading] = useState(false);
  const [imagePrompt, setImagePrompt] = useState<string>('');
  const pendingVisualQaRef = useRef<PendingVisualQa | null>(null);

  const resetImageSelection = useCallback(() => {
    setSelectedImage(null);
    setImagePreview(null);
    setImagePrompt('');
    clearFileInput();
  }, []);

  const handleImageSelect = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      alert('仅支持 JPEG、PNG、WebP 格式的图片');
      return;
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      alert('图片文件大小不能超过 5MB');
      return;
    }

    setSelectedImage(file);

    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      setImagePreview(readerEvent.target?.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  const sendImageBytes = useCallback((imageData: Uint8Array, prompt: string): boolean => {
    return realTimeRef.current?.sendImageData(imageData, prompt, ProtocolId.All) ?? false;
  }, [realTimeRef]);

  const assertSessionReady = useCallback((source: 'image' | 'camera') => {
    const voiceChatCore = realTimeRef.current?.getVoiceChatCore();
    if (!voiceChatCore?.isConnected) {
      if (source === 'camera') {
        console.error('[CAMERA] WebSocket未连接');
      }
      alert(source === 'camera' ? 'WebSocket未连接，无法发送照片' : 'WebSocket未连接，请等待连接建立后再发送图像');
      return null;
    }

    if (!voiceChatCore?.isSessionCreated) {
      if (source === 'camera') {
        console.error('[CAMERA] 会话未创建');
      }
      alert(source === 'camera' ? '会话未创建，无法发送照片' : '会话未创建，请先进行语音对话后再发送图像');
      return null;
    }

    return voiceChatCore;
  }, [realTimeRef]);

  const handleSendImage = useCallback(async () => {
    if (!selectedImage || isImageUploading) return;

    const voiceChatCore = assertSessionReady('image');
    if (!voiceChatCore) return;

    console.log('[IMAGE] 开始发送图像，会话ID:', voiceChatCore.currentSessionId);

    setIsImageUploading(true);
    try {
      const arrayBuffer = await selectedImage.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      console.log('[IMAGE] 图像数据准备完成，大小:', uint8Array.length, '字节');
      console.log('[IMAGE] 提示词:', imagePrompt || '(无提示词)');

      const result = sendImageBytes(uint8Array, imagePrompt);

      if (result) {
        console.log(`[IMAGE] 图像发送成功: ${selectedImage.name}, 大小: ${selectedImage.size} 字节`);
        console.log('[IMAGE] 等待服务器视觉分析响应...');
        resetImageSelection();
        alert('图像已成功发送，请等待AI分析结果');
      } else {
        console.error('[IMAGE] 图像发送失败 - sendImageData返回false');
        alert('图像发送失败，请检查连接状态和会话状态');
      }
    } catch (error) {
      console.error('[IMAGE] 图像发送失败:', error);
      alert(`图像发送失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsImageUploading(false);
    }
  }, [assertSessionReady, imagePrompt, isImageUploading, resetImageSelection, selectedImage, sendImageBytes]);

  const setPendingVisualQa = useCallback((pending: PendingVisualQa) => {
    pendingVisualQaRef.current = pending;
  }, []);

  useEffect(() => {
    const handlePhotoCaptured = async (event: Event) => {
      const blob = (event as CustomEvent).detail as Blob;
      if (!blob) {
        console.error('[CAMERA] 捕获的照片为空');
        return;
      }

      downloadCapturedPhotoBestEffort(blob);

      console.log('[CAMERA] 收到捕获的照片，大小:', blob.size, '字节');
      const pendingVisualQa = pendingVisualQaRef.current;
      const prompt = pendingVisualQa?.question ?? '';
      if (pendingVisualQa) {
        console.log('[Vision] 使用视觉问答问题作为 ImageData prompt:', {
          callId: pendingVisualQa.callId,
          question: pendingVisualQa.question,
        });
      }

      const voiceChatCore = assertSessionReady('camera');
      if (!voiceChatCore) {
        // Decision: a failed auto-capture must not leak the old visual-QA
        // prompt into a later manual photo.
        if (pendingVisualQa) {
          pendingVisualQaRef.current = null;
        }
        return;
      }

      console.log('[CAMERA] 连接状态正常，开始发送照片...');

      try {
        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        console.log('[CAMERA] 照片数据准备完成，大小:', uint8Array.length, '字节');

        const result = sendImageBytes(uint8Array, prompt);

        if (result) {
          console.log('[CAMERA] ✅ 照片发送成功，大小:', blob.size, '字节');
          if (pendingVisualQa) {
            console.log('[Vision] ✅ get_visual_QA 已转为 ImageData，等待 vision 管线返回文本/语音');
          }
          console.log('[CAMERA] 📡 等待服务端响应...');
        } else {
          console.error('[CAMERA] ❌ 照片发送失败');
          alert('照片发送失败，请检查连接状态');
        }
      } catch (error) {
        console.error('[CAMERA] ❌ 照片处理失败:', error);
        alert(`照片处理失败: ${error instanceof Error ? error.message : '未知错误'}`);
      } finally {
        if (pendingVisualQa) {
          pendingVisualQaRef.current = null;
        }
      }
    };

    window.addEventListener('photoCaptured', handlePhotoCaptured);

    return () => {
      window.removeEventListener('photoCaptured', handlePhotoCaptured);
    };
  }, [assertSessionReady, sendImageBytes]);

  return {
    handleCancelImage: resetImageSelection,
    handleImageSelect,
    handleSendImage,
    imagePreview,
    imagePrompt,
    isImageUploading,
    selectedImage,
    setImagePrompt,
    setPendingVisualQa,
  };
};
