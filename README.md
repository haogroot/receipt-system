# ✈️ 旅行收據管家 | Travel Receipt Manager

這是一個基於 AI 的旅行支出管理系統。透過 Google Gemini 2.0 Flash 模型，自動從收據照片中擷取日期、商家、金額與分類，並提供即時的數據視覺化與預算管理。

![Dashboard Interface](https://via.placeholder.com/800x450?text=Travel+Receipt+Manager+Interface)

## ✨ 精亮點功能
- **📸 智慧收據識別**: 支援多國語言收據，自動轉換為結構化 JSON 資料。
- **📊 數據可視化**: 提供支出分類佔比、預算使用率與每日消費趨勢。
- **☁️ 雲端與本地端整合**: 基於 SQLite 的高效資料儲存，並支援透過 .env 安全串接 API。
- **📱 行動優先設計**: 響應式介面，出門在外也能輕鬆記帳。
- **⚙️ 自動化部署**: 以 launchd 常駐於 Mac mini，並透過 Tailscale Funnel 對外提供服務。

## 🛠️ 技術棧
- **後端**: Python, Flask
- **資料庫**: SQLite
- **AI 模型**: [Google Gemini 2.0 Flash](https://aistudio.google.com/)
- **前端**: HTML5, Vanilla CSS, JavaScript
- **部署**: Gunicorn, macOS launchd, Tailscale Funnel

## 📐 架構決策與名詞
- [`CONTEXT.md`](CONTEXT.md)：專案名詞表（Trip、Receipt、正式環境、部署、每日備份…）
- [`docs/adr/`](docs/adr/)：架構決策紀錄。想改部署或驗證方式之前，請先讀過相關的 ADR。

## 🚀 開發環境

開發環境就是這個 repo 本身，資料可以隨時丟掉。正式環境是另外 clone 的一份（見下方〈部署〉），兩者**不共用** DB、`uploads/`、`.env`。

### 1. 安裝
```bash
git clone git@github.com:haogroot/receipt-system.git
cd receipt-system
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. 設定 `.env`
```bash
cp .env.example .env
```
開發環境的 `.env` 和正式環境**不一樣**：
```text
GEMINI_API_KEY=你的_GEMINI_API_KEY
AUTH_PASSWORD=開發用密碼（至少12字元，不要跟正式環境相同）
COOKIE_SECURE=false
PORT=7001
```
- `COOKIE_SECURE=false`：開發伺服器走 http，不關掉的話 cookie 不會送出，會一直登不進去。
- 密碼要跟正式環境不同：用手機透過區網 http 連線時，密碼有可能被別人看到。
- 不要用 5000（會跟 macOS 的 AirPlay Receiver 衝突），也不要用 8000（那是正式服務的 port）。
- 不要設定 `SECRET_KEY`／`FLASK_SECRET`；沒設定時會自動產生並存到 `.secret_key`。

### 3. 啟動
```bash
python3 app.py
```
- 電腦：`http://localhost:7001/`
- 手機（測試相機拍收據）：`http://<Mac mini 的區網或 Tailscale IP>:7001/`

> 開發伺服器綁在 `0.0.0.0` 並開著 `debug=True`，同一個區網或 tailnet 上的裝置都連得到，
> 請只在可信任的網路上開啟。

### 4. 測試
```bash
pip install -r requirements-dev.txt
```
```bash
python -m pytest
```
- pytest 只列在 `requirements-dev.txt`，正式環境不會安裝。
- 測試使用暫存目錄與測試用密碼，不會讀取或修改開發環境的 `.env`、DB 和 `uploads/`。

## 📂 專案結構
- `app.py`: 主要路由與 API 邏輯。
- `auth.py`: 登入驗證、session 與暴力破解鎖定。
- `database.py`: 資料庫連線、schema 與 migration。
- `receipt_processor.py`: AI 辨識的核心處理流程。
- `static/`: 前端所有靜態資源，包括界面視覺設計。
- `deploy.sh`: 從開發 repo 部署到正式環境。
- `deploy/macos/`: Mac mini 的 launchd 服務設定、安裝腳本與每日備份。
- `docs/adr/`: 架構決策紀錄。
- `uploads/`: 上傳的收據原始照片（不納入 git）。

## 🔐 登入驗證

服務透過 Tailscale Funnel 公開在網際網路上，Funnel **本身不做任何驗證**，所以驗證完全由應用層負責（見 [ADR-0002](docs/adr/0002-auth-inside-flask-shared-password.md)）：

- 除了 `/login` 與 `/healthz`，**所有路徑**（含 `/api/*`、`/uploads/*`、前端靜態檔）都需要 session cookie。
- Cookie 為 `HttpOnly` + `Secure` + `SameSite=Lax` 的簽章 cookie，預設有效期 180 天且會隨使用自動延長，所以每台裝置只需要登入一次。
- 密碼在 15 分鐘內錯 8 次，會鎖定該來源 IP 15 分鐘（IPv6 以 `/64` 為單位計算）。來源 IP 取自 Funnel 寫入的 `X-Forwarded-For`，且只在請求來自 loopback 時才採信。
- 沒有設定 `AUTH_PASSWORD` 時服務會**拒絕啟動**，避免不小心把未驗證的服務公開出去。

想強制所有裝置重新登入時，把 `.env` 裡的 `AUTH_SESSION_VERSION` 加 1，再重啟服務即可。

> `.secret_key` 用來簽署 session cookie，請勿刪除，否則所有裝置都會被登出。

## 🖥️ 部署（Mac mini + Tailscale Funnel）

> ⚠️ 以下的 `deploy.sh`、`.production` 檢查、部署前快照與每日備份仍在實作中，
> 設計見 [ADR-0004](docs/adr/0004-separate-production-clone-and-deploy-script.md) 與 [ADR-0005](docs/adr/0005-daily-backup-to-icloud-drive.md)。

```
Internet ──► Tailscale Funnel (:443) ──► 127.0.0.1:8000 gunicorn / Flask
             https://<machine>.<tailnet>.ts.net      └── before_request 登入檢查

~/workspace/receipt-system   開發環境（python app.py，:7001）
~/services/receipt-system    正式環境（LaunchDaemon，跟隨 GitHub main）
```

### 首次設定（只需做一次）

**1. Tailscale 後台**
1. DNS → 開啟 **HTTPS Certificates**
2. Access controls → 在 `nodeAttrs` 給這台 Mac mini 加上 `funnel` attribute

**2. 建立正式環境**
```bash
mkdir -p ~/services
git clone git@github.com:haogroot/receipt-system.git ~/services/receipt-system
cd ~/services/receipt-system
cp .env.example .env
touch .production
```
- `.production` 是標記檔（不納入 git）。`install.sh` 找不到這個檔案就會拒絕執行，避免在開發目錄誤裝。
- `.env` 設定 `GEMINI_API_KEY`、`COOKIE_SECURE=true`，並用下面的指令產生 ≥16 字元的隨機密碼當作 `AUTH_PASSWORD`：
  ```bash
  python3 -c "import secrets; print(secrets.token_urlsafe(24))"
  ```

**3. 安裝服務**
```bash
sudo bash ~/services/receipt-system/deploy/macos/install.sh
```
- 以 LaunchDaemon 執行，gunicorn 只綁 `127.0.0.1:8000`，開機後自動啟動
- 會檢查 `.env`：沒有 `AUTH_PASSWORD` 或 `COOKIE_SECURE=false` 時拒絕安裝
- 第一次執行會建立空的 DB

**4. 開啟 Funnel**
```bash
tailscale funnel --bg http://127.0.0.1:8000
```
```bash
tailscale funnel status
```
- 要寫 `127.0.0.1`，不要寫 `localhost`：macOS 可能把 `localhost` 解析成 `::1`，而 gunicorn 只聽 IPv4。
- 開好之後，用手機（不走 Tailscale）打開 `https://<machine>.<tailnet>.ts.net` 確認能看到登入頁。

**5. 主機設定**（原因見 [ADR-0003](docs/adr/0003-host-on-mac-mini.md)）
- FileVault 關閉、macOS 自動登入開啟、Tailscale app 設為登入時啟動
- 系統設定 → 能源 → 停電後自動重新開機

### 日常部署

先 commit 並 push 到 `main`，接著在**開發 repo** 執行：
```bash
./deploy.sh
```
`deploy.sh` 會依序做這些事：
1. 檢查：有 commit 還沒 push、不在 `main`、正式目錄被手動改過 → 中止；開發 repo 有未 commit 的修改 → 只警告；超過 48 小時沒有成功備份 → 警告
2. 在正式目錄 `git pull`
3. 執行 `sudo install.sh`（需要輸入密碼）：先在 `backups/` 做一份部署前快照（保留 5 份），再跑 migration、重啟服務，最後檢查 `/healthz`

### 回退

`/healthz` 失敗時不會自動回退，`deploy.sh` 會印出上一個 commit 和快照路徑。確認要回退時：

**只回退程式**（這次部署沒有改 DB schema）：
```bash
cd ~/services/receipt-system
git checkout <上一個 commit>
sudo bash deploy/macos/install.sh
```

**連 DB 一起還原**：會把部署之後寫入的資料蓋掉，請先確認沒有新資料。
```bash
sudo launchctl bootout system/com.receipt-system.gunicorn
cp ~/services/receipt-system/backups/pre-deploy-<時間>-<commit>.db ~/services/receipt-system/receipt_system.db
```
接著照「只回退程式」的步驟重跑 `install.sh`。

回退完成後，記得回到 `main` 修好問題再重新部署。

### 每日備份

每天凌晨 3 點由 LaunchAgent 備份到 iCloud Drive 的 `receipt-system-backup/`（見 [ADR-0005](docs/adr/0005-daily-backup-to-icloud-drive.md)）：
- **DB**：用 SQLite backup API 做快照並檢查完整性；每日快照保留 14 天，每月一份保留 12 個月
- **`uploads/`**：保留原圖，只新增、不刪除

> 不要把正在使用中的 `receipt_system.db` 直接放進 iCloud 同步，會損毀。

### 常用指令
```bash
tail -f ~/Library/Logs/receipt-system/gunicorn.err.log           # log
sudo launchctl kickstart -k system/com.receipt-system.gunicorn   # 重啟
sudo launchctl bootout system/com.receipt-system.gunicorn        # 停止
tailscale funnel status                                          # Funnel 狀態
```

## 🛡️ 安全提示
請務必不要將 `.env` 檔案上傳至任何公開版本控制系統，以確保 API 金鑰安全。

## 📝 授權
[MIT License](LICENSE)
