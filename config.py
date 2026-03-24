import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
    DATABASE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "receipt_system.db")
    MAX_CONTENT_LENGTH = 10 * 1024 * 1024  # 10MB
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
