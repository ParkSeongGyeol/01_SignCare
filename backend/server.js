// 📌 서버 기본 설정
const express = require("express"); // 서버 실행을 위한 Node.js 웹 프레임워크
const cors = require("cors"); // 프론트엔드(Vue)에서 요청을 보낼 수 있도록 허용
const helmet = require("helmet"); // 기본 보안 HTTP 헤더 설정
const rateLimit = require("express-rate-limit"); // 요청 횟수 제한(DoS/남용 방지)
const multer = require("multer"); // 파일 업로드를 처리하는 패키지
const fs = require("fs"); // 파일 및 폴더 관리를 위한 Node.js 내장 모듈
const path = require("path"); // 경로를 안전하게 다루기 위한 Node.js 내장 모듈
const crypto = require("crypto"); // 예측 불가능한 파일명 생성용
require("dotenv").config(); // .env 파일을 활용하여 환경변수를 저장할 수 있도록 설정

const app = express(); // Express 앱(서버) 생성
const PORT = process.env.PORT || 5000;

// 📌 환경 변수 활용 (업로드 폴더 지정)
// 경로를 절대경로로 고정해 두어야 이후 경로 검사(path traversal 방지)가 정확해진다.
const uploadDir = path.resolve(process.env.UPLOAD_DIR || "uploads");

// 📌 업로드 허용 규칙
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

// 📌 보안 헤더 (X-Frame-Options, X-Content-Type-Options, HSTS 등)
app.use(helmet());
// 업로드된 이미지를 다른 오리진(프론트엔드)에서 <img>로 불러올 수 있도록 허용
app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" }));
app.disable("x-powered-by"); // 서버 기술 스택 노출 방지

// 📌 CORS 설정 (배포된 프론트엔드만 허용)
const allowedOrigins = [
  "https://signcare-vue.vercel.app", // 도메인
  "https://signcare-ags6f7jgl-john-parks-projects-b98b1c70.vercel.app", // 배포된 프론트엔드 URL(임시)
  "http://localhost:5173", // 로컬 개발 환경
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS 정책에 의해 차단됨"));
      }
    },
    methods: "GET,POST",
    allowedHeaders: "Content-Type",
  })
);

// 📌 미들웨어 설정
// 본문 크기 상한을 두지 않으면 거대한 JSON 하나로 메모리를 고갈시킬 수 있다.
app.use(express.json({ limit: "100kb" }));

// 📌 요청 수 제한 (같은 IP에서 15분에 100회)
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
  })
);

// 📌 uploads 폴더 자동 생성 (없으면 생성)
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log(`📂 '${uploadDir}' 폴더 생성 완료!`);
}

// 📌 기본 API 엔드포인트 (홈 페이지)
app.get("/", (req, res) => {
  res.send("Express 서버 실행 중...");
});

// 📌 챗봇 API (프론트엔드에서 메시지를 보내면 응답)
app.post("/api/chatbot", (req, res) => {
  const { message } = req.body;

  // 타입/길이 검증: 문자열이 아닌 값이나 초장문 입력을 그대로 받지 않는다.
  if (typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "message는 비어있지 않은 문자열이어야 합니다." });
  }
  if (message.length > 1000) {
    return res.status(413).json({ error: "message는 1000자를 넘을 수 없습니다." });
  }

  // 기본적인 챗봇 응답 (AI 연동 없이 간단한 응답)
  let responseText = "🤖 챗봇 응답: " + message;
  res.json({ response: responseText });
});

// 📌 Hugging Face 프록시
// API 키는 서버 환경변수에만 존재한다. 프론트엔드로 키를 내려보내면
// 브라우저 번들에 그대로 박혀 누구나 꺼내 쓸 수 있게 되므로 반드시 서버가 대신 호출한다.
const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;
const HF_BASE = "https://api-inference.huggingface.co/models";
const HF_CHAT_MODEL = "google/gemma-3-27b-it";

