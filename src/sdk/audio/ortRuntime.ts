import * as ort from 'onnxruntime-web';
import ortWasmMjsUrl from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import ortWasmUrl from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';

let isOrtRuntimeConfigured = false;

export function configureOrtRuntimeForVad(): void {
    if (isOrtRuntimeConfigured) return;

    // Decision: VAD uses a tiny Silero model on the hot microphone path. Pin
    // ORT to the WASM SIMD runtime and one thread to avoid worker fan-out and
    // cross-browser path inference before the first InferenceSession is created.
    ort.env.wasm.wasmPaths = {
        mjs: ortWasmMjsUrl,
        wasm: ortWasmUrl,
    };
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
    ort.env.wasm.proxy = false;
    ort.env.logLevel = 'warning';

    isOrtRuntimeConfigured = true;
}
