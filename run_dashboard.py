import uvicorn
import webbrowser
import sys
import os

if __name__ == "__main__":
    port = 8000
    host = "127.0.0.1"
    url = f"http://{host}:{port}"
    
    print("=" * 60)
    print(" 🛰️  SATNEX — Satellite Network Explorer")
    print(f" 🌐  Dashboard URL: {url}")
    print(" 📡  KeepTrack API V4 Ready")
    print("=" * 60)
    
    uvicorn.run("backend.server:app", host=host, port=port, reload=False, log_level="info")

