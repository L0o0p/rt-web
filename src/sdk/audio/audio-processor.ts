/// <reference lib="webworker" />

// Advanced AudioWorklet processor with built-in resampling and buffering
class ResamplerProcessor extends AudioWorkletProcessor {
    gain: number;
    channelId: number;
    inputSampleRate: number;
    targetSampleRate: number;
    targetBufferSize: number;

    // 音频缓冲区
    private audioBuffer: Float32Array;
    private chunkCount: number;

    // 重采样相关
    private needsResampling: boolean;

    constructor(options?: AudioWorkletNodeOptions) {
        super();

        // 从选项中获取参数
        const opts = options?.processorOptions || {};
        this.gain = opts.gain ?? 1.0;
        this.channelId = opts.channelId ?? 0;
        this.inputSampleRate = opts.inputSampleRate ?? 16000;
        this.targetSampleRate = opts.targetSampleRate ?? 16000;
        this.targetBufferSize = opts.targetBufferSize ?? 1024;

        // 初始化缓冲区
        this.audioBuffer = new Float32Array(0);
        this.chunkCount = 0;

        // 判断是否需要重采样
        this.needsResampling = this.inputSampleRate !== this.targetSampleRate;

        // 发送初始化信息
        this.port.postMessage({
            type: 'init',
            inputSampleRate: this.inputSampleRate,
            targetSampleRate: this.targetSampleRate,
            targetBufferSize: this.targetBufferSize,
            needsResampling: this.needsResampling
        });
    }

    /**
     * 线性插值重采样
     */
    private resampleAudioBuffer(inputBuffer: Float32Array): Float32Array {
        if (!this.needsResampling) {
            return inputBuffer;
        }

        const ratio = this.inputSampleRate / this.targetSampleRate;
        const outputLength = Math.round(inputBuffer.length / ratio);
        const outputBuffer = new Float32Array(outputLength);

        for (let i = 0; i < outputLength; i++) {
            const position = i * ratio;
            const index = Math.floor(position);
            const fraction = position - index;

            if (index + 1 < inputBuffer.length) {
                // 线性插值
                outputBuffer[i] = inputBuffer[index] * (1 - fraction) + inputBuffer[index + 1] * fraction;
            } else {
                outputBuffer[i] = inputBuffer[index] || 0;
            }
        }

        return outputBuffer;
    }

    /**
     * 将新数据添加到缓冲区
     */
    private appendToBuffer(newData: Float32Array): void {
        if (this.audioBuffer.length === 0) {
            this.audioBuffer = newData;
        } else {
            const combinedBuffer = new Float32Array(this.audioBuffer.length + newData.length);
            combinedBuffer.set(this.audioBuffer);
            combinedBuffer.set(newData, this.audioBuffer.length);
            this.audioBuffer = combinedBuffer;
        }
    }

    /**
     * 处理缓冲区，发送完整的块
     */
    private processBuffer(): void {
        while (this.audioBuffer.length >= this.targetBufferSize) {
            const chunkToSend = this.audioBuffer.slice(0, this.targetBufferSize);
            this.audioBuffer = this.audioBuffer.slice(this.targetBufferSize);

            this.chunkCount++;

            // 发送处理好的音频块
            this.port.postMessage({
                type: 'audioData',
                data: chunkToSend,
                chunkIndex: this.chunkCount,
                bufferSize: chunkToSend.length
            });
        }
    }

    override process(inputs: Float32Array[][], _outputs: Float32Array[][], _parameters: any) {
        const input = inputs[0];
        if (!input || !input[0]) {
            return true;
        }

        // 确保请求的通道存在
        if (this.channelId >= input.length) {
            this.channelId = 0;
        }

        // 处理指定通道的数据
        const channelData = input[this.channelId];
        if (channelData && channelData.length > 0) {
            // 应用音量增益
            let processedData: Float32Array;
            if (this.gain !== 1.0) {
                processedData = new Float32Array(channelData.length);
                for (let i = 0; i < channelData.length; i++) {
                    processedData[i] = channelData[i] * this.gain;
                }
            } else {
                processedData = channelData;
            }

            // 重采样（如果需要）
            if (this.needsResampling) {
                processedData = this.resampleAudioBuffer(processedData);
            }

            // 添加到缓冲区
            this.appendToBuffer(processedData);

            // 处理缓冲区，发送完整的块
            this.processBuffer();
        }

        return true;
    }
}

// 注册处理器
registerProcessor('resampler-processor', ResamplerProcessor);