app.post("/api/ai/chat", async (req, res) => {
  if (!HF_API_KEY) {
    return res.status(503).json({ error: "AI 기능이 설정되지 않았습니다. (HUGGINGFACE_API_KEY 없음)" });
  }

  const { message } = req.body;
  if (typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "message는 비어있지 않은 문자열이어야 합니다." });
  }
  if (message.length > 1000) {
    return res.status(413).json({ error: "message는 1000자를 넘을 수 없습니다." });
  }

  try {
    const hfRes = await fetch(`${HF_BASE}/${HF_CHAT_MODEL}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${HF_API_KEY}`,
      },
      body: JSON.stringify({
        inputs: message,
        parameters: { max_new_tokens: 250, temperature: 0.7, top_p: 0.9, do_sample: true },
      }),
    });

    if (!hfRes.ok) {
      // 업스트림 응답 본문에 키나 내부 정보가 섞여 나갈 수 있어 그대로 전달하지 않는다.
      console.error("Hugging Face 오류:", hfRes.status, await hfRes.text());
      return res.status(502).json({ error: "AI 응답을 가져오지 못했습니다." });
    }

    const data = await hfRes.json();
    res.json({ response: data?.[0]?.generated_text ?? "" });
  } catch (err) {
    console.error("Hugging Face 호출 실패:", err);
    res.status(502).json({ error: "AI 응답을 가져오지 못했습니다." });
  }
});

// 📌 파일 업로드 설정 (음식 사진)
const storage = multer.diskStorage({
  destination: uploadDir, // 업로드된 파일이 저장될 폴더
  filename: (req, file, cb) => {
    // 원본 파일명(file.originalname)은 공격자가 정하는 값이라 그대로 쓰면
    // "../../server.js" 같은 이름으로 폴더를 벗어날 수 있다.
    // 확장자만 화이트리스트에서 가져오고 이름은 서버가 무작위로 만든다.
    const ext = ALLOWED_MIME.get(file.mimetype);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("이미지 파일(JPEG/PNG/WebP)만 업로드할 수 있습니다."));
    }
    cb(null, true);
  },
});

// 📌 음식 사진 업로드 API
app.post("/api/upload", (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      const status = err instanceof multer.MulterError ? 413 : 400;
      return res.status(status).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "파일이 업로드되지 않았습니다." });
    }

    console.log("✅ 파일 업로드 성공:", req.file.filename);
    res.json({ message: "파일 업로드 성공!", filename: req.file.filename });
  });
});

// 📌 업로드된 파일 제공 (정적 경로 추가)
app.get("/api/uploads/:filename", (req, res) => {
  // path traversal 방지 2단계:
  // 1) basename으로 경로 구분자를 제거하고, 2) 최종 경로가 uploadDir 안에 있는지 재확인한다.
  const safeName = path.basename(req.params.filename);
  const filePath = path.resolve(uploadDir, safeName);

  if (filePath !== path.join(uploadDir, safeName) || !filePath.startsWith(uploadDir + path.sep)) {
    return res.status(400).json({ error: "잘못된 파일명입니다." });
  }
  if (!ALLOWED_MIME.has(mimeOf(filePath))) {
    return res.status(400).json({ error: "잘못된 파일명입니다." });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "파일을 찾을 수 없습니다." });
  }

  res.sendFile(filePath);
});

// 확장자로부터 MIME 타입을 되돌려 허용 목록과 대조한다.
function mimeOf(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  for (const [mime, allowedExt] of ALLOWED_MIME) {
    if (allowedExt === ext) return mime;
  }
  return null;
}

// 📌 오류 처리 (스택 트레이스가 응답으로 새어나가지 않도록)
app.use((err, req, res, next) => {
  console.error("서버 오류:", err);
  res.status(500).json({ error: "서버 내부 오류가 발생했습니다." });
});

// 📌 서버 실행
app.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT} (PORT: ${PORT})`);
});
