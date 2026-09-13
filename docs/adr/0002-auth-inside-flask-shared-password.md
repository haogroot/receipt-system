# 驗證做在 Flask 裡：共用密碼加長效 session

Funnel 公開之後需要登入保護。驗證直接寫在 Flask 的 `before_request`（`auth.py`），**不另外架 auth-gate 反向代理**。`investment_dashboard` 用的是「gate 注入 `X-API-Key`」的做法，這裡刻意不沿用：這個專案只有一個服務，多一個 gate 只會多一個需要常駐和維護的程式。

登入方式採用最基本的做法：**一組共用密碼**，加上 permanent session cookie（`HttpOnly`、`Secure`、`SameSite=Lax`，預設 180 天，每次請求自動延長）。將 `AUTH_SESSION_VERSION` 加 1，即可強制所有裝置重新登入。沒有設定密碼時，服務會拒絕啟動（fail-closed）。暫時不做 passkey，之後有需要可以再加上去。

## 暴力破解防護

- **以 IP 為單位鎖定**。IP 從 `X-Forwarded-For` 取得，只在請求來自 loopback 時才信任這個 header（依據見 ADR-0001）。IPv6 以 `/64` 為單位計算，避免攻擊者在同一段位址內不斷換 IP。
- 失敗次數存在 **in-memory**。gunicorn 有 2 個 worker，所以攻擊者實際可嘗試的次數是設定值的 2 倍，而且服務重啟後計數歸零。這是刻意接受的取捨：正式環境的密碼是 **≥16 字元的隨機字串**，線上暴力破解本來就不可行，不值得為此把計數搬進 SQLite。
- 不做全域延遲：當密碼夠強時，全域延遲幾乎沒有額外的安全效益，反而可能在被攻擊期間讓擁有者自己也登不進去。
