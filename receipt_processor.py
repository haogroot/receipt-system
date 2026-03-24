import json
import re
import base64
from google import genai
from config import Config

RECEIPT_PROMPT = """你是一位專業的發票與收據處理專家。請精準辨識圖片中的文字，並將資訊提取為結構化的 JSON 格式。

處理原則：
1. **語言處理**：將所有商品名稱、店家名稱翻譯成「繁體中文」
2. **金額處理**：只提取數字，移除貨幣符號
3. **日期處理**：統一格式為 YYYY-MM-DD
4. **支付方式辨識**：
   - 如果看到信用卡相關字樣（クレジット、VISA、Mastercard、JCB、AMEX 等）→ "credit_card"
   - 如果看到交通系IC卡（Suica、PASMO、ICOCA、nanaco、WAON 等）→ "ic_card"
   - 如果看到現金相關字樣（現金、お釣り、找零等）或無法判斷 → "cash"
5. **類別推斷**：根據店家和商品推斷消費類別，可選值：
   - "餐飲"（餐廳、咖啡廳、便利商店食物）
   - "交通"（車票、計程車、加油）
   - "購物"（服飾、紀念品、日用品）
   - "住宿"（旅館、飯店）
   - "娛樂"（門票、遊樂園）
   - "其他"

必須回傳的 JSON 格式：
```json
{
  "store_name": "店家名稱（繁體中文）",
  "date": "YYYY-MM-DD",
  "items": [
    {
      "name": "商品名稱（繁體中文）",
      "quantity": 1,
      "unit_price": 100,
      "amount": 100
    }
  ],
  "total_amount": 100,
  "currency": "JPY",
  "payment_method": "cash",
  "category": "餐飲"
}
```

注意事項：
- 如果無法辨識某個欄位，請合理推測或填入 null
- items 的 amount 應為 quantity × unit_price
- total_amount 應為所有 items 的 amount 加總（若有稅額請包含）
- currency 使用 ISO 4217 貨幣代碼（如 JPY, USD, TWD, EUR, KRW 等）
- 只回傳 JSON，不要有任何多餘文字

請辨識以下收據圖片："""


def process_receipt_image(image_data: bytes, mime_type: str = "image/jpeg") -> dict:
    """
    Process a receipt image using Gemini API and return structured JSON.

    Args:
        image_data: Raw bytes of the image
        mime_type: MIME type of the image (image/jpeg, image/png, etc.)

    Returns:
        dict with structured receipt data
    """
    client = genai.Client(api_key=Config.GEMINI_API_KEY)

    response = client.models.generate_content(
        model=Config.GEMINI_MODEL,
        contents=[
            {
                "role": "user",
                "parts": [
                    {"text": RECEIPT_PROMPT},
                    {
                        "inline_data": {
                            "mime_type": mime_type,
                            "data": base64.standard_b64encode(image_data).decode("utf-8"),
                        }
                    },
                ],
            }
        ],
    )

    raw_text = response.text.strip()
    parsed = _parse_json_response(raw_text)

    # Validate and normalize
    parsed = _normalize_receipt(parsed)

    return parsed


def _parse_json_response(text: str) -> dict:
    """Extract JSON from Gemini response, handling markdown code blocks."""
    # Try to extract from markdown code block
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", text, re.DOTALL)
    if match:
        text = match.group(1).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try harder - find first { to last }
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1:
            return json.loads(text[start : end + 1])
        raise ValueError(f"Cannot parse JSON from Gemini response: {text[:200]}")


def _normalize_receipt(data: dict) -> dict:
    """Normalize and validate receipt data."""
    # Ensure required fields exist
    defaults = {
        "store_name": "未知店家",
        "date": None,
        "items": [],
        "total_amount": 0,
        "currency": "JPY",
        "payment_method": "cash",
        "category": "其他",
    }

    for key, default in defaults.items():
        if key not in data or data[key] is None:
            data[key] = default

    # Normalize payment_method
    pm = str(data.get("payment_method", "")).lower()
    if any(k in pm for k in ["credit", "card", "信用", "クレジット", "visa", "master", "jcb", "amex"]):
        data["payment_method"] = "credit_card"
    elif any(k in pm for k in ["ic", "suica", "pasmo", "icoca", "nanaco", "waon", "交通"]):
        data["payment_method"] = "ic_card"
    else:
        data["payment_method"] = "cash"

    # Normalize category
    valid_categories = ["餐飲", "交通", "購物", "住宿", "娛樂", "其他"]
    if data.get("category") not in valid_categories:
        data["category"] = "其他"

    # Ensure total_amount is numeric
    try:
        data["total_amount"] = float(str(data["total_amount"]).replace(",", ""))
    except (ValueError, TypeError):
        data["total_amount"] = 0

    # Normalize items
    normalized_items = []
    for item in data.get("items", []):
        try:
            ni = {
                "name": item.get("name", "未知品項"),
                "quantity": int(item.get("quantity", 1)),
                "unit_price": float(str(item.get("unit_price", 0)).replace(",", "")),
                "amount": float(str(item.get("amount", 0)).replace(",", "")),
            }
            normalized_items.append(ni)
        except (ValueError, TypeError):
            continue
    data["items"] = normalized_items

    return data
