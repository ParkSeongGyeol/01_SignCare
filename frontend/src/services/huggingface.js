// src/services/huggingface.js
//
// ⚠️ 보안 주의
// 예전 버전은 이 파일에서 Hugging Face API를 브라우저에서 직접 호출하면서
// Authorization 헤더에 API 키를 넣었습니다. 프론트엔드 코드는 전부 사용자에게
// 그대로 전달되므로, 그렇게 하면 빌드 결과물(JS 번들)에서 키를 누구나 꺼낼 수 있습니다.
//
// 그래서 지금은 키를 가지고 있는 백엔드(/api/ai/*)를 통해서만 호출합니다.
// 프론트엔드에는 어떤 형태로도 API 키를 두지 마세요.

import apiClient from './api'

// 텍스트 기반 챗봇 메시지 전송 (백엔드가 Hugging Face를 대신 호출)
export const sendChatbotMessage = async (message) => {
  const response = await apiClient.post('/api/ai/chat', { message })
  return response.data
}

// 이미지 분석 (식단 인식) — 백엔드 업로드/분석 엔드포인트 사용
export const analyzeFoodImage = async (file) => {
  const formData = new FormData()
  formData.append('file', file)

  const response = await apiClient.post('/api/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return response.data
}

export default {
  sendChatbotMessage,
  analyzeFoodImage,
}
