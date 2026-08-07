// src/services/api.js
import axios from 'axios'

// API 서버 주소는 환경변수로 분리 (Vite는 VITE_ 접두사만 노출합니다)
// ⚠️ 여기에 API 키/토큰 같은 비밀값은 절대 넣지 마세요.
//    VITE_ 로 노출된 값은 빌드 결과물에 그대로 포함되어 누구나 볼 수 있습니다.
const baseURL =
  import.meta.env.VITE_API_BASE_URL || 'https://01capstonedesign-production.up.railway.app'

// API 클라이언트 생성
const apiClient = axios.create({
  baseURL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
})

export default apiClient
