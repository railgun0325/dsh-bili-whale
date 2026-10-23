#!/usr/bin/env python3
"""SenseVoice 离线转写：python3 asr_transcribe.py <wav16k> [模型目录]

供 tools/commands/asr.mjs 调用。纯本地、不联网。
依赖：pip install sherpa-onnx（本机已装 1.13.8）
"""
import sys
import wave
import array

def main():
    if len(sys.argv) < 2:
        print('用法: asr_transcribe.py <wav16k> [模型目录]', file=sys.stderr)
        return 2
    wav = sys.argv[1]
    model_dir = sys.argv[2] if len(sys.argv) > 2 else (
        '/Users/railgun/.dsh/speech-to-text/sensevoice/models/sensevoice-onnx')
    try:
        import sherpa_onnx
    except Exception as e:
        print(f'缺少 sherpa-onnx：{e}\n装一下：python3 -m pip install --user sherpa-onnx', file=sys.stderr)
        return 3

    rec = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=f'{model_dir}/model.int8.onnx',
        tokens=f'{model_dir}/tokens.txt',
        num_threads=4, use_itn=True, language='auto', debug=False,
    )
    w = wave.open(wav, 'rb')
    sr = w.getframerate()
    if sr != 16000:
        print(f'预期 16k wav，实际 {sr}', file=sys.stderr)
        return 4
    samples = array.array('h', w.readframes(w.getnframes()))
    s = rec.create_stream()
    s.accept_waveform(sr, [x / 32768.0 for x in samples])
    rec.decode_stream(s)
    print(s.result.text or '')
    return 0

if __name__ == '__main__':
    sys.exit(main())
