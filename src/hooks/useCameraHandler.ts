import { useCallback, useRef, useState } from 'react';

interface CameraHandler {
    isCameraOpen: boolean;
    isCapturing: boolean;
    error: string | null;
    openCamera: () => Promise<void>;
    closeCamera: () => void;
    capturePhoto: () => Promise<Blob | null>;
    switchCamera: () => void;
}

export const useCameraHandler = (): CameraHandler => {
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const facingModeRef = useRef<'user' | 'environment'>('environment');

    const openCamera = useCallback(async () => {
        setError(null);

        try {
            // 停止之前的流
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }

            // 请求摄像头权限
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: facingModeRef.current,
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: false
            });

            streamRef.current = stream;

            // 创建 video 元素
            const video = document.createElement('video');
            video.srcObject = stream;
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true;

            videoRef.current = video;

            // 等待视频加载
            await new Promise<void>((resolve) => {
                video.onloadedmetadata = () => {
                    video.play();
                    resolve();
                };
            });

            // 将 video 添加到 body
            video.style.position = 'fixed';
            video.style.top = '50%';
            video.style.left = '50%';
            video.style.transform = 'translate(-50%, -50%)';
            video.style.width = '100%';
            video.style.maxWidth = '500px';
            video.style.borderRadius = '12px';
            video.style.zIndex = '9999';
            video.style.boxShadow = '0 4px 20px rgba(0,0,0,0.3)';

            // 添加拍照按钮
            const captureBtn = document.createElement('button');
            captureBtn.innerHTML = '📸 拍照';
            captureBtn.style.position = 'fixed';
            captureBtn.style.bottom = '100px';
            captureBtn.style.left = '50%';
            captureBtn.style.transform = 'translateX(-50%)';
            captureBtn.style.padding = '16px 48px';
            captureBtn.style.fontSize = '18px';
            captureBtn.style.borderRadius = '30px';
            captureBtn.style.border = 'none';
            captureBtn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            captureBtn.style.color = 'white';
            captureBtn.style.cursor = 'pointer';
            captureBtn.style.zIndex = '10000';
            captureBtn.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3)';

            // 添加关闭按钮
            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '✕';
            closeBtn.style.position = 'fixed';
            closeBtn.style.top = '20px';
            closeBtn.style.right = '20px';
            closeBtn.style.width = '40px';
            closeBtn.style.height = '40px';
            closeBtn.style.borderRadius = '50%';
            closeBtn.style.border = 'none';
            closeBtn.style.background = 'rgba(0,0,0,0.5)';
            closeBtn.style.color = 'white';
            closeBtn.style.fontSize = '20px';
            closeBtn.style.cursor = 'pointer';
            closeBtn.style.zIndex = '10000';

            // 容器
            const container = document.createElement('div');
            container.id = 'camera-container';
            container.style.position = 'fixed';
            container.style.top = '0';
            container.style.left = '0';
            container.style.width = '100%';
            container.style.height = '100%';
            container.style.background = 'rgba(0,0,0,0.8)';
            container.style.zIndex = '9998';

            container.appendChild(video);
            container.appendChild(captureBtn);
            container.appendChild(closeBtn);
            document.body.appendChild(container);

            // 拍照事件
            captureBtn.onclick = async () => {
                setIsCapturing(true);
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.drawImage(video, 0, 0);
                        canvas.toBlob(async (blob) => {
                            if (blob) {
                                console.log('[CAMERA] 拍照成功，文件大小:', blob.size, '字节');
                                // 关闭摄像头
                                closeCamera();
                                // 触发自定义事件通知拍照完成
                                window.dispatchEvent(new CustomEvent('photoCaptured', { detail: blob }));
                            }
                            setIsCapturing(false);
                        }, 'image/jpeg', 0.9);
                    }
                } catch (err) {
                    console.error('[CAMERA] 拍照失败:', err);
                    setIsCapturing(false);
                }
            };

            // 关闭事件
            closeBtn.onclick = closeCamera;
            container.onclick = (e) => {
                if (e.target === container) {
                    closeCamera();
                }
            };

            setIsCameraOpen(true);
            console.log('[CAMERA] 摄像头已打开');

        } catch (err) {
            console.error('[CAMERA] 打开摄像头失败:', err);
            setError(err instanceof Error ? err.message : '无法打开摄像头');
            setIsCameraOpen(false);
        }
    }, []);

    const closeCamera = useCallback(() => {
        // 停止流
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        // 移除容器
        const container = document.getElementById('camera-container');
        if (container) {
            container.remove();
        }

        videoRef.current = null;
        setIsCameraOpen(false);
        console.log('[CAMERA] 摄像头已关闭');
    }, []);

    const capturePhoto = useCallback(async (): Promise<Blob | null> => {
        if (!videoRef.current) {
            console.error('[CAMERA] 摄像头未打开');
            return null;
        }

        setIsCapturing(true);

        try {
            const canvas = document.createElement('canvas');
            canvas.width = videoRef.current.videoWidth;
            canvas.height = videoRef.current.videoHeight;
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                throw new Error('无法获取 canvas 上下文');
            }

            ctx.drawImage(videoRef.current, 0, 0);

            return new Promise((resolve) => {
                canvas.toBlob((blob) => {
                    if (blob) {
                        console.log('[CAMERA] 拍照成功，文件大小:', blob.size, '字节');
                    }
                    setIsCapturing(false);
                    resolve(blob);
                }, 'image/jpeg', 0.9);
            });
        } catch (err) {
            console.error('[CAMERA] 拍照失败:', err);
            setIsCapturing(false);
            return null;
        }
    }, []);

    const switchCamera = useCallback(() => {
        facingModeRef.current = facingModeRef.current === 'user' ? 'environment' : 'user';
        if (isCameraOpen) {
            openCamera();
        }
    }, [isCameraOpen, openCamera]);

    return {
        isCameraOpen,
        isCapturing,
        error,
        openCamera,
        closeCamera,
        capturePhoto,
        switchCamera
    };
};