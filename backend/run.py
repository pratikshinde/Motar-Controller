import sys
import uvicorn
from app.config import settings

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

if __name__ == "__main__":
    print("\nStarting AgriPump Backend Server at: http://127.0.0.1:5000")
    print("API Documentation: http://127.0.0.1:5000/docs\n")
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.PORT,
        reload=True
    )
