import uvicorn
import socket
import sys

# Ensure UTF-8 output on Windows console
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def find_available_port(start_port=8000, max_attempts=20):
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port
    return start_port

if __name__ == "__main__":
    port = find_available_port(8000)
    print("=" * 60)
    print(f"[*] Launching Deep Image Crawler & Gallery Web App")
    print(f"[*] Access URL: http://127.0.0.1:{port}")
    print("=" * 60)
    uvicorn.run("app.main:app", host="127.0.0.1", port=port, reload=False, log_level="info")
