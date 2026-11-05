# 고지 (한국어판)

Laya Memory 한국어판은 [vishalmysore/layaForMemory](https://github.com/vishalmysore/layaForMemory)(Apache-2.0)의 파생물입니다. ConvAI Innovations, TypeSafe, `invalidate` 저자, Microsoft, Hugging Face, Answer.AI, LightOn, sentence-transformers 저자와 제휴하거나 그들의 보증을 받지 않은 비공식 프로젝트입니다.

## 이 저장소

- 무효화 정책, 기억 저장소, 사건 추적기, 평가 하네스, 페이지, 예시 사례: Copyright 2026 vishalmysore, Apache License 2.0 (`LICENSE`).
- 한국어 번역·다국어 모델 연동·UI 현지화: 원본과 같은 라이선스(Apache-2.0)로 배포합니다.
- `web/cases.json`, `web/scenarios.json`의 인물·팀·제품은 모두 가상입니다. `web/recorded.json`은 한국어판에서 같은 모델로 직접 녹음한 답변입니다.

## 모델 (런타임에 내려받으며 저장소에 포함되지 않음)

- **판정 모델:** [`convaiinnovations/laya-multilingual`](https://huggingface.co/convaiinnovations/laya-multilingual) (mmBERT 기반, Apache-2.0)의 ONNX int8 변환본을 [laya-web-ko](https://github.com/realizer-1966/laya-web-ko) Pages(`https://realizer-1966.github.io/laya-web-ko/model-multilingual/`)에서 로드합니다.
- **검색 임베딩:** [`Xenova/paraphrase-multilingual-MiniLM-L12-v2`](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2) (Apache-2.0).
- `web/laya-core.js`는 Python `laya/common.py`(`build_sequence`)와 `laya/agent.py`(`system_one`)의 JS 포팅(https://github.com/NandhaKishorM/laya, Apache-2.0)이며, 특수 토큰을 토크나이저 설정에서 자동 감지하도록 수정했습니다.

## 페이지에 함께 배포되는 서드파티 (`vendor/`)

- **ONNX Runtime Web** 1.30.0 — Copyright (c) Microsoft Corporation, MIT. `licenses/onnxruntime-LICENSE.txt`, WASM 내부 구성요소 고지는 `licenses/onnxruntime-ThirdPartyNotices.txt`.
- **Tokenizers.js** 0.2.0 — Hugging Face, Apache-2.0. `licenses/tokenizers.js-LICENSE.txt`.
