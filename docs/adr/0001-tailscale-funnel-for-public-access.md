# 對外連線使用 Tailscale Funnel

出國旅行時要能隨時上傳收據，但使用者不想要求同行者安裝 Tailscale，所以只開放 tailnet 內部存取不夠用。決定使用 Tailscale Funnel 公開服務，網址形如 `https://<machine>.<tailnet>.ts.net`。設計期間曾一度改成 Cloudflare Tunnel，後來又改回 Funnel；主機上本來就有 Tailscale，用 Funnel 不必再多維護 `cloudflared` 和一個網域。

## Consequences

- 前端全部使用絕對路徑（`/api`、`/login`、`/uploads/`），不能掛在 Funnel 的子路徑下。receipt-system 獨佔 **443** 的根目錄；`investment_dashboard` 以後如果也要公開，改用 8443。
- Funnel 會把原始連線來源用 `Set` 寫進 `X-Forwarded-For`，用戶端無法偽造（Tailscale v1.102.4 `ipn/ipnlocal/serve.go`：`srcAddr` 取自 ingress 節點送來的 `Tailscale-Ingress-Src`，程式註解明寫「不是 ingress 節點的位址」）。因此只要請求來自 loopback，app 就可以信任這個 header 並取得真實的 client IP。
- 需要在 Tailscale 後台開啟 HTTPS Certificates，並給這個節點加上 `funnel` nodeAttr。
