# 正式環境是另外 clone 的一份，並透過 `deploy.sh` 部署

開發和正式環境在同一台 Mac mini 上（見 ADR-0003）。原本的 `install.sh` 會把 LaunchDaemon 指向「自己所在的 repo」，結果正式服務直接跑開發目錄：包含還沒 commit 的程式碼，並與開發共用 DB、`uploads/` 和 `.env`。其中 `COOKIE_SECURE` 在兩邊的需求剛好相反。

決定**從 GitHub 另外 clone 一份到 `~/services/receipt-system`，作為正式環境，並跟隨 `main`**。DB、`uploads/`、`.secret_key`、`.env` 的路徑都相對於程式目錄，所以只要目錄分開，兩邊就自動隔離，程式不需要改。

## Considered Options

- **`git worktree`**：可以部署還沒 push 的 commit，但同一個 branch 不能同時在兩個 worktree 裡 checkout，而且正式環境會依賴開發 repo 的 `.git`。
- **同一個目錄，改用 env 指定資料路徑**：這樣只分開了資料，正式服務仍然會跑到寫到一半的程式碼。
- **用 tag 或 `production` branch 發布**：只有一位開發者、也沒有 CI，多這一層沒有好處。回退時直接 checkout 舊的 commit 即可。

## 部署流程

在開發 repo 執行 `./deploy.sh`：

1. 開發 repo 有 commit 還沒 push、不在 `main`，或正式目錄有人手動改過 → 擋下；開發 repo 有未 commit 的修改 → 只警告。
2. 到正式目錄執行 `git pull`，再執行 `sudo install.sh`。每次都需要輸入密碼；刻意不加 sudoers `NOPASSWD` 規則。
3. `install.sh` 在正式目錄找不到不進 git 的 `.production` 標記檔就拒絕執行，避免有人在開發目錄誤跑，把正式服務指到開發資料。
4. migration 之前，先用 SQLite backup API 做一份部署前快照，保留最近 5 份。
5. 如果 `/healthz` 沒有回應，**不自動回退**，只印出上一個 commit、快照路徑和回退指令。自動還原快照可能會把失敗前已經寫入的資料蓋掉。

## Consequences

- 開發環境維持綁 `0.0.0.0`（`PORT=7001`；避開 macOS AirPlay Receiver 佔用的 5000 和正式服務的 8000）並開 `debug=True`，因為經常需要用手機相機實際測試（`<input capture>` 在 http 下也能運作）。開發環境的 `.env` 設 `COOKIE_SECURE=false`，並使用另一組密碼，避免透過區網 http 傳送時洩漏正式環境的密碼。Gemini API key 兩邊共用。
