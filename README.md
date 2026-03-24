# ✈️ 旅行收據管家 | Travel Receipt Manager

這是一個基於 AI 的旅行支出管理系統。透過 Google Gemini 2.0 Flash 模型，自動從收據照片中擷取日期、商家、金額與分類，並提供即時的數據視覺化與預算管理。

![Dashboard Interface](https://via.placeholder.com/800x450?text=Travel+Receipt+Manager+Interface)

## ✨ 精亮點功能
- **📸 智慧收據識別**: 支援多國語言收據，自動轉換為結構化 JSON 資料。
- **📊 數據可視化**: 提供支出分類佔比、預算使用率與每日消費趨勢。
- **☁️ 雲端與本地端整合**: 基於 SQLite 的高效資料儲存，並支援透過 .env 安全串接 API。
- **📱 行動優先設計**: 響應式介面，出門在外也能輕鬆記帳。
- **⚙️ 自動化部署**: 包含 systemd 與 Nginx 配置，讓專案能穩定運行於 Debian/Ubuntu 環境。

## 🛠️ 技術棧
- **後端**: Python, Flask
- **資料庫**: SQLite
- **AI 模型**: [Google Gemini 2.0 Flash](https://aistudio.google.com/)
- **前端**: HTML5, Vanilla CSS, JavaScript
- **部署**: Gunicorn, Nginx, Linux (systemd)

## 🚀 快速上手

### 1. 複製專案
```bash
git clone <your-repository-url>
cd receipt-system
```

### 2. 設定環境
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 3. 設定環境變數
複製 `.env.example` 並更改為 `.env`，接著填入你的 API 金鑰：
```bash
cp .env.example .env
```
編輯 `.env`：
```text
GEMINI_API_KEY=你的_GEMINI_API_KEY
FLASK_SECRET=隨機生成的安全金鑰
```

### 4. 啟動開發伺服器
```bash
python3 app.py
```
打開瀏覽器訪問 `http://localhost:5001/`

## 📂 專案結構
- `app.py`: 主要路由與 API 邏輯。
- `database.py`: 資料庫連線與事務處理。
- `receipt_processor.py`: AI 辨識的核心處理流程。
- `static/`: 前端所有靜態資源，包括界面視覺設計。
- `deploy/`: 包含 Nginx 與 systemd 配置腳本，方便快速佈署到雲端 VM。
- `uploads/`: 用於存儲上傳收據原始圖檔（預設已忽略於 Git）。

## 🛡️ 安全提示
請務必不要將 `.env` 檔案上傳至任何公開版本控制系統，以確保 API 金鑰安全。

## 📝 授權
[MIT License](LICENSE)
