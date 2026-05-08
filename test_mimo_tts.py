"""
MiMo TTS 测试脚本

使用 token-plan-cn 端点（OpenAI 兼容协议）
API: https://token-plan-cn.xiaomimimo.com/v1
模型: mimo-v2.5-tts
方式: Chat Completions API + audio 参数（流式 PCM16）

依赖安装:
    pip install openai numpy soundfile

运行:
    set MIMO_API_KEY=your_key_here
    python test_mimo_tts.py
"""

import base64
import os
import sys
import numpy as np

try:
    import soundfile as sf
except ImportError:
    print("请先安装依赖: pip install openai numpy soundfile")
    sys.exit(1)

from openai import OpenAI

# ── 配置 ──────────────────────────────────────────────────────────────────────

API_KEY = os.environ.get("MIMO_API_KEY", "tp-cysb6jhbz98e3gisjcz026z1rdm0rbzcydzb0r5784n467wr")
BASE_URL = "https://token-plan-cn.xiaomimimo.com/v1"
MODEL = "mimo-v2.5-tts"

# 测试用文本（中文）
TEST_TEXT = "你好，欢迎使用小米 MiMo 语音合成服务。今天天气不错，希望你有个愉快的一天！"

# 音色（参考官方文档，可替换）
VOICE = "Chloe"

# ── 主逻辑 ────────────────────────────────────────────────────────────────────

def main():
    if not API_KEY:
        print("❌ 未设置 MIMO_API_KEY 环境变量")
        print("   Windows: set MIMO_API_KEY=your_key_here")
        sys.exit(1)

    print(f"✅ API Key: {API_KEY[:8]}...")
    print(f"✅ Base URL: {BASE_URL}")
    print(f"✅ Model: {MODEL}")
    print(f"✅ Voice: {VOICE}")
    print(f"✅ Text: {TEST_TEXT}")
    print()

    client = OpenAI(
        api_key=API_KEY,
        base_url=BASE_URL,
    )

    print("📡 发送请求（流式）...")

    try:
        completion = client.chat.completions.create(
            model=MODEL,
            messages=[
                {
                    "role": "user",
                    "content": "请用自然流畅的语气朗读以下文字。"
                },
                {
                    "role": "assistant",
                    "content": TEST_TEXT
                }
            ],
            audio={
                "format": "pcm16",
                "voice": VOICE
            },
            stream=True,
        )
    except Exception as e:
        print(f"❌ 请求失败: {e}")
        sys.exit(1)

    # 收集 24kHz PCM16LE mono 音频块
    collected_chunks: np.ndarray = np.array([], dtype=np.float32)
    chunk_count = 0

    for chunk in completion:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        audio = getattr(delta, "audio", None)

        if audio is not None:
            if not isinstance(audio, dict):
                print(f"⚠️  audio 类型异常: {type(audio)}, 值: {audio}")
                continue
            raw = audio.get("data")
            if not raw:
                continue
            pcm_bytes = base64.b64decode(raw)
            np_pcm = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
            collected_chunks = np.concatenate((collected_chunks, np_pcm))
            chunk_count += 1
            print(f"  chunk #{chunk_count}: {len(pcm_bytes)} bytes, 累计 {len(collected_chunks)} 采样点")

    print()

    if len(collected_chunks) == 0:
        print("❌ 未收到任何音频数据，请检查：")
        print("   1. API Key 是否正确")
        print("   2. 账户是否有余额")
        print("   3. 音色名称是否正确")
        sys.exit(1)

    # 保存为 WAV（24kHz 单声道）
    os.makedirs("tmp", exist_ok=True)
    output_path = "tmp/mimo_tts_output.wav"
    sf.write(output_path, collected_chunks, samplerate=24000)

    duration = len(collected_chunks) / 24000
    print(f"✅ 音频已保存: {output_path}")
    print(f"   时长: {duration:.2f} 秒 | 采样点: {len(collected_chunks)}")


if __name__ == "__main__":
    main()
