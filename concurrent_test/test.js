class WeikeWebSocketClient {
    constructor(url = 'ws://agent-zh-test.vkcto.com:32028/ws') {
        this.url = url;
        this.ws = null;
        this.sessionId = null;
        this.onMessage = null;
        this.onError = null;
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.url);

            this.ws.onopen = () => {
                console.log('WebSocket连接已建立');
                resolve();
            };

            this.ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                if (this.onMessage) {
                    this.onMessage(message);
                }
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket错误:', error);
                if (this.onError) {
                    this.onError(error);
                }
                reject(error);
            };

            this.ws.onclose = () => {
                console.log('WebSocket连接已关闭');
            };
        });
    }

    createSession(config = {}) {
        this.sessionId = this.generateSessionId();

        const message = {
            protocol_id: 100, // ALL
            command_id: 1,    // START
            session_id: this.sessionId,
            payload: {
                type: "session_config",
                mode: config.mode || "vad_deferred",
                vad_threshold: config.vad_threshold || 0.5,
                silence_duration_ms: config.silence_duration_ms || 1000,
                min_speech_duration_ms: config.min_speech_duration_ms || 300,
                system_prompt: config.system_prompt || "你是一个友好的AI助手",
                enable_search: config.enable_search || true,
                voice_setting: {
                    voice_id: "zh_female_wanwanxiaohe_moon_bigtts",
                    speed: 1.0,
                    pitch: 0.0,
                    volume: 1.0
                },
                audio_chunk_size_kb: 4,
                initial_burst_count: 10,
                initial_burst_delay_ms: 10,
                send_rate_multiplier: 1.02,
                asr_language: "zh",
                timezone: "Asia/Shanghai",
                location: "深圳",
                ...config
            }
        };

        this.ws.send(JSON.stringify(message));
        return this.sessionId;
    }

    sendAudio(audioData, sampleRate = 16000, channels = 1) {
        if (!this.sessionId) {
            throw new Error('会话未创建');
        }
        console.log("sessionId: ", this.sessionId);

        // 将Float32Array转换为Base64
        const audioBytes = new Uint8Array(audioData.buffer);
        const base64Data = btoa(String.fromCharCode(...audioBytes));
        // console.log("audioBytes data: ", audioBytes);
        const reserved = new Array(14).fill(0);
        const message = {
            protocol_id: 100, // ALL
            command_id: 3,    // AUDIO_CHUNK
            session_id: this.sessionId,
            reserved,
            payload: {
                type: "audio_chunk",
                data: "63386239333733626565643432613638010300000000000000000000000000009ffb16fad8fb43fa5afb91fa74fbd1fbb5fcebfd2afcd7fdf1fc27fdebfd04fdf8fdf7fcdffc74fd3dfe28ff5dfee3ff6cfe0d01beffd6006f024600bf02e3011003a501a20108017dff6b00fbfd4fff60ff6bfe170041ff58005b011d018e0012015602460234026b020303570338031d035c02ba0389024f021d03c7016701caff73ffc0ffb000e6ff62ffccfe82ffb0007400f9fd3efb92fbc3fcd9fdeafe32fedffc2ffcd1fc3cfe4ffde9fd41fd0dff81ffcffde3fd72fefffe7afe40ff87ff01017e008d0064023102bb01050195ff5dff20ffd1fde2fe18ff4901e40012012f0344045b05d903680473033d02a9010801a50294024101df01800138026f01a4004d00d4ffe2012c008aff9efeddfd83fd77fcabfd52fe55fe01fdf8fd8800540064000efed4fc64fd40faa5fec4fa17fa0b03d8fa6700830106fdf70298ff820235037c02ac041202b40213ffd800b200afffe602e0008d02a000c6ff97ff3801c7011f021a020aff3100a5fe83fe51fffcfea6fe90ff48fe63005c00450154ff69fe67ff0efcc6fe84fd02fd37fd70fd01fdcefb04ff5dfe24fefdffd1fe8f00340146003601800007012d034c022a02470264023f026602e4035602190141ff66fdcfff1900ff008d0091ffbe001101daff4301e500a6ff910065ff5d005b00f30085000602ec0108013501f1ffdfff0affb1ff07ff8cfebafdfcfec8fe02fe87ffafff2802d80112014f028301b402720032ffa8ffa3fef1fe93fd02fe88fe73fed2fd00fea6fefdff8bff1a013e028101db0040ffba01a001b601d9ff78fe58fe1ffd4afed4fc2efdc2fea9fe7400c5ffb8ff41014001d800e5ff21fe0effe9fe0affa9fef4fd34ff45fe260055fe37fff2ff65ffa00109021f02d0007efff4ff49010d020502900239012e0246034d0219031301d50052010c00f7fffafd94fedcfd5ffe9cffcefeb1ff0e00d0ff5401f9ff910044ffd5fe3301fbff140094006b001700b00008007700b5fe3eff8f00db02b1015f0096feaefdc0fe3300ae00d2003a015200b6004fff18012b029901bfff97fd450062005bff91fee8fe3200540018006c0022006afe38fe63fe71fd77fd96fc86fd10ff5dffa3005cffedfeebff1900c7009e00c700aa011402f5011701b300aafe4efe3dfe71ffea00bb0010013000d700e6007200aaff7100de0074001901410053017301fd00620081ff03004c01d70062ffd1fd86fd22fea5fe72fecdfdbbfd7ffd67fef4feaafd0fffdbff1201c1029f026302da011003630289026e01e8000f0146007100b10086ffb4fe1a00e5ff80019f003e01510194012f01480078017700c5ff57ffa5fe02fed3fdb6fed4fe96fef5fe92ffc9ff1bff0bff79fe1ffdf1fd71fe1a0011011800f4003200ae00f7008800a800eaff9900fcffa300fe005fffe00042017302ab017601d901ebffe50187011101360166004f0036ff0bff01ffbefeafff6c004a0036019800890000019bfe77fe920080ff3b000800abfe5efea6fe2afdbefcb2fda6fcb4fdf5fca3fe9cfe0dff9eff06ff0900eefc6efd2afed5fe750089ff9cffd8ff3effcbff8eff63ff99ff6eff690008015002880236024502e302b2023802fd014000060166004101c702ec02ee03ff02fc00eb01740164ffce0232fddc013704ecfc8704a1fdf0fc1901b9fc2501eb00da02e30193fe0dffbdfa51fdc9fe32fd0c030ffef8fd4cfe3bfa260007fd02ff3aff9ffc52000efebdfed2ff94ff630047007dff530098019e01c6004a009fffe1ff2c00f0ff090174ffcf004a00fd00c1013affecfff1fe3b02db0236033204c000e10236019502ac03dc00b100d8ff5c00f700a4023300d2fe1efe3afca7fe51fe50fffcfe38fd31fefdfd6cfffbff360026ffddfe93ffdcfff3ff720079ff80fea9fdf6fda9fe26fd7ffdaefdfffe20fec0fd1dfecefe69fecbfd51feecfd83ffdcffe6007e0143025102b501fc00bbff7a0149025f0141017901ff0006012a00dbff3e01ff00860265023f02ca02bd01d4028a022803de00a4ff6cff6bfe4b000fffeffec5fe7cfdc100ca017f026203900100021200fd00dd007b002dffa3fe69fef8fdd1fd9afebcff3f00da007fffa3ffde006c01a4008cff71ff49ff1dfe02fff6feb2ff80fffafdbafe29fd2eff80ff2a003601ebfffdffb3ffcbff8cffb5fdd1fe5dff85ff54003d01fc01aa01d202ce00c4004900cbff0a002300ce008cffe1ff5efe65fe84fe2cfecfffadfe95fff1fd01fed8fdc5ffa4012000dafeadfc64fd16fe72ffd1fe42ff89ff4300eaffb400e9ffdd007101bf00d3003a00ff010802c2025a027f024d02a6026303d702c502e201d8016202c6004300edfffcfe490024ffbffe41fe3efe4c00d9006b0084fd9efda2fe7dff22011f0077008bfe64ff6cffcafee0fe8affb4feb1fea4ff0aff3b0156018100b2018b010a03d8028e00040107010901c3001aff64fef2fed9fe74fedbfe0affd0feeefefffeebfe14007f001301b100ad00e4ff45005100c6ff5affcafe5bfedafd79fe90fe26ffb8feadfea5ffbeffe500fcff360085ff6cfe48fe60fda4fd79fdbcfdf1fdd3fdc6fe07fee8ff03ffb7ff2400dafef4ffd1ff0c0155018400f30045011d014c01c501e3029f02f402b7023004dc0425042005f404d5046d040a039e006b005200db010e02e8010e022400e100d900c000990145ffb5feebfd8afbe9fb45fbedfb15fd32fd66fb70fbc6fb59fbd2fc3ffda9fe8fffeeff7fffb6ff97f",
                sample_rate: sampleRate,
                channels: channels
            }
        };

        console.log(message);
        
        this.ws.send(JSON.stringify(message));
    }

    sendText(text) {
        if (!this.sessionId) {
            throw new Error('会话未创建');
        }

        const message = {
            protocol_id: 100, // ALL
            command_id: 4,    // TEXT_DATA
            session_id: this.sessionId,
            payload: {
                type: "text_data",
                text: text
            }
        };

        this.ws.send(JSON.stringify(message));
    }

    stopInput() {
        if (!this.sessionId) {
            return;
        }

        const message = {
            protocol_id: 100, // ALL
            command_id: 5,    // STOP_INPUT
            session_id: this.sessionId,
            payload: {}
        };

        this.ws.send(JSON.stringify(message));
    }

    stopSession() {
        if (!this.sessionId) {
            return;
        }

        const message = {
            protocol_id: 100, // ALL
            command_id: 2,    // STOP
            session_id: this.sessionId,
            payload: {}
        };

        this.ws.send(JSON.stringify(message));
        this.sessionId = null;
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
}

