import { useState, useEffect, useRef } from 'react'
// @ts-ignore
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

type Status = {
  ear: number
  alert_state: string
  fps: number
  session_time: number
}

type LogEvent = {
  time: string
  message: string
  type: string
}

function App() {
  const [status, setStatus] = useState<Status>({
    ear: 0.0,
    alert_state: 'AWAKE',
    fps: 0.0,
    session_time: 0.0
  })

  const [isDetecting, setIsDetecting] = useState(false)
  const [isModelLoading, setIsModelLoading] = useState(false)
  const [logs, setLogs] = useState<LogEvent[]>([])

  const videoRef = useRef<HTMLVideoElement>(null)
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null)
  
  // Tracking Refs for ML Loop
  const requestRef = useRef<number | undefined>(undefined)
  const lastVideoTimeRef = useRef<number>(-1)
  const consecutiveFramesRef = useRef(0)
  const startTimeRef = useRef(0)
  const prevTimeRef = useRef(0)
  const audioCtxRef = useRef<AudioContext | null>(null)

  const EAR_THRESHOLD = 0.25
  const CONSECUTIVE_FRAMES = 20

  const LEFT_EYE = [362, 385, 387, 263, 373, 380]
  const RIGHT_EYE = [33, 160, 158, 133, 153, 144]

  const getEuclideanDistance = (p1: any, p2: any) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2))
  }

  const calculateEAR = (eyeIndices: number[], landmarks: any[]) => {
    const p = eyeIndices.map(i => landmarks[i])
    const A = getEuclideanDistance(p[1], p[5])
    const B = getEuclideanDistance(p[2], p[4])
    const C = getEuclideanDistance(p[0], p[3])
    if (C === 0) return 0.0
    return (A + B) / (2.0 * C)
  }

  const playBeep = () => {
    if (!audioCtxRef.current) {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext
      audioCtxRef.current = new AudioContext()
    }
    const ctx = audioCtxRef.current
    if (ctx.state === 'suspended') ctx.resume()
    
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.setValueAtTime(800, ctx.currentTime)
    osc.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.15) // short beep
  }

  const addLog = (msg: string, type: 'info' | 'warn' | 'error') => {
    setLogs(prev => {
      const newLog = { 
        time: new Date().toLocaleTimeString([], { hour12: false }), 
        message: msg, 
        type 
      }
      return [newLog, ...prev].slice(0, 5) // Keep last 5 logs
    })
  }

  // Initialize MediaPipe FaceLandmarker
  useEffect(() => {
    const initModel = async () => {
      setIsModelLoading(true)
      try {
        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        )
        faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU"
          },
          outputFaceBlendshapes: false,
          runningMode: "VIDEO",
          numFaces: 1
        })
        addLog("AI Model Loaded Successfully", "info")
      } catch (err) {
        console.error(err)
        addLog("Failed to load AI Model", "error")
      } finally {
        setIsModelLoading(false)
      }
    }
    initModel()
  }, [])

  // Start / Stop Camera & Loop
  useEffect(() => {
    let stream: MediaStream | null = null

    const startCamera = async () => {
      if (!videoRef.current || !faceLandmarkerRef.current) return
      
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
        videoRef.current.srcObject = stream
        addLog("Camera stream started", "info")
      } catch (err) {
        console.error("Camera access denied", err)
        addLog("Camera Access Denied", "error")
        setIsDetecting(false)
        return
      }

      startTimeRef.current = performance.now()
      prevTimeRef.current = performance.now()
      consecutiveFramesRef.current = 0
      
      // ML loop
      const detectFrame = async () => {
        const video = videoRef.current
        if (!video || !faceLandmarkerRef.current || video.readyState !== 4) {
          requestRef.current = requestAnimationFrame(detectFrame)
          return
        }

        const currTime = performance.now()
        
        // Only process if browser updated video frame
        if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime

          const result = faceLandmarkerRef.current.detectForVideo(video, currTime)
          
          let currentEar = 0
          let state = 'AWAKE'

          if (result.faceLandmarks && result.faceLandmarks.length > 0) {
            const landmarks = result.faceLandmarks[0]
            const leftEar = calculateEAR(LEFT_EYE, landmarks)
            const rightEar = calculateEAR(RIGHT_EYE, landmarks)
            currentEar = (leftEar + rightEar) / 2.0

            if (currentEar < EAR_THRESHOLD) {
              consecutiveFramesRef.current += 1
              if (consecutiveFramesRef.current >= CONSECUTIVE_FRAMES) {
                state = 'DROWSY'
              } else {
                state = 'WARNING'
              }
            } else if (currentEar >= 0.25 && currentEar < 0.28) {
              consecutiveFramesRef.current = 0
              state = 'WARNING'
            } else {
              consecutiveFramesRef.current = 0
              state = 'AWAKE'
            }
          } else {
            consecutiveFramesRef.current = 0
            state = 'WARNING' // Cannot see face
          }

          // Compute FPS
          const fps = 1000 / (currTime - prevTimeRef.current)
          prevTimeRef.current = currTime
          
          // Audio & Logs Context
          setStatus(prev => {
            if (state === 'DROWSY' && prev.alert_state !== 'DROWSY') {
              playBeep()
              addLog(`DROWSY EPISODE DETECTED! (EAR: ${currentEar.toFixed(2)})`, "error")
            } else if (state === 'DROWSY') {
              // Loop playing beep logic if necessary, here we just spam it moderately
              if (consecutiveFramesRef.current % 10 === 0) playBeep()
            }
            return {
              ear: currentEar,
              alert_state: state,
              fps: fps,
              session_time: (currTime - startTimeRef.current) / 1000
            }
          })
        }
        
        requestRef.current = requestAnimationFrame(detectFrame)
      }
      
      requestRef.current = requestAnimationFrame(detectFrame)
    }

    if (isDetecting) {
      if (audioCtxRef.current?.state === 'suspended') {
        audioCtxRef.current.resume()
      }
      startCamera()
    } else {
      // Cleanup
      if (requestRef.current) cancelAnimationFrame(requestRef.current)
      if (videoRef.current) videoRef.current.srcObject = null
      
      addLog("Detection session ended", "info")
      setStatus(prev => ({ ...prev, alert_state: 'AWAKE', ear: 0.0, fps: 0.0 }))
    }

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current)
      if (stream) {
        stream.getTracks().forEach((track: MediaStreamTrack) => track.stop())
      }
    }
  }, [isDetecting])

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return "00:00"
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = Math.floor(seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const isDrowsy = status.alert_state === 'DROWSY'
  const isWarning = status.alert_state === 'WARNING'
  const stateBgClass = isDrowsy ? 'bg-dg-drowsy' : isWarning ? 'bg-dg-warning' : 'bg-dg-awake'
  const stateTextClass = isDrowsy ? 'text-dg-drowsy' : isWarning ? 'text-dg-warning' : 'text-dg-awake'

  return (
    <div className="min-h-screen bg-dg-bg text-white font-inter selection:bg-dg-primary selection:text-white pb-20">
      {/* Navbar */}
      <nav className="border-b border-dg-card/50 bg-dg-bg/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-dg-primary flex items-center justify-center shadow-lg">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white">
                  <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                  <path fillRule="evenodd" d="M1.323 11.447C2.811 6.976 7.028 3.75 12.001 3.75c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113-1.487 4.471-5.705 7.697-10.677 7.697-4.97 0-9.186-3.223-10.675-7.69a1.762 1.762 0 010-1.113zM17.25 12a5.25 5.25 0 11-10.5 0 5.25 5.25 0 0110.5 0z" clipRule="evenodd" />
                </svg>
              </div>
              <span className="font-bold text-xl tracking-tight">DrowseGuard AI</span>
            </div>
            <div className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-300">
              <span className="bg-white/10 px-3 py-1 text-xs rounded-full border border-white/5">Browser-Native Inference</span>
            </div>
          </div>
        </div>
      </nav>

      <main className="relative overflow-hidden w-full">
        {/* Intense background glow effects */}
        <div className={`absolute top-0 right-0 -translate-y-1/2 translate-x-1/3 w-[800px] h-[800px] rounded-full blur-[150px] pointer-events-none transition-all duration-700 ${isDrowsy ? 'bg-dg-drowsy/30 animate-pulse' : 'bg-dg-primary/10'}`}></div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 relative z-10 text-center">
          
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6">
            Real-Time Protection, <br className="hidden md:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-dg-primary to-purple-400">
              Directly in your Browser
            </span>
          </h1>
          
          <div className="flex justify-center mb-10">
            <button 
              disabled={isModelLoading}
              onClick={() => setIsDetecting(!isDetecting)}
              className={`cursor-pointer px-8 py-4 ${
                isDetecting 
                  ? 'bg-dg-card border border-red-500/50 hover:bg-black/40 text-red-500 shadow-[0_0_30px_-5px_rgba(239,68,68,0.3)]' 
                  : 'bg-dg-primary hover:bg-blue-600 shadow-[0_0_40px_-5px_rgba(59,130,246,0.6)]'
              } text-white rounded-xl font-bold text-lg transition-all transform hover:-translate-y-1 active:scale-95 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isModelLoading ? (
                <div className="w-5 h-5 border-2 border-t-transparent border-white rounded-full animate-spin"></div>
              ) : isDetecting ? (
                <div className="w-3 h-3 bg-red-500 rounded-sm"></div>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M1.5 4.5a3 3 0 013-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 01-.694 1.955l-1.293.97c-.135.101-.164.249-.126.352a11.285 11.285 0 006.697 6.697c.103.038.25.009.352-.126l.97-1.293a1.875 1.875 0 011.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 01-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5z" clipRule="evenodd" />
                </svg>
              )}
              {isModelLoading ? 'Loading AI Model...' : isDetecting ? 'Stop Session' : 'Start Camera'}
            </button>
          </div>
          
          {/* Dashboard Area */}
          <div className="relative mx-auto max-w-6xl w-full flex flex-col lg:flex-row gap-6">
            
            {/* Live Camera Feed */}
            <div className={`relative flex-1 rounded-2xl bg-[#0f1422] border overflow-hidden shadow-2xl transition-all duration-500 ${isDrowsy ? 'border-dg-drowsy/80 shadow-[0_0_80px_-15px_rgba(239,68,68,0.5)]' : 'border-white/10 shadow-black/50'}`}>
              
              <div className="w-full aspect-video bg-black relative flex items-center justify-center">
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted
                  className={`absolute inset-0 w-full h-full object-cover transform scale-x-[-1] transition-opacity duration-300 ${!isDetecting ? 'opacity-0' : 'opacity-100'}`}
                />
                
                {!isDetecting && (
                  <div className="flex flex-col items-center gap-4 text-gray-500">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 opacity-50">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                    </svg>
                    <span>Camera is disconnected</span>
                  </div>
                )}
                
                {/* Visual HUD overlay */}
                {isDetecting && (
                  <>
                    <div className="absolute top-4 left-4 flex gap-2">
                      <div className="px-2 py-1 bg-black/60 backdrop-blur-md rounded border border-white/10 flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isDrowsy ? 'bg-dg-drowsy animate-ping' : isWarning ? 'bg-dg-warning' : 'bg-dg-awake animate-pulse'}`}></div>
                        <span className="text-[10px] uppercase font-bold tracking-wider text-gray-300">LIVE</span>
                      </div>
                    </div>
                    
                    <div className="absolute top-4 right-4 text-right">
                      <div className="px-2 py-1 bg-black/60 backdrop-blur-md rounded border border-white/10">
                        <span className="text-[10px] uppercase font-bold text-gray-400">FPS / Inference</span>
                        <div className="text-sm font-mono text-white">{status.fps.toFixed(1)}</div>
                      </div>
                    </div>

                    <div className="absolute bottom-4 inset-x-4">
                      <div className={`flex items-center justify-between px-4 py-3 rounded-xl backdrop-blur-md border ${isDrowsy ? 'bg-red-500/20 border-red-500/50' : isWarning ? 'bg-amber-500/20 border-amber-500/50' : 'bg-black/60 border-white/10'}`}>
                        <div className="flex flex-col items-start gap-1">
                          <span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold flex items-center gap-2">
                            User State
                          </span>
                          <span className={`text-2xl font-black tracking-tight ${stateTextClass}`}>
                            {status.alert_state}
                          </span>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
                            Global Session
                          </span>
                          <span className="text-xl font-mono text-white tracking-wider">
                            {formatTime(status.session_time)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            
            {/* Side Metrics Dashboard */}
            <div className="w-full lg:w-80 flex flex-col gap-4 text-left">
              
              {/* Massive EAR metric */}
              <div className="bg-dg-card border border-white/5 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                {isDrowsy && <div className="absolute inset-0 bg-red-500/10 animate-pulse pointer-events-none"></div>}
                <div className="text-xs text-gray-500 uppercase font-semibold tracking-wider mb-2">Eye Aspect Ratio</div>
                <div className={`text-6xl font-black tabular-nums tracking-tighter transition-colors duration-300 ${stateTextClass}`}>
                  {isDetecting ? status.ear.toFixed(3) : '0.000'}
                </div>
                
                <div className="mt-4">
                   <div className="flex justify-between text-[10px] font-bold text-gray-400 mb-1">
                     <span>CLOSED</span>
                     <span className={`${isDrowsy ? 'text-red-400' : 'text-gray-500'}`}>0.25 (THRESHOLD)</span>
                     <span>OPEN</span>
                   </div>
                   <div className="w-full bg-black rounded-full h-1.5 overflow-hidden relative border border-white/10">
                     <div 
                       className={`h-full transition-all duration-200 ease-out ${!isDetecting ? 'bg-gray-700' : stateBgClass}`} 
                       style={{ width: `${Math.min(100, Math.max(0, (status.ear / 0.45) * 100))}%` }}
                     ></div>
                     {/* Red line threshold */}
                     <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10" style={{ left: `${(0.25 / 0.45) * 100}%` }}></div>
                   </div>
                </div>
              </div>

              {/* Event Logs */}
              <div className="bg-dg-card border border-white/5 rounded-2xl p-6 shadow-xl flex-1 max-h-[300px] flex flex-col">
                <div className="flex justify-between items-center mb-4">
                  <div className="text-xs text-gray-500 uppercase font-semibold tracking-wider">Session Logs</div>
                  {isDetecting && <div className="w-1.5 h-1.5 rounded-full bg-dg-primary animate-pulse"></div>}
                </div>
                
                <div className="flex-1 overflow-y-auto space-y-3 font-mono text-[11px]">
                  {logs.length === 0 ? (
                     <div className="text-gray-600 italic">No events recorded.</div>
                  ) : (
                    logs.map((log, i) => (
                      <div key={i} className={`pb-3 border-b border-white/5 ${log.type === 'error' ? 'text-red-400' : log.type === 'warn' ? 'text-amber-400' : 'text-gray-400'}`}>
                        <div className="text-gray-600 mb-0.5">{log.time}</div>
                        <div>{log.message}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          </div>
          
        </div>
      </main>
    </div>
  )
}

export default App
