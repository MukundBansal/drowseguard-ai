from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from detection import DrowsinessDetector
import uvicorn
import contextlib

detector = DrowsinessDetector()

@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    # Start the detection background task
    detector.start()
    yield
    # Clean up on shutdown
    detector.stop()

app = FastAPI(lifespan=lifespan)

# Allow CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Since frontend is on vite's default ports or localhost
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/status")
def get_status():
    return {
        "ear": round(detector.current_ear, 3),
        "alert_state": detector.alert_state,
        "alert": detector.alert,
        "fps": round(detector.fps, 1),
        "session_time": round(detector.session_time, 1)
    }

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