// 使用示例
async function example() {
    const client = new WeikeWebSocketClient();

    try {
        await client.connect();

        // 设置消息处理器
        client.onMessage = (message) => {
            console.log('收到消息:', message);

            // 处理不同类型的事件
            switch (message.type) {
                case 'session.created':
                    console.log('会话已创建:', message.session_id);
                    break;
                case 'input_audio_buffer.speech_started':
                    console.log('检测到语音开始');
                    break;
                case 'input_audio_buffer.speech_stopped':
                    console.log('检测到语音结束');
                    break;
                case 'conversation.item.input_audio_transcription.delta':
                    console.log('ASR增量:', message.delta);
                    break;
                case 'conversation.item.input_audio_transcription.completed':
                    console.log('ASR完成:', message.transcript);
                    break;
                case 'response.text.delta':
                    console.log('LLM增量:', message.delta);
                    break;
                case 'response.text.done':
                    console.log('LLM完成:', message.text);
                    break;
                case 'response.audio.delta':
                    // 处理TTS音频数据
                    const audioData = atob(message.delta);
                    // 播放音频...
                    break;
                case 'response.done':
                    console.log('响应完成');
                    break;
                case 'error.event':
                    console.error('错误:', message.message);
                    break;
            }
        };

        // 创建会话
        const sessionId = client.createSession({
            mode: "vad",
            system_prompt: "你是一个智能语音助手",
            enable_search: true
        });

        console.log('会话ID:', sessionId);

        // 模拟发送音频数据
        const audioData = new Float32Array(16000); // 1秒的音频数据
        client.sendAudio(audioData);

        // 或者发送文本
        client.sendText("你好，请帮我查询天气");

    } catch (error) {
        console.error('连接失败:', error);
    }
}