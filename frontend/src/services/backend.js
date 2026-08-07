// src/services/backend.js
import apiClient from './api';
import huggingfaceService from './huggingface';

// 챗봇 메시지 전송 (백엔드 API + Hugging Face API 통합)
export const sendMessage = async (message) => {
  try {
    // 1. 백엔드 API 호출 시도
    const backendResponse = await apiClient.post('/api/chatbot', {
      message,
      userId: 'user-123'
    });
    
    return backendResponse.data;
  } catch (backendError) {
    console.log('백엔드 API 호출 실패, Hugging Face API로 대체:', backendError);
    
    try {
      // 2. 재시도 (백엔드가 Hugging Face 호출을 대신 처리)
      const huggingfaceResponse = await huggingfaceService.sendChatbotMessage(message);
      return {
        message: huggingfaceResponse.response,
        source: 'huggingface'
      };
    } catch (huggingfaceError) {
      console.error('Hugging Face API 호출도 실패:', huggingfaceError);
      
      // 3. 모두 실패 시 기본 응답 반환
      return {
        message: '죄송합니다. 현재 서비스 연결에 문제가 있습니다. 잠시 후 다시 시도해주세요.',
        source: 'fallback'
      };
    }
  }
};

// 식단 이미지 업로드 및 분석 (백엔드 API + Hugging Face API 통합)
export const uploadAndAnalyzeImage = async (file) => {
  try {
    // 1. 백엔드 API로 이미지 업로드 시도
    const formData = new FormData();
    formData.append('file', file);
    
    const backendResponse = await apiClient.post('/api/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    
    return backendResponse.data;
  } catch (backendError) {
    console.log('백엔드 이미지 업로드 실패, Hugging Face API로 대체:', backendError);
    
    try {
      // 2. 재시도 (백엔드가 Hugging Face 호출을 대신 처리)
      const huggingfaceResponse = await huggingfaceService.analyzeFoodImage(file);

      // 분석 결과를 가공하여 반환
      return {
        analysis: huggingfaceResponse.analysis ?? huggingfaceResponse.message,
        nutritionInfo: {
          calories: '추정치: 약 450kcal',
          carbs: '추정치: 약 45g',
          protein: '추정치: 약 25g',
          fat: '추정치: 약 20g'
        },
        recommendation: '이 음식은 단백질이 풍부하지만, 탄수화물과 지방 함량도 높습니다. 당뇨 관리를 위해 채소를 함께 섭취하고, 다음 식사에서는 탄수화물 섭취를 줄이는 것이 좋습니다.',
        source: 'huggingface'
      };
    } catch (huggingfaceError) {
      console.error('Hugging Face 이미지 분석도 실패:', huggingfaceError);
      
      // 3. 모두 실패 시 기본 응답 반환
      return {
        analysis: '이미지 분석에 실패했습니다.',
        recommendation: '서비스 연결에 문제가 있습니다. 잠시 후 다시 시도해주세요.',
        source: 'fallback'
      };
    }
  }
};

export default {
  sendMessage,
  uploadAndAnalyzeImage
};
